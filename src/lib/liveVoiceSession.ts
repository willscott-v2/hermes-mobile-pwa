// WebRTC transport for one GPT-Live session. Copies the desktop handshake sequence
// (apps/desktop/src/lib/voice-live.ts): peer → mic track → 'oai-events' data channel → offer →
// local description → ICE gathering (10 s cap) → SDP exchange through the gateway → answer.
//
// Every browser global is injected (`LiveRtcEnv`) so the whole flow runs under vitest with fakes.
// Nothing here knows about Hermes sessions, delegation routing or React: it reports data-channel
// events upward and exposes the small command surface the controller drives.

export interface LiveTranscriptFragment { speaker: 'user' | 'assistant'; text: string; startMs: number; endMs: number }

export interface LiveSessionHandlers {
  onStarted(liveSessionId: string | null): void;
  onTranscript(fragment: LiveTranscriptFragment): void;
  // The voice model asked Hermes for help. The delegation carries no text: `context` is the recent
  // transcript window (oldest first, bounded).
  onDelegation(delegationId: string, context: LiveTranscriptFragment[]): void;
  onSpeakingChange(speaking: boolean): void;
  onError(message: string): void;            // vendor-side, non-fatal
  onClosed(reason: string): void;            // `session.closed`, transport drop, or our own close
}

// Minimal structural types so tests can hand in plain fakes. Listener signatures are deliberately
// loose (`(event?: any) => void`) so the real RTCPeerConnection / RTCDataChannel and simple fakes
// both satisfy them; the session narrows the event shape where it reads it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (event?: any) => void;

export interface DataChannelLike {
  readyState: string;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: Listener): void;
}

export interface TrackLike { enabled: boolean; stop(): void }
export interface MediaStreamLike { getAudioTracks(): TrackLike[]; getTracks(): TrackLike[] }

export interface PeerLike {
  connectionState: string;
  iceGatheringState: string;
  localDescription: { sdp?: string } | null;
  addTrack(track: TrackLike, stream: MediaStreamLike): void;
  createDataChannel(label: string): DataChannelLike;
  createOffer(): Promise<{ type?: string; sdp?: string }>;
  setLocalDescription(description: { type?: string; sdp?: string }): Promise<void>;
  setRemoteDescription(description: { type: 'answer'; sdp: string }): Promise<void>;
  close(): void;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}

export interface PlaybackLike {
  muted: boolean;
  attach(track: TrackLike): void;  // route the remote track to the speaker
  detach(): void;
}

export interface SpeakingProbeLike { stop(): void }

export interface LiveRtcEnv {
  createPeer(): PeerLike;
  getMicrophone(): Promise<MediaStreamLike>;
  createPlayback(): PlaybackLike;
  // Optional loudness probe on the remote track; returns a stopper. Absent → no speaking signal.
  probeSpeaking?(track: TrackLike, onChange: (speaking: boolean) => void): SpeakingProbeLike;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface LiveSessionOptions {
  iceGatherTimeoutMs?: number; // default 10 s (desktop parity)
  closeGraceMs?: number;       // default 15 s: wait for `session.closed` after `session.close`
}

const ICE_GATHER_TIMEOUT_MS = 10_000;
const CLOSE_GRACE_MS = 15_000;
const APPEND_CHAR_LIMIT = 1_400;   // vendor cap ~500 tokens per append
const CONTEXT_WINDOW_MS = 5 * 60_000;
const CONTEXT_MAX_FRAGMENTS = 80;
const TRANSCRIPT_KEEP = 1_500;

export class LiveVoiceSessionError extends Error {
  constructor(public readonly code: 'permission-denied' | 'no-microphone' | 'unsupported' | 'session-failed', message: string) {
    super(message);
    this.name = 'LiveVoiceSessionError';
  }
}

// Split a reply into append-sized chunks on sentence boundaries (desktop parity).
export function chunkForCommentary(text: string, limit = APPEND_CHAR_LIMIT): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > limit) {
      if (current) { chunks.push(current); current = ''; }
      for (let index = 0; index < sentence.length; index += limit) chunks.push(sentence.slice(index, index + limit));
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > limit) { chunks.push(current); current = sentence; } else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}

// Classify a getUserMedia / start failure into the voice error vocabulary.
export function classifyMediaError(error: unknown): LiveVoiceSessionError {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error && error.message ? error.message : 'Microphone unavailable.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new LiveVoiceSessionError('permission-denied', 'Microphone access was denied.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new LiveVoiceSessionError('no-microphone', 'No microphone was found.');
  if (name === 'NotSupportedError') return new LiveVoiceSessionError('unsupported', message);
  return new LiveVoiceSessionError('session-failed', message);
}

export class LiveVoiceSession {
  private peer: PeerLike | null = null;
  private events: DataChannelLike | null = null;
  private microphone: MediaStreamLike | null = null;
  private playback: PlaybackLike | null = null;
  private probe: SpeakingProbeLike | null = null;
  private closeTimer: number | null = null;
  private finalized = false;
  private started = false;
  private eventCounter = 0;
  private transcript: LiveTranscriptFragment[] = [];
  private readonly iceTimeout: number;
  private readonly closeGrace: number;
  liveSessionId: string | null = null;

  constructor(private readonly env: LiveRtcEnv, private readonly handlers: LiveSessionHandlers, options: LiveSessionOptions = {}) {
    this.iceTimeout = options.iceGatherTimeoutMs ?? ICE_GATHER_TIMEOUT_MS;
    this.closeGrace = options.closeGraceMs ?? CLOSE_GRACE_MS;
  }

  get connected(): boolean {
    return this.started && this.events?.readyState === 'open';
  }

  // `exchange` performs the authenticated POST through the gateway and returns the answer SDP. The
  // offer is handed over byte-exact. Any throw here (503/502/auth/timeout) propagates to the caller
  // after local resources are released.
  async start(exchange: (offerSdp: string) => Promise<{ sessionId: string | null; sdp: string }>): Promise<void> {
    if (this.peer) throw new LiveVoiceSessionError('session-failed', 'Live voice session already started.');
    const peer = this.env.createPeer();
    this.peer = peer;
    this.playback = this.env.createPlayback();
    peer.addEventListener('track', (event: { track: TrackLike }) => {
      if (this.finalized) return;
      this.playback?.attach(event.track);
      this.probe?.stop();
      this.probe = this.env.probeSpeaking?.(event.track, (speaking) => { if (!this.finalized) this.handlers.onSpeakingChange(speaking); }) ?? null;
    });
    peer.addEventListener('connectionstatechange', () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected' || peer.connectionState === 'closed') this.finish('connection_lost');
    });
    try {
      try {
        this.microphone = await this.env.getMicrophone();
      } catch (error) {
        throw classifyMediaError(error);
      }
      for (const track of this.microphone.getAudioTracks()) peer.addTrack(track, this.microphone);
      // Register the data channel before the offer so its m-line is negotiated.
      const events = peer.createDataChannel('oai-events');
      this.events = events;
      events.addEventListener('message', ({ data }: { data: unknown }) => this.handleEvent(String(data)));
      events.addEventListener('close', () => { if (!this.finalized) this.finish('connection_lost'); });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await this.waitForIceGathering(peer);
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new LiveVoiceSessionError('session-failed', 'Missing local SDP offer.');
      const answer = await exchange(sdp);
      if (this.finalized) return; // released while the POST was in flight
      this.liveSessionId = answer.sessionId;
      await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    } catch (error) {
      this.finish('start_failed', false);
      throw error;
    }
  }

  private waitForIceGathering(peer: PeerLike): Promise<void> {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = this.env.setTimeout(() => { peer.removeEventListener('icegatheringstatechange', onState); resolve(); }, this.iceTimeout); // trickle is fine
      const onState = () => {
        if (peer.iceGatheringState !== 'complete') return;
        this.env.clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', onState);
        resolve();
      };
      peer.addEventListener('icegatheringstatechange', onState);
      peer.addEventListener('connectionstatechange', () => {
        if (peer.connectionState === 'failed') { this.env.clearTimeout(timer); reject(new LiveVoiceSessionError('session-failed', 'WebRTC connection failed.')); }
      });
    });
  }

  // Recent conversation, oldest first, bounded by time and count (what a delegation gets).
  contextWindow(): LiveTranscriptFragment[] {
    const last = this.transcript[this.transcript.length - 1];
    if (!last) return [];
    const floor = last.endMs - CONTEXT_WINDOW_MS;
    return this.transcript.filter((fragment) => fragment.endMs >= floor).slice(-CONTEXT_MAX_FRAGMENTS);
  }

  private handleEvent(raw: string): void {
    let event: { type?: string; delta?: string; start_ms?: number; end_ms?: number; delegation?: { id?: string }; error?: { code?: string | null; message?: string }; reason?: string; session?: { id?: string } };
    try { event = JSON.parse(raw); } catch { return; }
    switch (event.type) {
      case 'session.started':
        this.started = true;
        this.liveSessionId = event.session?.id ?? this.liveSessionId;
        this.handlers.onStarted(this.liveSessionId);
        return;
      case 'session.input_transcript.delta':
      case 'session.output_transcript.delta': {
        const fragment: LiveTranscriptFragment = {
          speaker: event.type === 'session.input_transcript.delta' ? 'user' : 'assistant',
          text: event.delta ?? '',
          startMs: event.start_ms ?? 0,
          endMs: event.end_ms ?? 0,
        };
        this.transcript.push(fragment);
        if (this.transcript.length > TRANSCRIPT_KEEP + 500) this.transcript.splice(0, this.transcript.length - TRANSCRIPT_KEEP);
        this.handlers.onTranscript(fragment);
        return;
      }
      case 'session.delegation.created': {
        const id = event.delegation?.id;
        if (id) this.handlers.onDelegation(id, this.contextWindow());
        return;
      }
      case 'error': {
        if (event.error?.code === 'context_injection_incomplete') return; // late appends after close: expected noise
        this.handlers.onError(event.error?.message ?? 'Live voice error.');
        return;
      }
      case 'session.closed':
        this.finish(event.reason ?? 'closed');
        return;
      default:
        return;
    }
  }

  private send(event: Record<string, unknown>): boolean {
    if (!this.events || this.events.readyState !== 'open') return false;
    this.events.send(JSON.stringify(event));
    return true;
  }

  private nextEventId(prefix: string): string {
    this.eventCounter += 1;
    return `${prefix}_${this.eventCounter}`;
  }

  // Quiet progress for the voice model.
  think(delegationId: string | null, content: string): void {
    const text = content.replace(/\s+/g, ' ').trim().slice(0, APPEND_CHAR_LIMIT);
    if (text) this.send({ type: 'session.thinking.append', delegation_id: delegationId, event_id: this.nextEventId('think'), content: text });
  }

  // A result the voice should say aloud (paraphrased), sentence-chunked.
  say(delegationId: string | null, content: string): void {
    for (const chunk of chunkForCommentary(content)) {
      this.send({ type: 'session.commentary.append', delegation_id: delegationId, event_id: this.nextEventId('say'), content: chunk });
    }
  }

  instruct(content: string): void {
    const text = content.trim().slice(0, APPEND_CHAR_LIMIT);
    if (text) this.send({ type: 'session.instructions.append', delegation_id: null, event_id: this.nextEventId('instr'), content: text });
  }

  // Local track first (instant), then the vendor event.
  setMicMuted(muted: boolean): void {
    for (const track of this.microphone?.getAudioTracks() ?? []) track.enabled = !muted;
    this.send({ type: muted ? 'session.input_audio.mute' : 'session.input_audio.unmute', event_id: this.nextEventId(muted ? 'mute' : 'unmute') });
  }

  // Barge-in: purely local, never a vendor or agent event.
  setPlaybackMuted(muted: boolean): void {
    if (this.playback) this.playback.muted = muted;
  }

  // Graceful close: ask for `session.closed`; tear down after it or after the grace period.
  close(): void {
    if (this.finalized) return;
    if (!this.send({ type: 'session.close' })) { this.finish('close_requested'); return; }
    this.closeTimer = this.env.setTimeout(() => this.finish('close_requested'), this.closeGrace);
  }

  // Immediate release (scope change, hidden teardown, reset): no grace, no provider round-trip.
  release(): void {
    this.send({ type: 'session.close' });
    this.finish('close_requested');
  }

  private finish(reason: string, notify = true): void {
    if (this.finalized) return;
    this.finalized = true;
    if (this.closeTimer !== null) { this.env.clearTimeout(this.closeTimer); this.closeTimer = null; }
    this.probe?.stop();
    this.probe = null;
    for (const track of this.microphone?.getTracks() ?? []) track.stop();
    this.microphone = null;
    this.events?.close();
    this.events = null;
    this.peer?.close();
    this.playback?.detach();
    this.playback = null;
    if (notify) this.handlers.onClosed(reason);
  }
}
