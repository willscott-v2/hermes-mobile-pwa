import { describe, expect, it, vi } from 'vitest';
import { FakeVoiceBackend } from './fakeVoiceBackend';
import { VoiceController } from './voiceController';
import { VoiceScope, VoiceState } from './voiceMachine';

const scope: VoiceScope = { profile: 'default', sessionId: 'sess-1' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function make(options: { submitText?: (text: string) => Promise<void> } = {}) {
  const backend = new FakeVoiceBackend();
  const states: VoiceState[] = [];
  const submitText = vi.fn(options.submitText ?? (async () => undefined));
  const onSubmitFailed = vi.fn();
  const controller = new VoiceController({ backend, submitText, onState: (state) => states.push(state), onSubmitFailed });
  const phase = () => controller.getState().phase;
  return { backend, controller, submitText, onSubmitFailed, states, phase };
}

// Drive a dictation through to a submitted prompt with an open speech session.
async function submitted(options: Parameters<typeof make>[0] = {}) {
  const ctx = make(options);
  ctx.controller.start(scope);
  const dictation = ctx.backend.dictations[0];
  dictation.listening();
  ctx.controller.stop();
  dictation.final('  what is on my plate  ');
  await flush();
  return { ...ctx, dictation, speech: ctx.backend.speeches[0] };
}

describe('VoiceController dictation', () => {
  it('start() unlocks audio in the gesture and opens dictation for the scope profile', () => {
    const { controller, backend, phase } = make();
    controller.start({ profile: 'sales-test', sessionId: 's9' });
    expect(backend.unlocks).toBe(1);
    expect(backend.dictations).toHaveLength(1);
    expect(backend.dictations[0].scope).toEqual({ profile: 'sales-test', sessionId: 's9' });
    expect(phase()).toBe('requesting-permission');
  });

  it('an unsupported environment fails fast with the capability reason and opens nothing', () => {
    const { controller, backend, phase } = make();
    backend.capabilityResult = { supported: false, code: 'insecure-context', message: 'Voice needs HTTPS.' };
    controller.start(scope);
    expect(backend.dictations).toHaveLength(0);
    expect(phase()).toBe('error');
    expect(controller.getState().error).toEqual({ code: 'insecure-context', message: 'Voice needs HTTPS.' });
  });

  it('microphone denial lands in a specific error', async () => {
    const { controller, backend } = make();
    backend.auto.deny = 'permission-denied';
    controller.start(scope);
    await flush();
    expect(controller.getState().phase).toBe('error');
    expect(controller.getState().error?.code).toBe('permission-denied');
  });

  it('shows partial captions while listening and stop() finishes capture', () => {
    const { controller, backend, phase } = make();
    controller.start(scope);
    backend.dictations[0].listening();
    backend.dictations[0].partial('what is');
    expect(phase()).toBe('listening');
    expect(controller.getState().partial).toBe('what is');
    controller.stop();
    expect(backend.dictations[0].finished).toBe(true);
    expect(phase()).toBe('transcribing');
  });

  it('a final transcript is submitted through submitText exactly once, trimmed', async () => {
    const { submitText, phase } = await submitted();
    expect(submitText).toHaveBeenCalledTimes(1);
    expect(submitText).toHaveBeenCalledWith('what is on my plate');
    expect(phase()).toBe('waiting');
  });

  it('a blank final never submits', async () => {
    const { controller, backend, submitText, phase } = make();
    controller.start(scope);
    backend.dictations[0].listening();
    controller.stop();
    backend.dictations[0].final('   ');
    await flush();
    expect(submitText).not.toHaveBeenCalled();
    expect(phase()).toBe('idle');
  });

  it('an STT disconnect before the final never submits partial text', async () => {
    const { controller, backend, submitText, phase } = make();
    controller.start(scope);
    backend.dictations[0].listening();
    backend.dictations[0].partial('half a sentence');
    backend.dictations[0].closed();
    await flush();
    expect(submitText).not.toHaveBeenCalled();
    expect(phase()).toBe('error');
    expect(controller.getState().error?.code).toBe('stt-disconnected');
  });

  it('an STT error frame never submits', async () => {
    const { controller, backend, submitText, phase } = make();
    controller.start(scope);
    backend.dictations[0].listening();
    controller.stop();
    backend.dictations[0].error('stt-failed', 'no live STT for the configured provider');
    await flush();
    expect(submitText).not.toHaveBeenCalled();
    expect(phase()).toBe('error');
  });

  it('a failed prompt submit is an error that hands the transcript back and closes speech', async () => {
    const { phase, onSubmitFailed, backend, controller } = await submitted({ submitText: async () => { throw new Error('Not sent: gateway lost'); } });
    expect(phase()).toBe('error');
    expect(onSubmitFailed).toHaveBeenCalledWith('what is on my plate', 'Not sent: gateway lost');
    expect(backend.speeches[0].closedByUs).toBe(true);
    expect(controller.getState().transcript).toBe('what is on my plate');
  });
});

describe('VoiceController assistant speech', () => {
  it('opens speech for the same profile and streams deltas incrementally, then done on complete', async () => {
    const { controller, speech } = await submitted();
    expect(speech.scope).toEqual(scope);
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'Hello ' } });
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'there. ' } });
    expect(speech.spoken).toEqual(['Hello ', 'there. ']);
    expect(speech.done).toBe(false);
    controller.gatewayEvent({ type: 'message.complete', session_id: 'sess-1', payload: { text: 'Hello there. ' } });
    expect(speech.done).toBe(true);
    expect(speech.spoken).toEqual(['Hello ', 'there. ']);
  });

  it('shows speaking when audio starts and returns to idle (releasing speech) when it ends', async () => {
    const { controller, speech, phase } = await submitted();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'Hi. ' } });
    speech.started();
    expect(phase()).toBe('speaking');
    controller.gatewayEvent({ type: 'message.complete', session_id: 'sess-1', payload: { text: 'Hi.' } });
    speech.ended();
    expect(phase()).toBe('idle');
    expect(speech.closedByUs).toBe(true);
  });

  it('TTS failure degrades to text: the chat turn is untouched and no more text is sent to speech', async () => {
    const { controller, speech, phase, submitText } = await submitted();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'One. ' } });
    speech.error('provider down');
    expect(phase()).toBe('waiting');
    expect(controller.getState().error).toBeNull();
    expect(controller.getState().notice).toMatch(/text/i);
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'Two. ' } });
    controller.gatewayEvent({ type: 'message.complete', session_id: 'sess-1', payload: { text: 'One. Two. ' } });
    expect(speech.spoken).toEqual(['One. ']);
    expect(phase()).toBe('idle');
    expect(submitText).toHaveBeenCalledTimes(1); // never retried
    expect(speech.closedByUs).toBe(true);
  });

  it('a server fallback leaves the reply text-only without retrying', async () => {
    const { controller, speech, phase, backend } = await submitted();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'One. ' } });
    speech.fallback();
    controller.gatewayEvent({ type: 'message.complete', session_id: 'sess-1', payload: { text: 'One. ' } });
    expect(phase()).toBe('idle');
    expect(backend.speeches).toHaveLength(1);
  });

  it('interrupt silences playback with stop, keeps text, and mutes the rest of the reply', async () => {
    const { controller, speech, phase } = await submitted();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'Long. ' } });
    speech.started();
    controller.interrupt();
    expect(speech.stopped).toBe(true);
    expect(phase()).toBe('interrupted');
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'more. ' } });
    controller.gatewayEvent({ type: 'message.complete', session_id: 'sess-1', payload: { text: 'Long. more. ' } });
    expect(speech.spoken).toEqual(['Long. ']);
  });

  it('a reply with no text closes the speech session instead of leaving it open in idle', async () => {
    const { controller, speech, phase } = await submitted();
    controller.gatewayEvent({ type: 'message.complete', session_id: 'sess-1', payload: { text: '' } });
    expect(phase()).toBe('idle');
    expect(speech.closedByUs).toBe(true);
    expect(speech.done).toBe(false);
  });

  it('assistant events while idle (typed turns) are ignored and open no speech', () => {
    const { controller, backend } = make();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'typed reply' } });
    controller.gatewayEvent({ type: 'message.complete', session_id: 'sess-1', payload: { text: 'typed reply' } });
    expect(backend.speeches).toHaveLength(0);
    expect(controller.getState().phase).toBe('idle');
  });
});

describe('VoiceController early TTS termination', () => {
  it('a TTS socket close before the first delta disables speech for the turn and still settles to idle', async () => {
    const { controller, speech, phase, backend } = await submitted();
    speech.closedByServer();
    expect(phase()).toBe('waiting');
    expect(controller.getState().notice).toMatch(/text/i);
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'One. ' } });
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'Two. ' } });
    expect(speech.spoken).toEqual([]);
    expect(backend.speeches).toHaveLength(1);
    expect(phase()).toBe('waiting');
    controller.gatewayEvent({ type: 'message.complete', session_id: 'sess-1', payload: { text: 'One. Two. ' } });
    expect(phase()).toBe('idle');
    expect(controller.getState().error).toBeNull();
    expect(speech.done).toBe(false);
  });

  it('a TTS socket close between deltas stops feeding speech and settles to idle on complete', async () => {
    const { controller, speech, phase } = await submitted();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'One. ' } });
    speech.closedByServer();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'Two. ' } });
    controller.gatewayEvent({ type: 'message.complete', session_id: 'sess-1', payload: { text: 'One. Two. ' } });
    expect(speech.spoken).toEqual(['One. ']);
    expect(phase()).toBe('idle');
  });

  it('a TTS end before the assistant completes disables speech for the rest of the turn and settles after complete', async () => {
    const { controller, speech, phase, backend } = await submitted();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'One. ' } });
    speech.started();
    speech.ended(); // synthesis-side early termination: the reply is not complete yet
    expect(phase()).toBe('waiting');
    expect(controller.getState().notice).toMatch(/text/i);
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'Two. ' } });
    expect(speech.spoken).toEqual(['One. ']);
    expect(backend.speeches).toHaveLength(1);
    controller.gatewayEvent({ type: 'message.complete', session_id: 'sess-1', payload: { text: 'One. Two. ' } });
    expect(phase()).toBe('idle');
    expect(speech.done).toBe(false);
    expect(speech.closedByUs).toBe(true);
  });

  it('a normal TTS end after the assistant completes is unchanged: no degradation notice', async () => {
    const { controller, speech, phase } = await submitted();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'One. ' } });
    speech.started();
    controller.gatewayEvent({ type: 'message.complete', session_id: 'sess-1', payload: { text: 'One. ' } });
    speech.ended();
    expect(phase()).toBe('idle');
    expect(controller.getState().notice).toBe('');
  });
});

describe('VoiceController gateway loss', () => {
  it('a gateway drop mid-turn releases speech and the backend, returns to idle, and never speaks resumed events', async () => {
    const { controller, speech, backend, phase } = await submitted();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'One. ' } });
    speech.started();
    const disposalsBefore = backend.disposals;
    controller.gatewayLost();
    expect(phase()).toBe('idle');
    expect(speech.closedByUs).toBe(true);
    expect(backend.disposals).toBeGreaterThan(disposalsBefore);
    expect(controller.getState().notice).toMatch(/connection/i);
    // Replayed/resumed events from the reconnected session belong to the abandoned turn.
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'Resumed. ' } });
    controller.gatewayEvent({ type: 'message.complete', session_id: 'sess-1', payload: { text: 'One. Resumed. ' } });
    expect(speech.spoken).toEqual(['One. ']);
    expect(backend.speeches).toHaveLength(1);
    expect(phase()).toBe('idle');
    speech.ended(); // stale callback from the released session
    expect(phase()).toBe('idle');
  });

  it('a gateway drop while listening cancels the microphone and never submits late text', async () => {
    const { controller, backend, submitText, phase } = make();
    controller.start(scope);
    const dictation = backend.dictations[0];
    dictation.listening();
    controller.gatewayLost();
    expect(dictation.cancelled).toBe(true);
    expect(phase()).toBe('idle');
    dictation.final('late words');
    await flush();
    expect(submitText).not.toHaveBeenCalled();
  });

  it('a gateway drop while the prompt is still being accepted ignores the late acceptance', async () => {
    let accept: () => void = () => undefined;
    const { controller, backend, phase } = make({ submitText: () => new Promise<void>((resolve) => { accept = resolve; }) });
    controller.start(scope);
    backend.dictations[0].listening();
    controller.stop();
    backend.dictations[0].final('hello');
    expect(phase()).toBe('submitting');
    controller.gatewayLost();
    accept();
    await flush();
    expect(phase()).toBe('idle');
    expect(backend.speeches[0].closedByUs).toBe(true);
  });

  it('a gateway drop while the submit is pending restores the exact transcript once, without a second submission', async () => {
    let reject: (error: Error) => void = () => undefined;
    const { controller, backend, submitText, onSubmitFailed, phase } = make({ submitText: () => new Promise<void>((_, fail) => { reject = fail; }) });
    controller.start(scope);
    backend.dictations[0].listening();
    controller.stop();
    backend.dictations[0].final('  hello bob  ');
    expect(phase()).toBe('submitting');
    controller.gatewayLost();
    expect(onSubmitFailed).toHaveBeenCalledTimes(1);
    expect(onSubmitFailed).toHaveBeenCalledWith('hello bob', expect.any(String));
    expect(phase()).toBe('idle');
    // The late rejection from the dropped socket is ignored: no duplicate restore, no error state.
    reject(new Error('Not sent: gateway closed'));
    await flush();
    expect(onSubmitFailed).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('idle');
    expect(controller.getState().error).toBeNull();
    expect(submitText).toHaveBeenCalledTimes(1);
    // A second drop (or the replayed turn) neither restores again nor speaks.
    controller.gatewayLost();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'Replayed. ' } });
    expect(onSubmitFailed).toHaveBeenCalledTimes(1);
    expect(backend.speeches).toHaveLength(1);
    expect(backend.speeches[0].spoken).toEqual([]);
    expect(backend.speeches[0].closedByUs).toBe(true);
  });

  it('a gateway drop after the prompt was accepted does not restore the transcript', async () => {
    const { controller, onSubmitFailed } = await submitted();
    controller.gatewayLost();
    expect(onSubmitFailed).not.toHaveBeenCalled();
  });

  it('a gateway drop while idle changes nothing', () => {
    const { controller, backend, states } = make();
    controller.gatewayLost();
    expect(controller.getState().phase).toBe('idle');
    expect(states).toHaveLength(0);
    expect(backend.disposals).toBe(0);
  });
});

describe('VoiceController session identity', () => {
  it('speaks only frames whose session_id is exactly the active live session', async () => {
    const { controller, speech } = await submitted();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'Mine. ' } });
    expect(speech.spoken).toEqual(['Mine. ']);
  });

  it('ignores delta and complete frames from a foreign session', async () => {
    const { controller, speech, phase } = await submitted();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'other-session', payload: { text: 'Foreign. ' } });
    controller.gatewayEvent({ type: 'message.complete', session_id: 'other-session', payload: { text: 'Foreign. ' } });
    expect(speech.spoken).toEqual([]);
    expect(speech.done).toBe(false);
    expect(phase()).toBe('waiting');
    expect(controller.getState().assistantComplete).toBe(false);
  });

  it('fails closed for frames with a missing or non-exact session_id', async () => {
    const { controller, speech, phase } = await submitted();
    controller.gatewayEvent({ type: 'message.delta', payload: { text: 'Anonymous. ' } });
    controller.gatewayEvent({ type: 'message.delta', session_id: '', payload: { text: 'Empty. ' } });
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-10', payload: { text: 'Prefix. ' } });
    controller.gatewayEvent({ type: 'message.delta', session_id: 'SESS-1', payload: { text: 'Case. ' } });
    controller.gatewayEvent({ type: 'message.complete', payload: { text: 'Anonymous. ' } });
    expect(speech.spoken).toEqual([]);
    expect(phase()).toBe('waiting');
    expect(controller.getState().assistantComplete).toBe(false);
  });

  it('uses the live gateway id from the scope, not a durable history key', async () => {
    const ctx = make();
    ctx.controller.start({ profile: 'default', sessionId: 'live-9' });
    const dictation = ctx.backend.dictations[0];
    dictation.listening();
    ctx.controller.stop();
    dictation.final('hi');
    await flush();
    const speech = ctx.backend.speeches[0];
    ctx.controller.gatewayEvent({ type: 'message.delta', session_id: 'stored-history-key', payload: { text: 'Wrong. ' } });
    ctx.controller.gatewayEvent({ type: 'message.delta', session_id: 'live-9', payload: { text: 'Right. ' } });
    expect(speech.spoken).toEqual(['Right. ']);
  });
});

describe('VoiceController error redaction', () => {
  const leaky = "Failed to construct 'WebSocket': wss://h.example/api/audio/speak-stream?profile=default&ticket=SECRETTICKET&token=SECRETTOKEN";

  it('redacts credentials from dictation errors before they reach state', async () => {
    const { controller, backend } = make();
    controller.start(scope);
    backend.dictations[0].listening();
    backend.dictations[0].error('stt-failed', leaky);
    const message = controller.getState().error?.message ?? '';
    expect(message).not.toContain('SECRETTICKET');
    expect(message).not.toContain('SECRETTOKEN');
    expect(message).toContain('[redacted]');
  });

  it('redacts credentials from capability failures', async () => {
    const { controller, backend } = make();
    backend.capabilityResult = { supported: false, code: 'unsupported', message: leaky };
    controller.start(scope);
    expect(controller.getState().error?.message).not.toContain('SECRETTICKET');
  });

  it('redacts credentials from a failed prompt submit, in state and in the hand-back message', async () => {
    const { phase, onSubmitFailed, controller } = await submitted({ submitText: async () => { throw new Error(leaky); } });
    expect(phase()).toBe('error');
    expect(controller.getState().error?.message).not.toContain('SECRETTICKET');
    expect(onSubmitFailed.mock.calls[0][1]).not.toContain('SECRETTICKET');
    expect(onSubmitFailed.mock.calls[0][0]).toBe('what is on my plate');
  });
});

describe('VoiceController cleanup', () => {
  it('a profile change mid-listening cancels the microphone, disposes the backend, and never submits late text', async () => {
    const { controller, backend, submitText, phase } = make();
    controller.start(scope);
    const dictation = backend.dictations[0];
    dictation.listening();
    controller.scopeChanged({ profile: 'sales-test', sessionId: 'sess-1' });
    expect(dictation.cancelled).toBe(true);
    expect(backend.disposals).toBeGreaterThan(0);
    expect(phase()).toBe('idle');
    expect(controller.getState().scope).toEqual({ profile: 'sales-test', sessionId: 'sess-1' });
    dictation.final('late words');
    await flush();
    expect(submitText).not.toHaveBeenCalled();
  });

  it('a session change while speaking closes the speech session and ignores its late events', async () => {
    const { controller, speech, phase, backend } = await submitted();
    controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'Hi. ' } });
    speech.started();
    controller.scopeChanged({ profile: 'default', sessionId: 'other' });
    expect(speech.closedByUs).toBe(true);
    expect(backend.disposals).toBeGreaterThan(0);
    expect(phase()).toBe('idle');
    speech.ended();
    expect(phase()).toBe('idle');
  });

  it('leaving the chat (null scope) releases everything', async () => {
    const { controller, backend } = await submitted();
    controller.scopeChanged(null);
    expect(backend.speeches[0].closedByUs).toBe(true);
    expect(controller.getState().scope).toBeNull();
  });

  it('an unchanged scope is not a reset', () => {
    const { controller, backend, phase } = make();
    controller.start(scope);
    backend.dictations[0].listening();
    controller.scopeChanged({ ...scope });
    expect(phase()).toBe('listening');
    expect(backend.dictations[0].cancelled).toBe(false);
  });

  it('events from a superseded dictation cannot affect a newer one', async () => {
    const { controller, backend, submitText, phase } = make();
    controller.start(scope);
    const first = backend.dictations[0];
    controller.reset();
    controller.start(scope);
    first.listening();
    first.final('stale words');
    await flush();
    expect(submitText).not.toHaveBeenCalled();
    expect(phase()).toBe('requesting-permission');
  });

  it('pageHidden releases the microphone and any playback', async () => {
    const listening = make();
    listening.controller.start(scope);
    listening.backend.dictations[0].listening();
    listening.controller.pageHidden();
    expect(listening.backend.dictations[0].cancelled).toBe(true);
    expect(listening.phase()).toBe('idle');

    const speaking = await submitted();
    speaking.controller.gatewayEvent({ type: 'message.delta', session_id: 'sess-1', payload: { text: 'Hi. ' } });
    speaking.controller.pageHidden();
    expect(speaking.speech.closedByUs).toBe(true);
    expect(speaking.phase()).toBe('idle');
  });

  it('dispose() releases everything and stops notifying', async () => {
    const { controller, backend, states } = make();
    controller.start(scope);
    backend.dictations[0].listening();
    controller.dispose();
    const count = states.length;
    expect(backend.dictations[0].cancelled).toBe(true);
    expect(backend.disposals).toBeGreaterThan(0);
    backend.dictations[0].partial('ignored');
    expect(states.length).toBe(count);
  });
});
