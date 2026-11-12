import { describe, expect, it } from 'vitest';
import {
  ACK_TEXT, CANCELLED_TEXT, classifyUtterance, DELEGATION_FAILED_TEXT, initialLiveState, LiveScope, LiveVoiceEffect, LiveVoiceEvent, LiveVoiceState,
  NO_RESULT_TEXT, NOTHING_RUNNING_TEXT, QUEUED_ACK_TEXT, STOP_SPEECH_NOTE, transition,
} from './liveVoiceMachine';

const scope: LiveScope = { profile: 'default', sessionId: 'bob-live-1' };

function run(events: LiveVoiceEvent[], from: LiveVoiceState = initialLiveState()): { state: LiveVoiceState; effects: LiveVoiceEffect[] } {
  let state = from;
  const effects: LiveVoiceEffect[] = [];
  for (const event of events) {
    const result = transition(state, event);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

const connected = () => run([{ type: 'START', scope }, { type: 'CONNECTED', liveSessionId: 'live-1' }]).state;
const delegation = (id: string, utterance: string, now = 1000): LiveVoiceEvent => ({ type: 'DELEGATION', id, utterance, context: `User: ${utterance}`, now });
const types = (effects: LiveVoiceEffect[]) => effects.map((effect) => effect.type);

describe('classifyUtterance', () => {
  it('recognises pure stop-speech phrases', () => {
    for (const text of ['stop', 'Stop.', 'okay stop', 'shh', 'be quiet', "that's enough", 'Quiet!']) expect(classifyUtterance(text, true)).toBe('stop-speech');
  });
  it('recognises cancel-work phrases', () => {
    for (const text of ['cancel that', 'never mind', 'nevermind', 'forget it', 'stop the task', 'abort', "don't bother"]) expect(classifyUtterance(text, true)).toBe('cancel');
  });
  it('recognises corrections only while work is running', () => {
    expect(classifyUtterance('no, Thursday not Friday', true)).toBe('correction');
    expect(classifyUtterance('actually make it two pages', true)).toBe('correction');
    expect(classifyUtterance('no, Thursday not Friday', false)).toBe('new');
  });
  it('everything else is new work, including requests that merely contain "stop"', () => {
    expect(classifyUtterance('stop the container and restart it', false)).toBe('new');
    expect(classifyUtterance("what's on my plate today", true)).toBe('new');
  });
});

describe('connect / hang up', () => {
  it('START connects for the scope; CONNECTED lands in live', () => {
    const first = transition(initialLiveState(), { type: 'START', scope });
    expect(first.state.phase).toBe('connecting');
    expect(first.effects).toEqual([{ type: 'connect', scope }]);
    const live = transition(first.state, { type: 'CONNECTED', liveSessionId: 'live-1' });
    expect(live.state.phase).toBe('live');
    expect(live.state.liveSessionId).toBe('live-1');
  });

  it('START is ignored while already connecting/live', () => {
    const state = connected();
    expect(transition(state, { type: 'START', scope }).effects).toEqual([]);
  });

  it('CONNECT_FAILED (mic denied, 503, 502) ends in error and releases everything', () => {
    const connecting = transition(initialLiveState(), { type: 'START', scope }).state;
    for (const code of ['permission-denied', 'unavailable', 'session-failed'] as const) {
      const result = transition(connecting, { type: 'CONNECT_FAILED', code, message: 'nope' });
      expect(result.state.phase).toBe('error');
      expect(result.state.error).toEqual({ code, message: 'nope' });
      expect(result.effects).toEqual([{ type: 'release-all' }]);
    }
  });

  it('STOP releases everything and notes a dropped delegation', () => {
    const working = run([delegation('d1', 'check the deploy')], connected()).state;
    const result = transition(working, { type: 'STOP' });
    expect(result.state.phase).toBe('idle');
    expect(result.effects).toEqual([{ type: 'release-all' }]);
    expect(result.state.notice).toMatch(/still working/);
    expect(transition(initialLiveState(), { type: 'STOP' }).effects).toEqual([]);
  });

  it('SESSION_CLOSED by the provider releases audio; idle ignores it', () => {
    const result = transition(connected(), { type: 'SESSION_CLOSED', reason: 'connection_lost' });
    expect(result.state.phase).toBe('idle');
    expect(result.effects).toEqual([{ type: 'release-all' }]);
    expect(result.state.notice).toMatch(/lost/);
    expect(transition(initialLiveState(), { type: 'SESSION_CLOSED', reason: 'closed' }).effects).toEqual([]);
  });
});

describe('delegation routing', () => {
  it('new work submits to the scope session exactly once and moves to working', () => {
    const result = transition(connected(), delegation('d1', '  what is on my plate  '));
    expect(result.state.phase).toBe('working');
    expect(result.effects).toEqual([{ type: 'submit', delegationId: 'd1', sessionId: 'bob-live-1', text: 'what is on my plate', context: 'User:   what is on my plate  ' }]);
    expect(result.state.delegation?.id).toBe('d1');
  });

  it('WORK_STARTED acknowledges once, never twice', () => {
    const working = transition(connected(), delegation('d1', 'run the tests')).state;
    const first = transition(working, { type: 'WORK_STARTED' });
    expect(first.effects).toEqual([{ type: 'say', delegationId: 'd1', text: ACK_TEXT }]);
    expect(transition(first.state, { type: 'WORK_STARTED' }).effects).toEqual([]);
  });

  it('WORK_RESULT speaks the final text once for the owning delegation; a duplicate is ignored', () => {
    const working = transition(connected(), delegation('d1', 'run the tests')).state;
    const done = transition(working, { type: 'WORK_RESULT', text: 'All 19 files pass.' });
    expect(done.effects).toEqual([{ type: 'say', delegationId: 'd1', text: 'All 19 files pass.' }]);
    expect(done.state.phase).toBe('live');
    expect(done.state.spokenIds).toEqual(['d1']);
    expect(transition(done.state, { type: 'WORK_RESULT', text: 'All 19 files pass.' }).effects).toEqual([]);
  });

  it('WORK_RESULT without text falls back to streamed deltas, else a quiet note', () => {
    const working = transition(connected(), delegation('d1', 'x')).state;
    const streamed = run([{ type: 'WORK_DELTA', text: 'Two ' }, { type: 'WORK_DELTA', text: 'things.' }, { type: 'WORK_RESULT', text: '' }], working);
    expect(streamed.effects).toEqual([{ type: 'say', delegationId: 'd1', text: 'Two things.' }]);
    const silent = transition(working, { type: 'WORK_RESULT' });
    expect(silent.effects).toEqual([{ type: 'think', delegationId: 'd1', text: NO_RESULT_TEXT }]);
  });

  it('a correction while working steers the running turn and re-targets the result', () => {
    const working = transition(connected(), delegation('d1', 'book it for Friday')).state;
    const corrected = transition(working, delegation('d2', 'no, Thursday not Friday'));
    expect(corrected.effects).toEqual([{ type: 'steer', delegationId: 'd2', sessionId: 'bob-live-1', text: 'no, Thursday not Friday' }]);
    expect(corrected.state.delegation?.id).toBe('d2');
    const done = transition(corrected.state, { type: 'WORK_RESULT', text: 'Booked Thursday.' });
    expect(done.effects).toEqual([{ type: 'say', delegationId: 'd2', text: 'Booked Thursday.' }]);
  });

  it('a rejected steer falls back to submitting the correction as new work', () => {
    const working = transition(connected(), delegation('d1', 'book it')).state;
    const corrected = transition(working, delegation('d2', 'actually make it two')).state;
    expect(transition(corrected, { type: 'STEER_RESULT', accepted: false }).effects).toEqual([
      { type: 'submit', delegationId: 'd2', sessionId: 'bob-live-1', text: 'actually make it two', context: 'User: actually make it two' },
    ]);
    expect(transition(corrected, { type: 'STEER_RESULT', accepted: true }).effects).toEqual([]);
  });

  it('cancel while working interrupts the session, confirms, and drops the queue', () => {
    const working = run([delegation('d1', 'long task'), delegation('d2', 'and also the weather')], connected()).state;
    expect(working.queued).toHaveLength(1);
    const cancelled = transition(working, delegation('d3', 'never mind, cancel that'));
    expect(cancelled.effects).toEqual([
      { type: 'interrupt', delegationId: 'd3', sessionId: 'bob-live-1' },
      { type: 'say', delegationId: 'd3', text: CANCELLED_TEXT },
    ]);
    expect(cancelled.state.phase).toBe('live');
    expect(cancelled.state.queued).toEqual([]);
  });

  it('cancel with nothing running just says so and touches no turn', () => {
    const result = transition(connected(), delegation('d1', 'cancel'));
    expect(result.effects).toEqual([{ type: 'say', delegationId: 'd1', text: NOTHING_RUNNING_TEXT }]);
  });

  it('new work while working is queued with an ack and submitted after the result', () => {
    const working = transition(connected(), delegation('d1', 'first')).state;
    const queued = transition(working, delegation('d2', 'second', 2000));
    expect(queued.effects).toEqual([{ type: 'say', delegationId: 'd2', text: QUEUED_ACK_TEXT }]);
    const done = transition(queued.state, { type: 'WORK_RESULT', text: 'first done' });
    expect(done.effects).toEqual([
      { type: 'say', delegationId: 'd1', text: 'first done' },
      { type: 'submit', delegationId: 'd2', sessionId: 'bob-live-1', text: 'second', context: 'User: second' },
    ]);
    expect(done.state.phase).toBe('working');
    expect(done.state.delegation?.id).toBe('d2');
  });

  it('a delegation failure is spoken once and clears the turn', () => {
    const working = transition(connected(), delegation('d1', 'x')).state;
    const failed = transition(working, { type: 'WORK_FAILED', message: 'Not sent.' });
    expect(failed.effects).toEqual([{ type: 'say', delegationId: 'd1', text: DELEGATION_FAILED_TEXT }]);
    expect(failed.state.phase).toBe('live');
  });

  it('delegations are ignored when not connected', () => {
    expect(transition(initialLiveState(), delegation('d1', 'hi')).effects).toEqual([]);
  });
});

describe('barge-in and stop-speech', () => {
  it('user speech while the assistant speaks mutes playback locally; the settled utterance unmutes', () => {
    const speaking = transition(connected(), { type: 'SPEAKING', speaking: true }).state;
    const muted = transition(speaking, { type: 'USER_SPEECH_STARTED' });
    expect(muted.effects).toEqual([{ type: 'playback-mute' }]);
    expect(transition(muted.state, { type: 'USER_SPEECH_STARTED' }).effects).toEqual([]);
    const settled = transition(muted.state, { type: 'USER_UTTERANCE', text: 'what about Friday' });
    expect(settled.effects).toEqual([{ type: 'playback-unmute' }]);
    expect(settled.state.playbackMuted).toBe(false);
  });

  it('user speech while the assistant is silent does nothing', () => {
    expect(transition(connected(), { type: 'USER_SPEECH_STARTED' }).effects).toEqual([]);
  });

  it('a spoken "stop" keeps playback muted and never touches the agent turn', () => {
    const working = run([delegation('d1', 'long task'), { type: 'SPEAKING', speaking: true }], connected()).state;
    const stopped = transition(working, { type: 'USER_UTTERANCE', text: 'stop' });
    expect(stopped.effects).toEqual([{ type: 'playback-mute' }]);
    const delegated = transition(stopped.state, delegation('d2', 'stop'));
    expect(types(delegated.effects)).toEqual(['think']);
    expect(delegated.effects[0]).toEqual({ type: 'think', delegationId: 'd2', text: STOP_SPEECH_NOTE });
    expect(delegated.state.delegation?.id).toBe('d1');
    expect(delegated.state.phase).toBe('working');
  });
});

describe('lifecycle', () => {
  it('hidden pauses the mic and schedules teardown; visible cancels it', () => {
    const hidden = transition(connected(), { type: 'HIDDEN' });
    expect(hidden.effects).toEqual([{ type: 'mic-mute' }, { type: 'schedule-teardown' }]);
    expect(hidden.state.micMuted).toBe(true);
    const visible = transition(hidden.state, { type: 'VISIBLE' });
    expect(visible.effects).toEqual([{ type: 'cancel-teardown' }, { type: 'mic-unmute' }]);
    const torn = transition(hidden.state, { type: 'TEARDOWN' });
    expect(torn.state.phase).toBe('idle');
    expect(torn.effects).toEqual([{ type: 'release-all' }]);
  });

  it('a different session or profile releases everything and moves the scope', () => {
    const other = { profile: 'default', sessionId: 'other' };
    const result = transition(connected(), { type: 'SESSION_CHANGED', scope: other });
    expect(result.effects).toEqual([{ type: 'release-all' }]);
    expect(result.state).toEqual(initialLiveState(other));
    expect(transition(initialLiveState(), { type: 'PROFILE_CHANGED', scope: null }).effects).toEqual([]);
  });

  it('gateway loss while working releases audio and says the answer lands in chat', () => {
    const working = transition(connected(), delegation('d1', 'x')).state;
    const lost = transition(working, { type: 'GATEWAY_LOST' });
    expect(lost.state.phase).toBe('idle');
    expect(lost.effects).toEqual([{ type: 'release-all' }]);
    expect(transition(initialLiveState(), { type: 'GATEWAY_LOST' }).effects).toEqual([]);
  });

  it('RESET and FAIL always release', () => {
    expect(transition(connected(), { type: 'RESET' }).effects).toEqual([{ type: 'release-all' }]);
    const failed = transition(connected(), { type: 'FAIL', code: 'internal', message: 'boom' });
    expect(failed.state.phase).toBe('error');
    expect(failed.effects).toEqual([{ type: 'release-all' }]);
  });
});
