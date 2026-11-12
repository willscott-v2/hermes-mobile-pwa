// ChainedVoiceBackend: the only place that knows the Hermes /api/audio/* protocol.
//
//   dictation  WS transcribe-stream: {sample_rate} -> binary mono s16le PCM -> {eos:true}
//              server: {type:partial|final|error}
//              A server with no live STT (local whisper etc.) answers with the NO_LIVE_STT_MESSAGE error
//              frame so the client falls back to POST /api/audio/transcribe with the recording; the
//              backend then keeps capturing, buffers PCM, and uploads a WAV when the user stops.
//   speech     WS speak-stream: {text}* -> {done:true} | {stop:true}
//              server: {type:start,sample_rate,channels} -> binary s16le PCM -> {type:end|fallback}
//
// Socket URLs (with profile and a fresh credential) come from the injected `socketUrl`; this module
// never builds, logs or stores a ticket/token itself.

import type { AudioSocketKind } from './hermesApi';
import { AudioEnv, MicCapture, openMicCapture } from './micCapture';
import { encodeWavMono16, MAX_TRANSCRIBE_UPLOAD_BYTES, Pcm16Decoder, WAV_HEADER_BYTES } from './pcm';
import { PcmPlayer, PcmPlayerHandlers } from './pcmPlayer';
import { DictationHandlers, DictationSession, SpeechHandlers, SpeechSession, VoiceBackend, VoiceBackendError, VoiceCapability } from './voiceBackend';
import type { VoiceScope } from './voiceMachine';

export interface SocketLike {
  binaryType: string;
  readyState: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
}

export interface PlayerLike {
  enqueue(samples: Float32Array, sampleRate: number): void;
  end(): void;
  stop(): void;
}

export interface ChainedVoiceDeps {
  audio: AudioEnv;
  socketUrl(kind: AudioSocketKind, profile: string): Promise<string>;
  // Batch dictation for servers without live STT: a mono 16-bit WAV in, the transcript out.
  transcribeBatch(profile: string, wav: Uint8Array, signal: AbortSignal): Promise<string>;
  createSocket?: (url: string) => SocketLike;
  createPlayer?: (context: AudioContext, handlers: PcmPlayerHandlers) => PlayerLike;
}

// ~15s of 48 kHz mono s16 captured while the socket is still connecting; beyond that the link is
// too slow to be useful and dictation fails instead of growing memory.
const MAX_PENDING_BYTES = 48_000 * 2 * 15;
const SOCKET_OPEN = 1;
// hermes_cli/web_routers/audio.py transcribe_stream_ws: the exact error text meaning "no live wire for
// this provider, use the batch endpoint". Any other error frame is a real failure.
export const NO_LIVE_STT_MESSAGE = 'no live STT for the configured provider';
const MAX_BATCH_PCM_BYTES = MAX_TRANSCRIBE_UPLOAD_BYTES - WAV_HEADER_BYTES;

interface Disposable { dispose(): void }

function detach(socket: SocketLike): void {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
}

function closeQuietly(socket: SocketLike | null): void {
  if (!socket) return;
  detach(socket);
  try { socket.close(1000); } catch { /* already closed */ }
}

function parseFrame(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export class ChainedVoiceBackend implements VoiceBackend {
  readonly id = 'chained';
  private context: AudioContext | null = null;
  private readonly sessions = new Set<Disposable>();

  constructor(private readonly deps: ChainedVoiceDeps) {}

  capability(): VoiceCapability {
    if (!this.deps.audio.isSecureContext) {
      return { supported: false, code: 'insecure-context', message: 'Voice needs a secure connection (HTTPS). Open Hermes over https:// to use the microphone; text chat still works.' };
    }
    if (!this.deps.audio.hasMicrophone) {
      return { supported: false, code: 'unsupported', message: 'This browser does not provide microphone access, so voice is unavailable. Text chat still works.' };
    }
    return { supported: true };
  }

  unlockAudio(): void {
    try {
      const context = this.ensureContext();
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
    } catch {
      // Reported with a specific error when dictation/speech actually starts.
    }
  }

  private ensureContext(): AudioContext {
    if (!this.context || this.context.state === 'closed') this.context = this.deps.audio.createContext();
    return this.context;
  }

  private newSocket(url: string): SocketLike {
    const socket = this.deps.createSocket ? this.deps.createSocket(url) : (new WebSocket(url) as unknown as SocketLike);
    socket.binaryType = 'arraybuffer';
    return socket;
  }

  startDictation(scope: VoiceScope, handlers: DictationHandlers): DictationSession {
    const abort = new AbortController();
    let mic: MicCapture | null = null;
    let socket: SocketLike | null = null;
    let socketOpen = false;
    let eosRequested = false;
    let sampleRate = 0;
    let dead = false;
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    // The recording is kept (bounded) until the transcriber proves it is live, because the no-live
    // signal arrives after capture started. `batch` means the server asked for the upload fallback.
    let batch = false;
    let liveConfirmed = false;
    let recorded: Uint8Array[] = [];
    let recordedBytes = 0;
    let recordingOverflow = false;

    const release = () => {
      mic?.stop();
      mic = null;
      closeQuietly(socket);
      socket = null;
      socketOpen = false;
      pending = [];
      recorded = [];
    };
    const cancel = () => {
      if (dead) return;
      dead = true;
      abort.abort();
      release();
      this.sessions.delete(disposable);
    };
    const fail = (error: VoiceBackendError) => {
      if (dead) return;
      dead = true;
      abort.abort();
      release();
      this.sessions.delete(disposable);
      handlers.onError(error);
    };
    const disposable: Disposable = { dispose: cancel };
    this.sessions.add(disposable);

    const tooLong = () => fail(new VoiceBackendError('stt-failed', 'This recording is too long to transcribe without live speech-to-text. Nothing was sent.'));
    const record = (frame: Uint8Array) => {
      if (liveConfirmed || recordingOverflow) return;
      recordedBytes += frame.byteLength;
      if (recordedBytes > MAX_BATCH_PCM_BYTES) {
        recorded = [];
        recordingOverflow = true;
        return;
      }
      recorded.push(frame);
    };

    const settle = (text: string) => {
      dead = true;
      release();
      this.sessions.delete(disposable);
      handlers.onFinal(text);
    };
    const runBatch = () => {
      if (recordedBytes === 0) { settle(''); return; }
      const wav = encodeWavMono16(recorded, sampleRate);
      recorded = [];
      void (async () => {
        try {
          const text = await this.deps.transcribeBatch(scope.profile, wav, abort.signal);
          if (!dead) settle(text);
        } catch (error) {
          if (dead) return;
          fail(new VoiceBackendError('stt-failed', error instanceof Error && error.message ? error.message : 'Transcription failed.'));
        }
      })();
    };
    const enterBatch = () => {
      batch = true;
      pending = [];
      closeQuietly(socket); // detached first, so the close that follows the signal reports nothing
      socket = null;
      socketOpen = false;
      if (recordingOverflow) { tooLong(); return; }
      if (eosRequested) runBatch();
    };

    const onFrame = (frame: Uint8Array) => {
      if (dead) return;
      if (batch) {
        record(frame);
        if (recordingOverflow) tooLong();
        return;
      }
      if (eosRequested) return;
      record(frame);
      if (socketOpen && socket) {
        socket.send(frame);
        return;
      }
      pendingBytes += frame.byteLength;
      if (pendingBytes > MAX_PENDING_BYTES) {
        fail(new VoiceBackendError('stt-failed', 'Could not reach the transcriber in time. Nothing was sent.'));
        return;
      }
      pending.push(frame);
    };

    void (async () => {
      try {
        // Both calls run synchronously inside the user gesture: audio unlock, then getUserMedia.
        const context = this.ensureContext();
        mic = await openMicCapture(this.deps.audio, context, onFrame, abort.signal);
        if (dead) { mic.stop(); mic = null; return; }
        sampleRate = mic.sampleRate;
        // A ticket is single-use with a 30s TTL, so it is minted only after the permission prompt.
        const url = await this.deps.socketUrl('transcribe-stream', scope.profile);
        if (dead) return;
        const ws = this.newSocket(url);
        socket = ws;
        ws.onopen = () => {
          if (dead) return;
          socketOpen = true;
          ws.send(JSON.stringify({ sample_rate: sampleRate }));
          for (const frame of pending) ws.send(frame);
          pending = [];
          if (eosRequested) ws.send(JSON.stringify({ eos: true }));
          handlers.onListening();
        };
        ws.onmessage = (event) => {
          if (dead) return;
          const frame = parseFrame(event.data);
          if (!frame) return;
          if (batch) return; // the stream was dropped; stray frames cannot change the outcome
          if (frame.type === 'partial' && typeof frame.text === 'string') {
            liveConfirmed = true;
            recorded = [];
            handlers.onPartial(frame.text);
          } else if (frame.type === 'final') {
            settle(typeof frame.transcript === 'string' ? frame.transcript : '');
          } else if (frame.type === 'error' && frame.message === NO_LIVE_STT_MESSAGE && !liveConfirmed) {
            enterBatch();
          } else if (frame.type === 'error') {
            fail(new VoiceBackendError('stt-failed', typeof frame.message === 'string' && frame.message ? frame.message : 'Transcription failed.'));
          }
        };
        ws.onerror = () => fail(new VoiceBackendError('stt-failed', 'Could not reach the transcriber.'));
        ws.onclose = () => {
          if (dead) return;
          dead = true;
          release();
          this.sessions.delete(disposable);
          handlers.onClosed();
        };
      } catch (error) {
        if (dead) return;
        fail(error instanceof VoiceBackendError ? error : new VoiceBackendError('stt-failed', error instanceof Error && error.message ? error.message : 'Could not start dictation.'));
      }
    })();

    return {
      finish: () => {
        if (dead || eosRequested) return;
        if (!mic && !socket) { cancel(); return; }
        eosRequested = true;
        mic?.stop(); // release the microphone now; the socket stays open for the final transcript
        mic = null;
        if (batch) { runBatch(); return; }
        if (socketOpen && socket) socket.send(JSON.stringify({ eos: true }));
      },
      cancel,
    };
  }

  openSpeech(scope: VoiceScope, handlers: SpeechHandlers): SpeechSession {
    let socket: SocketLike | null = null;
    let open = false;
    let over = false;      // stopped/closed by us, errored, or closed unexpectedly: no more events
    let finished = false;  // server ended/fell back: a following socket close is expected
    let player: PlayerLike | null = null;
    let rate = 0;
    const outbox: string[] = [];
    const decoder = new Pcm16Decoder();

    const dispose = (stopFrame: boolean) => {
      if (over) return;
      over = true;
      if (stopFrame && open && socket) {
        try { socket.send(JSON.stringify({ stop: true })); } catch { /* socket already going away */ }
      }
      player?.stop();
      closeQuietly(socket);
      socket = null;
      outbox.length = 0;
      this.sessions.delete(disposable);
    };
    const disposable: Disposable = { dispose: () => dispose(false) };
    this.sessions.add(disposable);

    const send = (frame: Record<string, unknown>) => {
      if (over || finished) return;
      const text = JSON.stringify(frame);
      if (open && socket) socket.send(text);
      else outbox.push(text);
    };
    const fail = (error: VoiceBackendError) => {
      if (over) return;
      dispose(false);
      handlers.onError(error);
    };
    const ensurePlayer = (): PlayerLike => {
      if (player) return player;
      const context = this.ensureContext();
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
      const playerHandlers: PcmPlayerHandlers = {
        onStarted: () => { if (!over) handlers.onStarted(); },
        onDrained: () => { if (!over) handlers.onEnded(); },
      };
      player = this.deps.createPlayer ? this.deps.createPlayer(context, playerHandlers) : new PcmPlayer(context, playerHandlers);
      return player;
    };
    const finishWith = (outcome: 'end' | 'fallback') => {
      finished = true;
      if (outcome === 'fallback') {
        dispose(false); // silence anything already queued, close the socket, and go quiet before reporting
        handlers.onFallback();
      } else {
        closeQuietly(socket);
        socket = null;
        ensurePlayer().end(); // onDrained -> onEnded once queued audio has played
      }
    };

    void (async () => {
      try {
        const url = await this.deps.socketUrl('speak-stream', scope.profile);
        if (over) return;
        const ws = this.newSocket(url);
        socket = ws;
        ws.onopen = () => {
          if (over) return;
          open = true;
          for (const frame of outbox) ws.send(frame);
          outbox.length = 0;
        };
        ws.onmessage = (event) => {
          if (over || finished) return;
          if (typeof event.data !== 'string') {
            if (rate === 0 || !(event.data instanceof ArrayBuffer || ArrayBuffer.isView(event.data))) return;
            const samples = decoder.push(event.data instanceof ArrayBuffer ? event.data : new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength));
            if (samples.length) ensurePlayer().enqueue(samples, rate);
            return;
          }
          const frame = parseFrame(event.data);
          if (!frame) return;
          if (frame.type === 'start') {
            const sampleRate = Number(frame.sample_rate);
            if (Number(frame.channels ?? 1) !== 1 || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
              finishWith('fallback');
              return;
            }
            rate = sampleRate;
          } else if (frame.type === 'end') {
            finishWith('end');
          } else if (frame.type === 'fallback') {
            finishWith('fallback');
          }
        };
        ws.onerror = () => fail(new VoiceBackendError('internal', 'Voice playback connection failed.'));
        ws.onclose = () => {
          if (over || finished) return;
          dispose(false);
          handlers.onClosed();
        };
      } catch (error) {
        fail(new VoiceBackendError('internal', error instanceof Error && error.message ? error.message : 'Could not start voice playback.'));
      }
    })();

    return {
      speak: (text) => { if (text) send({ text }); },
      finish: () => send({ done: true }),
      stop: () => dispose(true),
      close: () => dispose(false),
    };
  }

  dispose(): void {
    for (const session of [...this.sessions]) session.dispose();
    this.sessions.clear();
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }
}
