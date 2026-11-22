import { describe, expect, it, vi } from 'vitest';
import { FakeLiveRtcEnv, mediaError } from './fakeLiveRtc';
import { chunkForCommentary, classifyMediaError, LiveSessionHandlers, LiveVoiceSession } from './liveVoiceSession';

function handlers(): LiveSessionHandlers & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string) => (...args: unknown[]) => { (calls[name] ??= []).push(args); };
  return { calls, onStarted: record('onStarted'), onTranscript: record('onTranscript'), onDelegation: record('onDelegation'), onSpeakingChange: record('onSpeakingChange'), onError: record('onError'), onClosed: record('onClosed') };
}

const answer = { sessionId: 'live-42', sdp: 'v=0\r\nanswer\r\n' };

async function started(env = new FakeLiveRtcEnv()) {
  const h = handlers();
  const session = new LiveVoiceSession(env, h);
  const exchange = vi.fn(async () => answer);
  await session.start(exchange);
  env.channel!.open();
  env.channel!.serverSends({ type: 'session.started', session: { id: 'live-42' } });
  return { env, h, session, exchange, channel: env.channel! };
}

describe('LiveVoiceSession handshake', () => {
  it('runs the desktop sequence: mic → track → data channel → offer → local → ICE → exchange → answer', async () => {
    const { env, exchange, session } = await started();
    expect(env.peer.log).toEqual(['addTrack', 'createDataChannel:oai-events', 'createOffer', 'setLocalDescription', 'setRemoteDescription']);
    expect(exchange).toHaveBeenCalledWith('v=0\r\no=- offer\r\n'); // byte-exact, CRLF kept
    expect(env.peer.remoteDescription).toEqual({ type: 'answer', sdp: answer.sdp });
    expect(session.liveSessionId).toBe('live-42');
    expect(session.connected).toBe(true);
  });

  it('waits for ICE gathering, with a capped timeout that still proceeds (trickle)', async () => {
    const env = new FakeLiveRtcEnv();
    env.gatherImmediately = false;
    const session = new LiveVoiceSession(env, handlers(), { iceGatherTimeoutMs: 500 });
    const exchange = vi.fn(async () => answer);
    const starting = session.start(exchange);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(exchange).not.toHaveBeenCalled();
    env.advance(500);
    await starting;
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('microphone denial maps to permission-denied and releases the peer; nothing is exchanged', async () => {
    const env = new FakeLiveRtcEnv();
    env.micError = mediaError('NotAllowedError');
    const h = handlers();
    const session = new LiveVoiceSession(env, h);
    const exchange = vi.fn(async () => answer);
    await expect(session.start(exchange)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(exchange).not.toHaveBeenCalled();
    expect(env.peer.closed).toBe(true);
    expect(h.calls.onClosed).toBeUndefined(); // a failed start reports through the throw, not onClosed
  });

  it('an exchange failure (503/502) releases the mic and peer and rethrows the original error', async () => {
    const env = new FakeLiveRtcEnv();
    const session = new LiveVoiceSession(env, handlers());
    const failure = Object.assign(new Error('not configured'), { status: 503 });
    await expect(session.start(async () => { throw failure; })).rejects.toBe(failure);
    expect(env.released()).toBe(true);
  });

  it('a second start() is refused', async () => {
    const { session } = await started();
    await expect(session.start(async () => answer)).rejects.toThrow(/already started/);
  });

  it('classifyMediaError covers the DOMException names', () => {
    expect(classifyMediaError(mediaError('NotAllowedError')).code).toBe('permission-denied');
    expect(classifyMediaError(mediaError('NotFoundError')).code).toBe('no-microphone');
    expect(classifyMediaError(mediaError('NotSupportedError')).code).toBe('unsupported');
    expect(classifyMediaError(new Error('x')).code).toBe('session-failed');
  });
});

describe('LiveVoiceSession events', () => {
  it('routes transcript deltas and hands a delegation the bounded context window', async () => {
    const { h, channel, session } = await started();
    channel.serverSends({ type: 'session.input_transcript.delta', delta: 'what is ', start_ms: 0, end_ms: 400 });
    channel.serverSends({ type: 'session.input_transcript.delta', delta: 'on my plate', start_ms: 400, end_ms: 900 });
    channel.serverSends({ type: 'session.delegation.created', delegation: { id: 'd1', type: 'client', target: 'hermes' } });
    expect(h.calls.onTranscript).toHaveLength(2);
    expect(h.calls.onDelegation[0][0]).toBe('d1');
    expect(session.contextWindow().map((fragment) => fragment.text).join('')).toBe('what is on my plate');
  });

  it('context window drops fragments older than five minutes and caps at 80', async () => {
    const { channel, session } = await started();
    channel.serverSends({ type: 'session.input_transcript.delta', delta: 'old', start_ms: 0, end_ms: 1000 });
    for (let index = 0; index < 100; index += 1) channel.serverSends({ type: 'session.output_transcript.delta', delta: `f${index}`, start_ms: 400_000 + index, end_ms: 400_000 + index + 1 });
    const window = session.contextWindow();
    expect(window).toHaveLength(80);
    expect(window[0].text).not.toBe('old');
  });

  it('ignores context_injection_incomplete and reports other vendor errors', async () => {
    const { h, channel } = await started();
    channel.serverSends({ type: 'error', error: { code: 'context_injection_incomplete', message: 'late' } });
    channel.serverSends({ type: 'error', error: { code: 'rate_limit', message: 'slow down' } });
    expect(h.calls.onError).toEqual([['slow down']]);
  });

  it('remote track goes to playback and the speaking probe reports level changes', async () => {
    const { env, h } = await started();
    const track = env.peer.remoteTrack();
    expect(env.playback.attached).toBe(track);
    env.probes[0].onChange(true);
    expect(h.calls.onSpeakingChange).toEqual([[true]]);
  });
});

describe('LiveVoiceSession commands', () => {
  it('say chunks commentary on sentence boundaries with the delegation id; think is one append', async () => {
    const { channel, session } = await started();
    session.say('d1', `${'A sentence. '.repeat(150)}`);
    const says = channel.json().filter((frame) => frame.type === 'session.commentary.append');
    expect(says.length).toBeGreaterThan(1);
    expect(says.every((frame) => frame.delegation_id === 'd1' && String(frame.content).length <= 1400)).toBe(true);
    session.think('d1', 'Hermes is working: terminal.');
    expect(channel.json().at(-1)).toMatchObject({ type: 'session.thinking.append', delegation_id: 'd1' });
  });

  it('chunkForCommentary keeps short text whole and splits long text', () => {
    expect(chunkForCommentary('  Hello   there.  ')).toEqual(['Hello there.']);
    expect(chunkForCommentary('')).toEqual([]);
    expect(chunkForCommentary('x'.repeat(3000), 1400)).toHaveLength(3);
  });

  it('mic mute disables the local track before sending the vendor event', async () => {
    const { env, channel, session } = await started();
    session.setMicMuted(true);
    expect(env.streams[0].tracks[0].enabled).toBe(false);
    expect(channel.types().at(-1)).toBe('session.input_audio.mute');
    session.setMicMuted(false);
    expect(env.streams[0].tracks[0].enabled).toBe(true);
    expect(channel.types().at(-1)).toBe('session.input_audio.unmute');
  });

  it('playback mute is local only: nothing goes over the data channel', async () => {
    const { env, channel, session } = await started();
    const before = channel.sent.length;
    session.setPlaybackMuted(true);
    expect(env.playback.muted).toBe(true);
    expect(channel.sent.length).toBe(before);
  });
});

describe('LiveVoiceSession teardown', () => {
  it('close() asks the provider, then releases on session.closed with that reason', async () => {
    const { env, h, channel, session } = await started();
    env.peer.remoteTrack();
    session.close();
    expect(channel.types().at(-1)).toBe('session.close');
    expect(env.released()).toBe(false);
    channel.serverSends({ type: 'session.closed', reason: 'closed' });
    expect(env.released()).toBe(true);
    expect(h.calls.onClosed).toEqual([['closed']]);
    session.close(); // idempotent
    expect(h.calls.onClosed).toHaveLength(1);
  });

  it('close() releases after the grace period when the provider never answers', async () => {
    const { env, h, session } = await started();
    session.close();
    env.advance(15_000);
    expect(env.released()).toBe(true);
    expect(h.calls.onClosed).toEqual([['close_requested']]);
  });

  it('release() is immediate: no grace, tracks stopped, peer closed, playback detached', async () => {
    const { env, h, session } = await started();
    env.peer.remoteTrack();
    session.release();
    expect(env.released()).toBe(true);
    expect(h.calls.onClosed).toEqual([['close_requested']]);
  });

  it('a transport drop (peer failed / channel closed) reports connection_lost once and releases', async () => {
    const { env, h } = await started();
    env.peer.connection('failed');
    env.channel!.serverCloses();
    expect(h.calls.onClosed).toEqual([['connection_lost']]);
    expect(env.released()).toBe(true);
  });

  it('commands after release are no-ops, never throws', async () => {
    const { session } = await started();
    session.release();
    expect(() => { session.say('d', 'x'); session.think('d', 'y'); session.setMicMuted(true); session.setPlaybackMuted(true); }).not.toThrow();
  });
});
