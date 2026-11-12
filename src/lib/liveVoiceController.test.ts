import { describe, expect, it, vi } from 'vitest';
import { HttpError } from './hermesApi';
import { delegationPrompt, LiveSessionLike, LiveVoiceController, LiveVoiceControllerDeps } from './liveVoiceController';
import { ACK_TEXT, CANCELLED_TEXT, LiveScope, LiveVoiceState, QUEUED_ACK_TEXT } from './liveVoiceMachine';
import { LiveSessionHandlers, LiveTranscriptFragment, LiveVoiceSessionError } from './liveVoiceSession';

const scope: LiveScope = { profile: 'default', sessionId: 'bob-live' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeSession implements LiveSessionLike {
  liveSessionId: string | null = null;
  log: Array<[string, ...unknown[]]> = [];
  startError: unknown = null;
  exchangeCalls = 0;
  constructor(readonly handlers: LiveSessionHandlers) {}
  async start(exchange: (sdp: string) => Promise<{ sessionId: string | null; sdp: string }>) {
    if (this.startError) throw this.startError;
    this.exchangeCalls += 1;
    const answer = await exchange('v=0\r\n');
    this.liveSessionId = answer.sessionId;
  }
  say(id: string | null, text: string) { this.log.push(['say', id, text]); }
  think(id: string | null, text: string) { this.log.push(['think', id, text]); }
  setMicMuted(muted: boolean) { this.log.push(['mic', muted]); }
  setPlaybackMuted(muted: boolean) { this.log.push(['playback', muted]); }
  close() { this.log.push(['close']); }
  release() { this.log.push(['release']); }
  // server-side helpers
  user(text: string, endMs = 1000) { this.handlers.onTranscript({ speaker: 'user', text, startMs: endMs - 100, endMs }); }
  assistant(text: string, endMs = 1000) { this.handlers.onTranscript({ speaker: 'assistant', text, startMs: endMs - 100, endMs }); }
  delegate(id: string, context: LiveTranscriptFragment[]) { this.handlers.onDelegation(id, context); }
  speaking(on: boolean) { this.handlers.onSpeakingChange(on); }
  closedByProvider(reason: string) { this.handlers.onClosed(reason); }
  sayCalls() { return this.log.filter(([kind]) => kind === 'say'); }
}

class Timers {
  pending = new Map<number, { fn: () => void; ms: number }>();
  private id = 0;
  set = (fn: () => void, ms: number) => { const id = ++this.id; this.pending.set(id, { fn, ms }); return id; };
  clear = (id: number) => { this.pending.delete(id); };
  fire(maxMs = Infinity) { for (const [id, timer] of [...this.pending]) if (timer.ms <= maxMs) { this.pending.delete(id); timer.fn(); } }
}

function make(overrides: Partial<LiveVoiceControllerDeps> & { startError?: unknown; exchangeError?: unknown } = {}) {
  const sessions: FakeSession[] = [];
  const timers = new Timers();
  const states: LiveVoiceState[] = [];
  const submit = vi.fn(overrides.submit ?? (async () => undefined));
  const steer = vi.fn(overrides.steer ?? (async () => ({ status: 'accepted' as const })));
  const interrupt = vi.fn(overrides.interrupt ?? (async () => ({ status: 'interrupted' as const })));
  const exchange = vi.fn(overrides.exchange ?? (async () => { if (overrides.exchangeError) throw overrides.exchangeError; return { sessionId: 'live-1', sdp: 'answer' }; }));
  const controller = new LiveVoiceController({
    createSession: (handlers) => { const session = new FakeSession(handlers); session.startError = overrides.startError ?? null; sessions.push(session); return session; },
    exchange,
    submit,
    steer,
    interrupt: overrides.interrupt === undefined && 'interrupt' in overrides ? undefined : interrupt,
    onState: (state) => states.push(state),
    now: () => 5000,
    setTimeout: timers.set,
    clearTimeout: timers.clear,
    utteranceSettleMs: 1500,
    teardownGraceMs: 20_000,
  });
  const phase = () => controller.getState().phase;
  return { controller, sessions, timers, states, submit, steer, interrupt, exchange, phase, session: () => sessions[sessions.length - 1] };
}

async function live(overrides: Parameters<typeof make>[0] = {}) {
  const ctx = make(overrides);
  ctx.controller.start(scope);
  await flush();
  return ctx;
}

const userTurn = (text: string): LiveTranscriptFragment[] => [{ speaker: 'user', text, startMs: 0, endMs: 500 }];

describe('delegationPrompt', () => {
  it('uses the last user turn as the prompt and a labelled transcript as context', () => {
    const { prompt, context } = delegationPrompt([
      { speaker: 'user', text: 'what is ', startMs: 0, endMs: 1 }, { speaker: 'user', text: 'on my plate', startMs: 1, endMs: 2 },
      { speaker: 'assistant', text: 'Let me check.', startMs: 2, endMs: 3 }, { speaker: 'user', text: 'yes', startMs: 3, endMs: 4 },
    ]);
    expect(prompt).toBe('yes');
    expect(context).toBe('User: what is on my plate\nVoice assistant: Let me check.\nUser: yes');
  });
});

describe('connect', () => {
  it('start() exchanges exactly once and lands in live with the provider session id', async () => {
    const { controller, exchange, phase } = await live();
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange.mock.calls[0][0]).toEqual(scope);
    expect(phase()).toBe('live');
    expect(controller.getState().liveSessionId).toBe('live-1');
  });

  it('microphone denied → permission-denied error, released, no exchange', async () => {
    const { controller, exchange, session } = await live({ startError: new LiveVoiceSessionError('permission-denied', 'Microphone access was denied.') });
    expect(controller.getState().phase).toBe('error');
    expect(controller.getState().error?.code).toBe('permission-denied');
    expect(exchange).not.toHaveBeenCalled();
    expect(session().log).toContainEqual(['release']);
  });

  it('503 (not configured) → unavailable; 502 → session-failed; 401 → auth-expired; never retried', async () => {
    for (const [status, code] of [[503, 'unavailable'], [502, 'session-failed'], [401, 'auth-expired']] as const) {
      const { controller, exchange } = await live({ exchangeError: new HttpError('fail', status) });
      expect(controller.getState().error?.code).toBe(code);
      expect(exchange).toHaveBeenCalledTimes(1);
    }
  });

  it('after an error a fresh start() reconnects with a new session', async () => {
    const ctx = await live({ exchangeError: new HttpError('fail', 502) });
    ctx.exchange.mockImplementation(async () => ({ sessionId: 'live-2', sdp: 'a' }));
    ctx.sessions.length = 0;
    ctx.controller.start(scope);
    await flush();
    expect(ctx.phase()).toBe('live');
    expect(ctx.controller.getState().liveSessionId).toBe('live-2');
  });
});

describe('delegations → the pinned session', () => {
  it('new work submits with surface context to the scope session, acks once when the turn starts, speaks the result once', async () => {
    const { controller, submit, session, phase } = await live();
    session().delegate('d1', userTurn('what is on my plate'));
    expect(submit).toHaveBeenCalledWith('bob-live', 'what is on my plate', 'User: what is on my plate');
    expect(phase()).toBe('working');
    await flush();
    expect(session().sayCalls()).toEqual([['say', 'd1', ACK_TEXT]]);
    controller.gatewayEvent({ type: 'message.start', session_id: 'bob-live' });
    controller.gatewayEvent({ type: 'message.delta', session_id: 'bob-live', payload: { text: 'Three ' } });
    controller.gatewayEvent({ type: 'message.delta', session_id: 'bob-live', payload: { text: 'things.' } });
    controller.gatewayEvent({ type: 'message.complete', session_id: 'bob-live', payload: { text: 'Three things.' } });
    controller.gatewayEvent({ type: 'message.complete', session_id: 'bob-live', payload: { text: 'Three things.' } }); // duplicate
    expect(session().sayCalls()).toEqual([['say', 'd1', ACK_TEXT], ['say', 'd1', 'Three things.']]);
    expect(phase()).toBe('live');
  });

  it('frames from any other session are never correlated', async () => {
    const { controller, session } = await live();
    session().delegate('d1', userTurn('x'));
    controller.gatewayEvent({ type: 'message.complete', session_id: 'other', payload: { text: 'nope' } });
    controller.gatewayEvent({ type: 'message.complete', payload: { text: 'nope' } });
    expect(controller.getState().phase).toBe('working');
    expect(session().sayCalls()).toEqual([]);
  });

  it('a correction while working steers (never submits) and the result goes to the latest delegation', async () => {
    const { controller, submit, steer, session } = await live();
    session().delegate('d1', userTurn('book it for Friday'));
    session().delegate('d2', userTurn('no, Thursday not Friday'));
    await flush();
    expect(steer).toHaveBeenCalledWith('bob-live', 'no, Thursday not Friday');
    expect(submit).toHaveBeenCalledTimes(1);
    controller.gatewayEvent({ type: 'message.complete', session_id: 'bob-live', payload: { text: 'Booked Thursday.' } });
    expect(session().sayCalls().at(-1)).toEqual(['say', 'd2', 'Booked Thursday.']);
  });

  it('a rejected steer resubmits the correction as new work', async () => {
    const { submit, session } = await live({ steer: async () => ({ status: 'rejected' as const }) });
    session().delegate('d1', userTurn('first'));
    session().delegate('d2', userTurn('actually two'));
    await flush();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][1]).toBe('actually two');
  });

  it('cancel while working calls the interrupt helper, not submit or steer', async () => {
    const { controller, submit, steer, interrupt, session } = await live();
    session().delegate('d1', userTurn('long task'));
    session().delegate('d2', userTurn('never mind, cancel that'));
    await flush();
    expect(interrupt).toHaveBeenCalledWith('bob-live');
    expect(steer).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(session().sayCalls().at(-1)).toEqual(['say', 'd2', CANCELLED_TEXT]);
    expect(controller.getState().phase).toBe('live');
  });

  it('new work while working is queued, acked, and submitted after the first result', async () => {
    const { controller, submit, session } = await live();
    session().delegate('d1', userTurn('first'));
    session().delegate('d2', userTurn('and the weather'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(session().sayCalls().at(-1)).toEqual(['say', 'd2', QUEUED_ACK_TEXT]);
    controller.gatewayEvent({ type: 'message.complete', session_id: 'bob-live', payload: { text: 'done' } });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][1]).toBe('and the weather');
  });

  it('a submit failure is spoken once and the turn is cleared', async () => {
    const { controller, session } = await live({ submit: async () => { throw new Error('Not sent. token=abc'); } });
    session().delegate('d1', userTurn('x'));
    await flush();
    expect(session().sayCalls()).toHaveLength(1);
    expect(session().sayCalls()[0][2]).toMatch(/could not reach Bob/);
    expect(controller.getState().phase).toBe('live');
    expect(controller.getState().notice).not.toContain('abc');
  });
});

describe('barge-in and stop', () => {
  it('user speech while the assistant speaks mutes playback locally first; the settled utterance unmutes', async () => {
    const { session, timers } = await live();
    session().speaking(true);
    session().user('what ');
    expect(session().log.at(-1)).toEqual(['playback', true]);
    session().user('about Friday');
    timers.fire(1500);
    expect(session().log.at(-1)).toEqual(['playback', false]);
  });

  it('a spoken "stop" keeps playback muted and never touches the running turn', async () => {
    const { controller, interrupt, steer, session, timers } = await live();
    session().delegate('d1', userTurn('long task'));
    session().speaking(true);
    session().user('stop');
    timers.fire(1500);
    expect(session().log.filter(([kind]) => kind === 'playback')).toEqual([['playback', true]]);
    session().delegate('d2', userTurn('stop'));
    await flush();
    expect(interrupt).not.toHaveBeenCalled();
    expect(steer).not.toHaveBeenCalled();
    expect(controller.getState().delegation?.id).toBe('d1');
  });

  it('stopSpeaking() from the UI is a local playback mute', async () => {
    const { controller, session } = await live();
    session().speaking(true);
    controller.stopSpeaking();
    expect(session().log.at(-1)).toEqual(['playback', true]);
  });
});

describe('lifecycle', () => {
  it('a different session releases the live session (session.close + local teardown) and moves the scope', async () => {
    const { controller, session } = await live();
    controller.scopeChanged({ profile: 'default', sessionId: 'other' });
    expect(session().log).toContainEqual(['release']);
    expect(controller.getState().phase).toBe('idle');
    expect(controller.getState().scope).toEqual({ profile: 'default', sessionId: 'other' });
  });

  it('a profile change releases too; the same scope is a no-op', async () => {
    const { controller, session } = await live();
    controller.scopeChanged({ profile: 'default', sessionId: 'bob-live' });
    expect(session().log).not.toContainEqual(['release']);
    controller.scopeChanged({ profile: 'sales-test', sessionId: 'bob-live' });
    expect(session().log).toContainEqual(['release']);
  });

  it('hidden pauses the mic and tears down after the grace; visible in time cancels', async () => {
    const first = await live();
    first.controller.pageHidden();
    expect(first.session().log.at(-1)).toEqual(['mic', true]);
    first.controller.pageVisible();
    expect(first.session().log.at(-1)).toEqual(['mic', false]);
    first.timers.fire(20_000);
    expect(first.phase()).toBe('live');

    const second = await live();
    second.controller.pageHidden();
    second.timers.fire(20_000);
    expect(second.phase()).toBe('idle');
    expect(second.session().log).toContainEqual(['release']);
  });

  it('the result of a turn that completes while backgrounded (mic paused) is spoken exactly once', async () => {
    const { controller, session } = await live();
    session().delegate('d1', userTurn('x'));
    controller.pageHidden();
    controller.gatewayEvent({ type: 'message.complete', session_id: 'bob-live', payload: { text: 'Done it.' } });
    controller.gatewayEvent({ type: 'message.complete', session_id: 'bob-live', payload: { text: 'Done it.' } });
    expect(session().sayCalls().filter(([, , text]) => text === 'Done it.')).toHaveLength(1);
  });

  it('gateway loss releases audio; provider close releases audio; hang-up releases audio', async () => {
    const a = await live(); a.controller.gatewayLost(); expect(a.session().log).toContainEqual(['release']); expect(a.phase()).toBe('idle');
    const b = await live(); b.session().closedByProvider('connection_lost'); expect(b.session().log).toContainEqual(['release']); expect(b.phase()).toBe('idle');
    const c = await live(); c.controller.stop(); expect(c.session().log).toContainEqual(['release']); expect(c.phase()).toBe('idle');
  });

  it('callbacks from a released session are ignored (epoch guard)', async () => {
    const { controller, sessions } = await live();
    const old = sessions[0];
    controller.stop();
    controller.start(scope);
    await flush();
    old.delegate('ghost', userTurn('x'));
    old.speaking(true);
    expect(controller.getState().phase).toBe('live');
    expect(controller.getState().speaking).toBe(false);
  });

  it('dispose() releases and stops notifying', async () => {
    const { controller, states, session } = await live();
    controller.dispose();
    expect(session().log).toContainEqual(['release']);
    const count = states.length;
    controller.start(scope);
    expect(states.length).toBe(count);
  });
});
