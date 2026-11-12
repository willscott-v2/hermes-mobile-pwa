import { describe, expect, it } from 'vitest';
import { initialLiveState, transition } from './liveVoiceMachine';
import { liveStateToVoiceState } from './liveVoiceView';
import { voiceView } from './voiceView';

const scope = { profile: 'default', sessionId: 's1' };
const context = { capability: { supported: true } as const, canStart: true, blockedReason: '', live: true };

describe('liveStateToVoiceState + live labels', () => {
  it('idle → start live voice', () => {
    const view = voiceView(liveStateToVoiceState(initialLiveState()), context);
    expect(view.primary).toEqual({ action: 'start', label: 'Start live voice', disabled: false });
    expect(view.status).toBe('Live voice ready');
  });

  it('connecting → cancel; live → hang up; speaking → stop speaking; working → hang up + keep talking', () => {
    const connecting = transition(initialLiveState(), { type: 'START', scope }).state;
    expect(voiceView(liveStateToVoiceState(connecting), context).primary.action).toBe('cancel');
    const live = transition(connecting, { type: 'CONNECTED', liveSessionId: 'l' }).state;
    expect(voiceView(liveStateToVoiceState(live), context).primary).toEqual({ action: 'stop', label: 'Hang up', disabled: false });
    const speaking = transition(live, { type: 'SPEAKING', speaking: true }).state;
    expect(voiceView(liveStateToVoiceState(speaking), context).primary).toEqual({ action: 'interrupt', label: 'Stop speaking', disabled: false });
    const working = transition(live, { type: 'DELEGATION', id: 'd', utterance: 'do it', context: '', now: 1 }).state;
    const view = voiceView(liveStateToVoiceState(working), context);
    expect(view.status).toMatch(/Keep talking/);
    expect(view.caption).toBe('You said: “do it”');
    expect(view.primary.label).toBe('Hang up');
  });

  it('errors map to the chained vocabulary and keep the message', () => {
    const connecting = transition(initialLiveState(), { type: 'START', scope }).state;
    const unavailable = transition(connecting, { type: 'CONNECT_FAILED', code: 'unavailable', message: 'Not configured.' }).state;
    const state = liveStateToVoiceState(unavailable);
    expect(state.phase).toBe('error');
    expect(state.error).toEqual({ code: 'internal', message: 'Not configured.' });
    const denied = transition(connecting, { type: 'CONNECT_FAILED', code: 'permission-denied', message: 'Denied.' }).state;
    expect(liveStateToVoiceState(denied).error?.code).toBe('permission-denied');
  });

  it('muted playback during barge-in is not shown as speaking', () => {
    const live = transition(transition(initialLiveState(), { type: 'START', scope }).state, { type: 'CONNECTED', liveSessionId: 'l' }).state;
    const speaking = transition(live, { type: 'SPEAKING', speaking: true }).state;
    const muted = transition(speaking, { type: 'USER_SPEECH_STARTED' }).state;
    expect(liveStateToVoiceState(muted).phase).toBe('listening');
  });

  it('chained labels are unchanged without the live flag', () => {
    const view = voiceView({ ...liveStateToVoiceState(initialLiveState()), phase: 'listening' }, { ...context, live: false });
    expect(view.primary.label).toBe('Stop and send');
  });
});
