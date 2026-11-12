// Deterministic LiveRtcEnv for unit tests: no WebRTC, microphone, or audio element. Every call is
// recorded so tests can assert the handshake order, what went over the data channel, and that every
// track/peer/playback was released.

import type { DataChannelLike, LiveRtcEnv, MediaStreamLike, PeerLike, PlaybackLike, TrackLike } from './liveVoiceSession';

export class FakeTrack implements TrackLike {
  enabled = true;
  stopped = false;
  constructor(readonly kind: 'mic' | 'remote' = 'mic') {}
  stop() { this.stopped = true; }
}

export class FakeStream implements MediaStreamLike {
  constructor(readonly tracks: FakeTrack[] = [new FakeTrack('mic')]) {}
  getAudioTracks() { return this.tracks; }
  getTracks() { return this.tracks; }
}

export class FakeChannel implements DataChannelLike {
  readyState = 'connecting';
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, Array<(event?: unknown) => void>> = {};
  constructor(readonly label: string) {}
  send(data: string) { if (this.readyState !== 'open') throw new Error('channel not open'); this.sent.push(data); }
  close() { this.closed = true; this.readyState = 'closed'; }
  addEventListener(type: string, listener: (event?: unknown) => void) { (this.listeners[type] ??= []).push(listener); }
  open() { this.readyState = 'open'; for (const fn of this.listeners.open ?? []) fn(); }
  serverSends(event: Record<string, unknown>) { for (const fn of this.listeners.message ?? []) fn({ data: JSON.stringify(event) }); }
  serverCloses() { this.readyState = 'closed'; for (const fn of this.listeners.close ?? []) fn(); }
  json(): Array<Record<string, unknown>> { return this.sent.map((frame) => JSON.parse(frame)); }
  types(): string[] { return this.json().map((frame) => String(frame.type)); }
}

export class FakePeer implements PeerLike {
  connectionState = 'new';
  iceGatheringState = 'new';
  localDescription: { sdp?: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  tracks: TrackLike[] = [];
  channel: FakeChannel | null = null;
  closed = false;
  log: string[] = [];
  private listeners: Record<string, Array<(event?: unknown) => void>> = {};
  constructor(readonly offerSdp = 'v=0\r\no=- offer\r\n', readonly gatherImmediately = true) {}
  addTrack(track: TrackLike) { this.log.push('addTrack'); this.tracks.push(track); }
  createDataChannel(label: string) { this.log.push(`createDataChannel:${label}`); this.channel = new FakeChannel(label); return this.channel; }
  async createOffer() { this.log.push('createOffer'); return { type: 'offer', sdp: this.offerSdp }; }
  async setLocalDescription(description: { sdp?: string }) {
    this.log.push('setLocalDescription');
    this.localDescription = description;
    if (this.gatherImmediately) { this.iceGatheringState = 'complete'; }
  }
  async setRemoteDescription(description: { type: 'answer'; sdp: string }) { this.log.push('setRemoteDescription'); this.remoteDescription = description; }
  close() { this.log.push('close'); this.closed = true; this.connectionState = 'closed'; }
  addEventListener(type: string, listener: (event?: unknown) => void) { (this.listeners[type] ??= []).push(listener); }
  removeEventListener(type: string, listener: (event?: unknown) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter((fn) => fn !== listener); }
  gatheringComplete() { this.iceGatheringState = 'complete'; for (const fn of this.listeners.icegatheringstatechange ?? []) fn(); }
  remoteTrack(track = new FakeTrack('remote')) { for (const fn of this.listeners.track ?? []) fn({ track }); return track; }
  connection(state: string) { this.connectionState = state; for (const fn of this.listeners.connectionstatechange ?? []) fn(); }
}

export class FakePlayback implements PlaybackLike {
  muted = false;
  attached: TrackLike | null = null;
  detached = 0;
  attach(track: TrackLike) { this.attached = track; }
  detach() { this.attached = null; this.detached += 1; }
}

export class FakeLiveRtcEnv implements LiveRtcEnv {
  peers: FakePeer[] = [];
  playbacks: FakePlayback[] = [];
  streams: FakeStream[] = [];
  probes: Array<{ track: TrackLike; onChange: (speaking: boolean) => void; stopped: boolean }> = [];
  timers = new Map<number, { fn: () => void; ms: number }>();
  micError: Error | null = null;
  gatherImmediately = true;
  private nextTimer = 1;

  createPeer() { const peer = new FakePeer(undefined, this.gatherImmediately); this.peers.push(peer); return peer; }
  async getMicrophone() { if (this.micError) throw this.micError; const stream = new FakeStream(); this.streams.push(stream); return stream; }
  createPlayback() { const playback = new FakePlayback(); this.playbacks.push(playback); return playback; }
  probeSpeaking(track: TrackLike, onChange: (speaking: boolean) => void) {
    const probe = { track, onChange, stopped: false, stop: () => { probe.stopped = true; } };
    this.probes.push(probe);
    return probe;
  }
  setTimeout(fn: () => void, ms: number) { const id = this.nextTimer++; this.timers.set(id, { fn, ms }); return id; }
  clearTimeout(id: number) { this.timers.delete(id); }
  // Fire every pending timer whose delay is ≤ ms (tests advance time explicitly).
  advance(ms: number) {
    for (const [id, timer] of [...this.timers.entries()]) {
      if (timer.ms <= ms) { this.timers.delete(id); timer.fn(); }
    }
  }
  get peer() { return this.peers[this.peers.length - 1]; }
  get playback() { return this.playbacks[this.playbacks.length - 1]; }
  get channel() { return this.peer?.channel ?? null; }
  // Everything the session should have released.
  released(): boolean {
    return this.peers.every((peer) => peer.closed)
      && this.streams.every((stream) => stream.tracks.every((track) => track.stopped))
      && this.playbacks.every((playback) => playback.attached === null)
      && this.probes.every((probe) => probe.stopped);
  }
}

export function mediaError(name: string, message = name): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
