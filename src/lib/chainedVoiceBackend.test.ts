import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainedVoiceBackend, SocketLike } from './chainedVoiceBackend';
import { AudioEnv } from './micCapture';
import { DictationHandlers, SpeechHandlers } from './voiceBackend';

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  binaryType = 'blob';
  readyState = 0;
  sent: Array<string | Uint8Array> = [];
  closedWith: number | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public readonly url: string) { FakeSocket.all.push(this); }
  send(data: string | Uint8Array) { this.sent.push(data); }
  close(code?: number) { this.closedWith = code ?? 1000; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  serverSends(data: unknown) { this.onmessage?.({ data }); }
  serverCloses() { this.readyState = 3; this.onclose?.(); }
  json() { return this.sent.filter((frame): frame is string => typeof frame === 'string').map((frame) => JSON.parse(frame)); }
  binary() { return this.sent.filter((frame): frame is Uint8Array => typeof frame !== 'string'); }
}

function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

type BatchCall = { profile: string; audio: Uint8Array; signal: AbortSignal };

function makeBackend(options: { secure?: boolean; mic?: boolean; getUserMedia?: () => Promise<MediaStream>; socketUrl?: (kind: string, profile: string) => Promise<string>; transcribeBatch?: (call: BatchCall) => Promise<string> } = {}) {
  const log: string[] = [];
  const tracks = [{ stop: () => log.push('track.stop') }];
  let onSamples: (samples: Float32Array) => void = () => undefined;
  const context = {
    sampleRate: 48000,
    state: 'suspended',
    resume: vi.fn(async () => { context.state = 'running'; }),
    close: vi.fn(async () => { context.state = 'closed'; }),
    createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => log.push('source.disconnect') }),
  };
  const env: AudioEnv = {
    isSecureContext: options.secure ?? true,
    hasMicrophone: options.mic ?? true,
    getUserMedia: options.getUserMedia ?? vi.fn(async () => ({ getTracks: () => tracks }) as unknown as MediaStream),
    createContext: vi.fn(() => context as unknown as AudioContext),
    createTap: async (_ctx, _source, handler) => { onSamples = handler; return { disconnect: () => log.push('tap.disconnect') }; },
  };
  const players: Array<{ enqueued: Array<{ length: number; rate: number }>; stopped: boolean; ended: boolean; handlers: { onStarted(): void; onDrained(): void } }> = [];
  const socketUrl = vi.fn(options.socketUrl ?? (async (kind: string, profile: string) => `wss://example.test/api/audio/${kind}?profile=${profile}&ticket=t${FakeSocket.all.length}`));
  const batchCalls: BatchCall[] = [];
  const transcribeBatch = vi.fn(async (profile: string, audio: Uint8Array, signal: AbortSignal) => {
    const call = { profile, audio, signal };
    batchCalls.push(call);
    return options.transcribeBatch ? options.transcribeBatch(call) : 'batch transcript';
  });
  const backend = new ChainedVoiceBackend({
    audio: env,
    socketUrl: socketUrl as never,
    transcribeBatch,
    createSocket: (url) => new FakeSocket(url),
    createPlayer: (_ctx, handlers) => {
      const player = { enqueued: [] as Array<{ length: number; rate: number }>, stopped: false, ended: false, handlers };
      players.push(player);
      return {
        enqueue: (samples: Float32Array, rate: number) => { player.enqueued.push({ length: samples.length, rate }); handlers.onStarted(); },
        end: () => { player.ended = true; },
        stop: () => { player.stopped = true; },
        get queuedSources() { return 0; },
      };
    },
  });
  return { backend, env, context, log, tracks, socketUrl, players, batchCalls, transcribeBatch, emit: (samples: Float32Array) => onSamples(samples) };
}

function dictationHandlers() {
  const events: string[] = [];
  const handlers: DictationHandlers = {
    onListening: () => events.push('listening'),
    onPartial: (text) => events.push(`partial:${text}`),
    onFinal: (text) => events.push(`final:${text}`),
    onError: (error) => events.push(`error:${error.code}`),
    onClosed: () => events.push('closed'),
  };
  return { events, handlers };
}

function speechHandlers() {
  const events: string[] = [];
  const handlers: SpeechHandlers = {
    onStarted: () => events.push('started'),
    onEnded: () => events.push('ended'),
    onFallback: () => events.push('fallback'),
    onError: (error) => events.push(`error:${error.code}`),
    onClosed: () => events.push('closed'),
  };
  return { events, handlers };
}

const scope = { profile: 'default', sessionId: 'sess-1' };

beforeEach(() => { FakeSocket.all = []; });

describe('ChainedVoiceBackend capability', () => {
  it('requires a secure context and a microphone API, with specific reasons', () => {
    expect(makeBackend().backend.capability()).toEqual({ supported: true });
    expect(makeBackend({ secure: false, mic: false }).backend.capability()).toMatchObject({ supported: false, code: 'insecure-context', message: expect.stringMatching(/https/i) });
    expect(makeBackend({ mic: false }).backend.capability()).toMatchObject({ supported: false, code: 'unsupported' });
  });
});

describe('ChainedVoiceBackend dictation', () => {
  it('unlockAudio creates one shared context and resumes it synchronously', () => {
    const { backend, env, context } = makeBackend();
    backend.unlockAudio();
    backend.unlockAudio();
    expect(env.createContext).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalled();
  });

  it('asks for the microphone inside the gesture, then mints the socket for the scope profile', async () => {
    const { backend, env, socketUrl } = makeBackend();
    backend.unlockAudio();
    backend.startDictation({ profile: 'sales-test', sessionId: 's' }, dictationHandlers().handlers);
    expect(env.getUserMedia).toHaveBeenCalledTimes(1); // synchronously, before any await
    expect(socketUrl).not.toHaveBeenCalled();           // no ticket until the mic is granted (30s ticket TTL)
    await flush();
    expect(socketUrl).toHaveBeenCalledWith('transcribe-stream', 'sales-test');
  });

  it('sends sample_rate first, then buffered PCM in order, then reports listening', async () => {
    const { backend, emit } = makeBackend();
    const { events, handlers } = dictationHandlers();
    backend.unlockAudio();
    backend.startDictation(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    expect(socket.binaryType).toBe('arraybuffer');
    emit(Float32Array.from([1])); // arrives while the socket is still connecting
    expect(socket.sent).toHaveLength(0);
    socket.open();
    emit(Float32Array.from([-1]));
    expect(socket.json()).toEqual([{ sample_rate: 48000 }]);
    expect(socket.sent[0]).toBe('{"sample_rate":48000}');
    expect(socket.binary().map((frame) => Array.from(frame))).toEqual([[0xff, 0x7f], [0x00, 0x80]]);
    expect(events).toEqual(['listening']);
  });

  it('routes partial and final transcripts, then releases the microphone and closes the socket', async () => {
    const { backend, log } = makeBackend();
    const { events, handlers } = dictationHandlers();
    backend.unlockAudio();
    backend.startDictation(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    socket.serverSends(JSON.stringify({ type: 'partial', text: 'hel' }));
    socket.serverSends(JSON.stringify({ type: 'final', transcript: 'hello', provider: 'x' }));
    socket.serverCloses();
    expect(events).toEqual(['listening', 'partial:hel', 'final:hello']);
    expect(socket.closedWith).toBeDefined();
    expect(log).toContain('track.stop');
  });

  it('finish() stops the microphone and sends eos but keeps the socket for the final', async () => {
    const { backend, log } = makeBackend();
    const { handlers } = dictationHandlers();
    backend.unlockAudio();
    const session = backend.startDictation(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    session.finish();
    expect(log).toContain('track.stop');
    expect(socket.json()).toEqual([{ sample_rate: 48000 }, { eos: true }]);
    expect(socket.closedWith).toBeUndefined();
  });

  it('finish() before the socket is open still sends sample_rate first, then buffered PCM, then eos', async () => {
    const { backend, emit } = makeBackend();
    const { handlers } = dictationHandlers();
    backend.unlockAudio();
    const session = backend.startDictation(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    emit(Float32Array.from([1]));
    session.finish();
    emit(Float32Array.from([-1])); // after finish: the microphone is released, nothing more is sent
    socket.open();
    expect(socket.sent[0]).toBe('{"sample_rate":48000}');
    expect(socket.binary().map((frame) => Array.from(frame))).toEqual([[0xff, 0x7f]]);
    expect(socket.json()).toEqual([{ sample_rate: 48000 }, { eos: true }]);
  });

  it('cancel() releases the microphone, drops the socket without eos, and goes silent', async () => {
    const { backend, log } = makeBackend();
    const { events, handlers } = dictationHandlers();
    backend.unlockAudio();
    const session = backend.startDictation(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    session.cancel();
    socket.serverSends(JSON.stringify({ type: 'final', transcript: 'late' }));
    socket.serverCloses();
    expect(socket.closedWith).toBeDefined();
    expect(socket.json().some((frame) => frame.eos)).toBe(false);
    expect(log).toContain('track.stop');
    expect(events).toEqual(['listening']);
  });

  it('cancel() while the permission prompt is open never creates a socket and stops the stream when granted', async () => {
    let grant: (stream: MediaStream) => void = () => undefined;
    const pending = new Promise<MediaStream>((resolve) => { grant = resolve; });
    const { backend, log, tracks, socketUrl } = makeBackend({ getUserMedia: () => pending });
    const { events, handlers } = dictationHandlers();
    backend.unlockAudio();
    const session = backend.startDictation(scope, handlers);
    session.cancel();
    grant({ getTracks: () => tracks } as unknown as MediaStream);
    await flush();
    expect(log).toContain('track.stop');
    expect(socketUrl).not.toHaveBeenCalled();
    expect(FakeSocket.all).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it('microphone denial is reported once and no ticket is minted', async () => {
    const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    const { backend, socketUrl } = makeBackend({ getUserMedia: async () => { throw denied; } });
    const { events, handlers } = dictationHandlers();
    backend.unlockAudio();
    backend.startDictation(scope, handlers);
    await flush();
    expect(events).toEqual(['error:permission-denied']);
    expect(socketUrl).not.toHaveBeenCalled();
  });

  it('a failed ticket mint reports an STT failure and releases the microphone', async () => {
    const { backend, log } = makeBackend({ socketUrl: async () => { throw new Error('ticket refused'); } });
    const { events, handlers } = dictationHandlers();
    backend.unlockAudio();
    backend.startDictation(scope, handlers);
    await flush();
    expect(events).toEqual(['error:stt-failed']);
    expect(log).toContain('track.stop');
  });

  it('a generic server error frame is still an STT failure and closes everything', async () => {
    const { backend, log, transcribeBatch } = makeBackend();
    const { events, handlers } = dictationHandlers();
    backend.unlockAudio();
    backend.startDictation(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    socket.serverSends(JSON.stringify({ type: 'error', message: 'provider quota exceeded' }));
    socket.serverCloses();
    expect(events).toEqual(['listening', 'error:stt-failed']);
    expect(socket.closedWith).toBeDefined();
    expect(log).toContain('track.stop');
    expect(transcribeBatch).not.toHaveBeenCalled();
  });

  it('an unexpected close before the final reports closed once and releases the microphone', async () => {
    const { backend, log } = makeBackend();
    const { events, handlers } = dictationHandlers();
    backend.unlockAudio();
    backend.startDictation(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    socket.serverCloses();
    socket.serverCloses();
    expect(events).toEqual(['listening', 'closed']);
    expect(log).toContain('track.stop');
  });
});

const NO_LIVE_STT = JSON.stringify({ type: 'error', message: 'no live STT for the configured provider' });

describe('ChainedVoiceBackend batch fallback (server has no live STT)', () => {
  async function startFallback(options: Parameters<typeof makeBackend>[0] = {}) {
    const harness = makeBackend(options);
    const { events, handlers } = dictationHandlers();
    harness.backend.unlockAudio();
    const session = harness.backend.startDictation({ profile: 'sales-test', sessionId: 's' }, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    return { ...harness, events, session, socket };
  }
  const pcmOf = (call: BatchCall) => call.audio.subarray(44);

  it('the documented no-live-STT frame switches to batch: still listening, mic open, no error', async () => {
    const { events, log, socket, transcribeBatch } = await startFallback();
    socket.serverSends(NO_LIVE_STT);
    socket.serverCloses();
    expect(events).toEqual(['listening']);
    expect(log).not.toContain('track.stop');
    expect(transcribeBatch).not.toHaveBeenCalled();
    expect(socket.closedWith).toBeDefined(); // the streaming socket is dropped
  });

  it('keeps capturing until finish(), then releases the mic first and batch-transcribes a mono 16-bit WAV for the scope profile', async () => {
    const { events, log, socket, session, emit, batchCalls, transcribeBatch } = await startFallback();
    emit(Float32Array.from([1]));          // sent live before the capability frame arrived
    socket.serverSends(NO_LIVE_STT);
    emit(Float32Array.from([-1]));         // captured after the switch
    expect(socket.binary()).toHaveLength(1); // nothing more is streamed once in fallback
    transcribeBatch.mockImplementationOnce(async (profile, audio, signal) => {
      expect(log).toContain('track.stop'); // microphone released before the request goes out
      batchCalls.push({ profile, audio, signal });
      return 'hello from batch';
    });
    session.finish();
    await flush();
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0].profile).toBe('sales-test');
    const wav = batchCalls[0].audio;
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(new DataView(wav.buffer, wav.byteOffset).getUint32(24, true)).toBe(48000);
    expect(Array.from(pcmOf(batchCalls[0]))).toEqual([0xff, 0x7f, 0x00, 0x80]);
    expect(events).toEqual(['listening', 'final:hello from batch']);
    expect(socket.json().some((frame) => frame.eos)).toBe(false);
  });

  it('a socket close after the signal neither undoes the fallback nor reports closed', async () => {
    const { events, socket, session, batchCalls, emit } = await startFallback();
    emit(Float32Array.from([0.5]));
    socket.serverSends(NO_LIVE_STT);
    socket.serverCloses();
    socket.serverCloses();
    session.finish();
    await flush();
    expect(batchCalls).toHaveLength(1);
    expect(events).toEqual(['listening', 'final:batch transcript']);
  });

  it('finish() before the capability frame arrives still falls back and transcribes once the signal comes', async () => {
    const { events, socket, session, emit, batchCalls, log } = await startFallback();
    emit(Float32Array.from([1]));
    session.finish(); // eos goes to the (not yet answering) stream
    expect(log).toContain('track.stop');
    expect(batchCalls).toHaveLength(0);
    socket.serverSends(NO_LIVE_STT);
    await flush();
    expect(batchCalls).toHaveLength(1);
    expect(Array.from(pcmOf(batchCalls[0]))).toEqual([0xff, 0x7f]);
    expect(events).toEqual(['listening', 'final:batch transcript']);
  });

  it('finish() before the socket even opens keeps the recording for a later signal', async () => {
    const harness = makeBackend();
    const { events, handlers } = dictationHandlers();
    harness.backend.unlockAudio();
    const session = harness.backend.startDictation(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    harness.emit(Float32Array.from([1]));
    session.finish();
    socket.open();
    socket.serverSends(NO_LIVE_STT);
    await flush();
    expect(harness.batchCalls).toHaveLength(1);
    expect(Array.from(pcmOf(harness.batchCalls[0]))).toEqual([0xff, 0x7f]);
    expect(events).toEqual(['listening', 'final:batch transcript']);
  });

  it('a blank batch transcript stays blank (final with empty text)', async () => {
    const { events, session, emit } = await startFallback({ transcribeBatch: async () => '' });
    emit(Float32Array.from([0.1]));
    (FakeSocket.all[0]).serverSends(NO_LIVE_STT);
    session.finish();
    await flush();
    expect(events).toEqual(['listening', 'final:']);
  });

  it('nothing captured means a blank final without calling the server', async () => {
    const { events, session, socket, transcribeBatch } = await startFallback();
    socket.serverSends(NO_LIVE_STT);
    session.finish();
    await flush();
    expect(transcribeBatch).not.toHaveBeenCalled();
    expect(events).toEqual(['listening', 'final:']);
  });

  it('a batch failure is an STT failure with credentials redacted, and reported once', async () => {
    const harness = makeBackend({ transcribeBatch: async () => { throw new Error('boom token=SECRETTOKEN'); } });
    const { events, handlers } = dictationHandlers();
    const messages: string[] = [];
    harness.backend.unlockAudio();
    const session = harness.backend.startDictation(scope, { ...handlers, onError: (error) => { events.push(`error:${error.code}`); messages.push(error.message); } });
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    harness.emit(Float32Array.from([0.1]));
    socket.serverSends(NO_LIVE_STT);
    session.finish();
    await flush();
    expect(events).toEqual(['listening', 'error:stt-failed']);
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain('SECRETTOKEN');
  });

  it('cancel() during the batch request aborts it and a late transcript is ignored', async () => {
    let resolve: (text: string) => void = () => undefined;
    const slow = new Promise<string>((r) => { resolve = r; });
    const { events, session, socket, emit, batchCalls } = await startFallback({ transcribeBatch: () => slow });
    emit(Float32Array.from([0.1]));
    socket.serverSends(NO_LIVE_STT);
    session.finish();
    await flush();
    expect(batchCalls[0].signal.aborted).toBe(false);
    session.cancel();
    expect(batchCalls[0].signal.aborted).toBe(true);
    resolve('too late');
    await flush();
    expect(events).toEqual(['listening']);
  });

  it('dispose() during the batch request aborts it and a late transcript is ignored', async () => {
    let resolve: (text: string) => void = () => undefined;
    const slow = new Promise<string>((r) => { resolve = r; });
    const { backend, events, session, socket, emit, batchCalls } = await startFallback({ transcribeBatch: () => slow });
    emit(Float32Array.from([0.1]));
    socket.serverSends(NO_LIVE_STT);
    session.finish();
    await flush();
    backend.dispose();
    expect(batchCalls[0].signal.aborted).toBe(true);
    resolve('too late');
    await flush();
    expect(events).toEqual(['listening']);
  });

  it('a late rejection after cancel is not reported', async () => {
    let reject: (error: Error) => void = () => undefined;
    const slow = new Promise<string>((_, r) => { reject = r; });
    const { events, session, socket, emit } = await startFallback({ transcribeBatch: () => slow });
    emit(Float32Array.from([0.1]));
    socket.serverSends(NO_LIVE_STT);
    session.finish();
    await flush();
    session.cancel();
    reject(new DOMException('aborted', 'AbortError'));
    await flush();
    expect(events).toEqual(['listening']);
  });

  it('cancel() in fallback before Stop releases the mic and never calls the server', async () => {
    const { events, log, session, socket, emit, transcribeBatch } = await startFallback();
    emit(Float32Array.from([0.1]));
    socket.serverSends(NO_LIVE_STT);
    session.cancel();
    await flush();
    expect(log).toContain('track.stop');
    expect(transcribeBatch).not.toHaveBeenCalled();
    expect(events).toEqual(['listening']);
  });

  it('a generic error after the signal path was never taken stays an error and does not batch', async () => {
    const { events, session, socket, emit, transcribeBatch } = await startFallback();
    emit(Float32Array.from([0.1]));
    socket.serverSends(JSON.stringify({ type: 'error', message: 'No live STT for the configured provider.' }));
    session.finish();
    await flush();
    expect(events).toEqual(['listening', 'error:stt-failed']);
    expect(transcribeBatch).not.toHaveBeenCalled();
  });

  it('a partial or final from a live stream still wins: no batch call', async () => {
    const { events, socket, session, emit, transcribeBatch } = await startFallback();
    emit(Float32Array.from([0.1]));
    socket.serverSends(JSON.stringify({ type: 'partial', text: 'hi' }));
    session.finish();
    socket.serverSends(JSON.stringify({ type: 'final', transcript: 'hi there' }));
    await flush();
    expect(events).toEqual(['listening', 'partial:hi', 'final:hi there']);
    expect(transcribeBatch).not.toHaveBeenCalled();
  });

  describe('upload cap (server rejects raw audio above 25 MiB)', () => {
    const chunk = () => new Float32Array(1_000_000); // 2 MB of s16 per emit

    it('exceeding the cap while in fallback fails safely, releases the mic, and never uploads', async () => {
      const { events, log, socket, emit, transcribeBatch } = await startFallback();
      socket.serverSends(NO_LIVE_STT);
      for (let i = 0; i < 14; i += 1) emit(chunk()); // 28 MB
      expect(events).toEqual(['listening', 'error:stt-failed']);
      expect(log).toContain('track.stop');
      await flush();
      expect(transcribeBatch).not.toHaveBeenCalled();
    });

    it('a recording that overflowed before the signal arrived fails instead of sending a truncated clip', async () => {
      const { events, socket, session, emit, transcribeBatch } = await startFallback();
      for (let i = 0; i < 14; i += 1) emit(chunk());
      expect(events).toEqual(['listening']); // live streaming has no cap
      socket.serverSends(NO_LIVE_STT);
      session.finish();
      await flush();
      expect(events).toEqual(['listening', 'error:stt-failed']);
      expect(transcribeBatch).not.toHaveBeenCalled();
    });

    it('a long live-streaming session is not capped', async () => {
      const { events, socket, emit } = await startFallback();
      socket.serverSends(JSON.stringify({ type: 'partial', text: 'x' }));
      for (let i = 0; i < 14; i += 1) emit(chunk());
      expect(events).toEqual(['listening', 'partial:x']);
      expect(socket.binary()).toHaveLength(14);
    });

    it('just under the cap uploads a WAV that fits the raw limit', async () => {
      const { events, socket, session, emit, batchCalls } = await startFallback();
      socket.serverSends(NO_LIVE_STT);
      for (let i = 0; i < 12; i += 1) emit(chunk()); // 24 MB < 25 MiB
      session.finish();
      await flush();
      expect(batchCalls[0].audio.byteLength).toBeLessThanOrEqual(25 * 1024 * 1024);
      expect(events).toEqual(['listening', 'final:batch transcript']);
    });
  });
});

describe('ChainedVoiceBackend speech', () => {
  it('opens the speak socket for the scope profile and flushes queued frames in order once open', async () => {
    const { backend, socketUrl } = makeBackend();
    backend.unlockAudio();
    const session = backend.openSpeech({ profile: 'default', sessionId: 's' }, speechHandlers().handlers);
    session.speak('Hello ');
    session.speak('world. ');
    session.finish();
    await flush();
    expect(socketUrl).toHaveBeenCalledWith('speak-stream', 'default');
    const socket = FakeSocket.all[0];
    expect(socket.sent).toHaveLength(0);
    socket.open();
    expect(socket.json()).toEqual([{ text: 'Hello ' }, { text: 'world. ' }, { done: true }]);
  });

  it('plays PCM at the rate from the start frame, reports started, and ends after the queue drains', async () => {
    const { backend, players } = makeBackend();
    const { events, handlers } = speechHandlers();
    backend.unlockAudio();
    backend.openSpeech(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    socket.serverSends(JSON.stringify({ type: 'start', sample_rate: 24000, channels: 1 }));
    socket.serverSends(new Uint8Array([0, 0x40, 0, 0x40]).buffer);
    expect(players[0].enqueued).toEqual([{ length: 2, rate: 24000 }]);
    expect(events).toEqual(['started']);
    socket.serverSends(JSON.stringify({ type: 'end' }));
    expect(players[0].ended).toBe(true);
    players[0].handlers.onDrained();
    expect(events).toEqual(['started', 'ended']);
    expect(socket.closedWith).toBeDefined();
    socket.serverCloses();
    expect(events).toEqual(['started', 'ended']); // a close after a clean end is not a failure
  });

  it('fallback leaves the reply text-only: reported once, nothing is played or retried', async () => {
    const { backend, players, socketUrl } = makeBackend();
    const { events, handlers } = speechHandlers();
    backend.unlockAudio();
    backend.openSpeech(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    socket.serverSends(JSON.stringify({ type: 'fallback' }));
    socket.serverCloses();
    expect(events).toEqual(['fallback']);
    expect(players.every((player) => player.enqueued.length === 0)).toBe(true);
    await flush();
    expect(socketUrl).toHaveBeenCalledTimes(1);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('a mid-stream fallback after audio was queued stops the player, closes the socket, and nothing further plays or reports', async () => {
    const { backend, players } = makeBackend();
    const { events, handlers } = speechHandlers();
    backend.unlockAudio();
    const session = backend.openSpeech(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    socket.serverSends(JSON.stringify({ type: 'start', sample_rate: 24000, channels: 1 }));
    socket.serverSends(new Uint8Array([0, 0x40, 0, 0x40]).buffer);
    expect(players[0].enqueued).toHaveLength(1);
    expect(players[0].stopped).toBe(false);
    socket.serverSends(JSON.stringify({ type: 'fallback' }));
    expect(players[0].stopped).toBe(true);
    expect(socket.closedWith).toBeDefined();
    expect(events).toEqual(['started', 'fallback']);
    // The controller's follow-up speech-stop / close must stay a harmless no-op.
    session.stop();
    session.close();
    // Late audio, a late drain and a late socket close must neither play nor report anything.
    socket.serverSends(new Uint8Array([0, 0x40]).buffer);
    players[0].handlers.onDrained();
    socket.serverCloses();
    expect(players[0].enqueued).toHaveLength(1);
    expect(events).toEqual(['started', 'fallback']);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('stop() sends {stop:true}, silences playback, closes the socket, and ignores later audio', async () => {
    const { backend, players } = makeBackend();
    const { events, handlers } = speechHandlers();
    backend.unlockAudio();
    const session = backend.openSpeech(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    socket.serverSends(JSON.stringify({ type: 'start', sample_rate: 24000, channels: 1 }));
    socket.serverSends(new Uint8Array([0, 0x40]).buffer);
    session.stop();
    expect(socket.json()).toContainEqual({ stop: true });
    expect(players[0].stopped).toBe(true);
    expect(socket.closedWith).toBeDefined();
    socket.serverSends(new Uint8Array([0, 0x40]).buffer);
    socket.serverCloses();
    expect(players[0].enqueued).toHaveLength(1);
    expect(events).toEqual(['started']);
  });

  it('stop() before the socket opens sends nothing and closes it as soon as it exists', async () => {
    const { backend } = makeBackend();
    backend.unlockAudio();
    const session = backend.openSpeech(scope, speechHandlers().handlers);
    session.speak('never spoken');
    session.stop();
    await flush();
    const socket = FakeSocket.all[0];
    if (socket) {
      socket.open();
      expect(socket.json().some((frame) => 'text' in frame)).toBe(false);
      expect(socket.closedWith).toBeDefined();
    }
  });

  it('an unexpected close mid-reply reports closed once and silences playback', async () => {
    const { backend, players } = makeBackend();
    const { events, handlers } = speechHandlers();
    backend.unlockAudio();
    backend.openSpeech(scope, handlers);
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    socket.serverSends(JSON.stringify({ type: 'start', sample_rate: 24000, channels: 1 }));
    socket.serverSends(new Uint8Array([0, 0x40]).buffer);
    socket.serverCloses();
    expect(events).toEqual(['started', 'closed']);
    expect(players[0].stopped).toBe(true);
  });

  it('a ticket failure for speech is reported as an error, never thrown', async () => {
    const { backend } = makeBackend({ socketUrl: async () => { throw new Error('nope'); } });
    const { events, handlers } = speechHandlers();
    backend.unlockAudio();
    backend.openSpeech(scope, handlers);
    await flush();
    expect(events).toEqual(['error:internal']);
  });
});

describe('ChainedVoiceBackend error redaction', () => {
  const leaky = "Failed to construct 'WebSocket': wss://h.example/api/audio/speak-stream?profile=default&ticket=SECRETTICKET&token=SECRETTOKEN";

  it('never surfaces a credential-bearing URL from a dictation or speech failure', async () => {
    const messages: string[] = [];
    const dictation = makeBackend({ socketUrl: async () => { throw new Error(leaky); } });
    dictation.backend.unlockAudio();
    dictation.backend.startDictation(scope, { ...dictationHandlers().handlers, onError: (error) => messages.push(error.message) });
    const speech = makeBackend({ socketUrl: async () => { throw new Error(leaky); } });
    speech.backend.unlockAudio();
    speech.backend.openSpeech(scope, { ...speechHandlers().handlers, onError: (error) => messages.push(error.message) });
    await flush();
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).not.toContain('SECRETTICKET');
      expect(message).not.toContain('SECRETTOKEN');
    }
  });

  it('redacts a credential echoed in a server error frame', async () => {
    const { backend } = makeBackend();
    const messages: string[] = [];
    backend.unlockAudio();
    backend.startDictation(scope, { ...dictationHandlers().handlers, onError: (error) => messages.push(error.message) });
    await flush();
    const socket = FakeSocket.all[FakeSocket.all.length - 1];
    socket.open();
    socket.serverSends(JSON.stringify({ type: 'error', message: leaky }));
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain('SECRETTICKET');
  });
});

describe('ChainedVoiceBackend dispose', () => {
  it('closes every socket, the microphone, queued audio and the audio context; later frames are ignored', async () => {
    const { backend, log, context, players, emit } = makeBackend();
    backend.unlockAudio();
    const dictation = dictationHandlers();
    const speech = speechHandlers();
    backend.startDictation(scope, dictation.handlers);
    backend.openSpeech(scope, speech.handlers);
    await flush();
    const stt = FakeSocket.all.find((socket) => socket.url.includes('transcribe-stream'))!;
    const tts = FakeSocket.all.find((socket) => socket.url.includes('speak-stream'))!;
    stt.open();
    tts.open();
    tts.serverSends(JSON.stringify({ type: 'start', sample_rate: 24000, channels: 1 }));
    tts.serverSends(new Uint8Array([0, 0x40]).buffer);
    backend.dispose();
    backend.dispose();
    expect(stt.closedWith).toBeDefined();
    expect(tts.closedWith).toBeDefined();
    expect(log).toContain('track.stop');
    expect(players[0].stopped).toBe(true);
    expect(context.close).toHaveBeenCalledTimes(1);
    const sentBefore = stt.sent.length;
    emit(Float32Array.from([1]));
    expect(stt.sent.length).toBe(sentBefore);
    expect(dictation.events).toEqual(['listening']);
  });
});
