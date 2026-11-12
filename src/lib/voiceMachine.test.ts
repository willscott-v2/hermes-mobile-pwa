import { describe, expect, it } from 'vitest';
import { initialVoiceState, transition, VoiceEvent, VoiceScope, VoiceState } from './voiceMachine';

const scope: VoiceScope = { profile: 'default', sessionId: 'sess-1' };

function run(events: VoiceEvent[], from: VoiceState = initialVoiceState()) {
  let state = from;
  const effects = [];
  for (const event of events) {
    const result = transition(state, event);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

describe('voice machine: dictation', () => {
  it('starts idle with nothing buffered', () => {
    const state = initialVoiceState();
    expect(state.phase).toBe('idle');
    expect(state.partial).toBe('');
    expect(state.error).toBeNull();
  });

  it('START requests the microphone for the given scope and begins capture', () => {
    const { state, effects } = run([{ type: 'START', scope }]);
    expect(state.phase).toBe('requesting-permission');
    expect(state.scope).toEqual(scope);
    expect(effects).toEqual([{ type: 'begin-capture', scope }]);
  });

  it('MIC_GRANTED moves to listening; partials are ephemeral captions', () => {
    const { state } = run([{ type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STT_PARTIAL', text: 'hello th' }]);
    expect(state.phase).toBe('listening');
    expect(state.partial).toBe('hello th');
  });

  it('MIC_DENIED lands in a specific error and releases everything', () => {
    const { state, effects } = run([{ type: 'START', scope }, { type: 'MIC_DENIED', code: 'permission-denied', message: 'Microphone permission was denied.' }]);
    expect(state.phase).toBe('error');
    expect(state.error).toEqual({ code: 'permission-denied', message: 'Microphone permission was denied.' });
    expect(effects).toContainEqual({ type: 'release-all' });
  });

  it('STOP while listening finishes capture and waits for the final transcript', () => {
    const { state, effects } = run([{ type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STOP' }]);
    expect(state.phase).toBe('transcribing');
    expect(effects).toContainEqual({ type: 'finish-capture' });
  });

  it('a non-blank STT_FINAL submits the trimmed transcript exactly once', () => {
    const { state, effects } = run([
      { type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STT_PARTIAL', text: 'hello' }, { type: 'STOP' },
      { type: 'STT_FINAL', text: '  hello there  ' },
      { type: 'STT_FINAL', text: 'duplicate' },
    ]);
    expect(state.phase).toBe('submitting');
    expect(state.transcript).toBe('hello there');
    expect(state.partial).toBe('');
    expect(effects.filter((effect) => effect.type === 'submit')).toEqual([{ type: 'submit', text: 'hello there' }]);
  });

  it('a blank STT_FINAL never submits and returns to idle with a notice', () => {
    const { state, effects } = run([{ type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STOP' }, { type: 'STT_FINAL', text: '   ' }]);
    expect(state.phase).toBe('idle');
    expect(state.notice).toMatch(/nothing was sent/i);
    expect(effects.some((effect) => effect.type === 'submit')).toBe(false);
  });

  it('STT_FINAL is ignored unless we are waiting for it (no submit while listening)', () => {
    const { state, effects } = run([{ type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STT_FINAL', text: 'sneaky' }]);
    expect(state.phase).toBe('listening');
    expect(effects.some((effect) => effect.type === 'submit')).toBe(false);
  });

  it('START is ignored while a voice turn is already active (no double capture)', () => {
    const { effects } = run([{ type: 'START', scope }, { type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'START', scope }]);
    expect(effects.filter((effect) => effect.type === 'begin-capture')).toHaveLength(1);
  });

  it('STOP before the microphone is granted cancels capture instead of waiting', () => {
    const { state, effects } = run([{ type: 'START', scope }, { type: 'STOP' }]);
    expect(state.phase).toBe('idle');
    expect(effects).toContainEqual({ type: 'cancel-capture' });
  });

  it('an STT socket close before a final transcript is an error and never submits partial text', () => {
    for (const events of [
      [{ type: 'START', scope }],
      [{ type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STT_PARTIAL', text: 'half a sent' }],
      [{ type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STT_PARTIAL', text: 'half a sent' }, { type: 'STOP' }],
    ] as VoiceEvent[][]) {
      const { state, effects } = run([...events, { type: 'SOCKET_CLOSED', channel: 'stt' }]);
      expect(state.phase).toBe('error');
      expect(state.error?.code).toBe('stt-disconnected');
      expect(state.partial).toBe('');
      expect(effects.some((effect) => effect.type === 'submit')).toBe(false);
      expect(effects).toContainEqual({ type: 'cancel-capture' });
    }
  });

  it('FAIL during transcription errors out, keeps nothing, and never submits', () => {
    const { state, effects } = run([{ type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STT_PARTIAL', text: 'partial' }, { type: 'STOP' }, { type: 'FAIL', code: 'stt-failed', message: 'no live STT' }]);
    expect(state.phase).toBe('error');
    expect(state.error).toEqual({ code: 'stt-failed', message: 'no live STT' });
    expect(effects.some((effect) => effect.type === 'submit')).toBe(false);
    expect(effects).toContainEqual({ type: 'release-all' });
  });

  it('can START again from an error', () => {
    const { state } = run([{ type: 'START', scope }, { type: 'FAIL', code: 'stt-failed', message: 'x' }, { type: 'START', scope }]);
    expect(state.phase).toBe('requesting-permission');
    expect(state.error).toBeNull();
  });
});

const submitted: VoiceEvent[] = [
  { type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STOP' }, { type: 'STT_FINAL', text: 'what is next' },
];

describe('voice machine: assistant reply and TTS', () => {
  it('PROMPT_ACCEPTED moves submitting to waiting for the assistant', () => {
    const { state } = run([...submitted, { type: 'PROMPT_ACCEPTED' }]);
    expect(state.phase).toBe('waiting');
  });

  it('assistant deltas feed TTS incrementally and in order', () => {
    const { state, effects } = run([...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'ASSISTANT_DELTA', text: 'Hello ' }, { type: 'ASSISTANT_DELTA', text: 'world.' }]);
    expect(state.phase).toBe('waiting');
    expect(effects.filter((effect) => effect.type === 'speech-text')).toEqual([
      { type: 'speech-text', text: 'Hello ' },
      { type: 'speech-text', text: 'world.' },
    ]);
  });

  it('deltas may arrive before the prompt call resolves', () => {
    const { state, effects } = run([...submitted, { type: 'ASSISTANT_DELTA', text: 'Early. ' }, { type: 'PROMPT_ACCEPTED' }]);
    expect(state.phase).toBe('waiting');
    expect(effects).toContainEqual({ type: 'speech-text', text: 'Early. ' });
  });

  it('empty deltas are not sent to TTS', () => {
    const { effects } = run([...submitted, { type: 'ASSISTANT_DELTA', text: '' }]);
    expect(effects.some((effect) => effect.type === 'speech-text')).toBe(false);
  });

  it('TTS_STARTED shows speaking; complete sends done once and waits for audio to end', () => {
    const { state, effects } = run([...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'ASSISTANT_DELTA', text: 'Hi there. ' }, { type: 'TTS_STARTED' }, { type: 'ASSISTANT_COMPLETE', text: 'Hi there.' }]);
    expect(state.phase).toBe('speaking');
    expect(effects.filter((effect) => effect.type === 'speech-finish')).toHaveLength(1);
    expect(effects.filter((effect) => effect.type === 'speech-text')).toHaveLength(1); // final text not re-sent after deltas
    expect(run([{ type: 'TTS_ENDED' }], state).state.phase).toBe('idle');
  });

  it('a non-streamed reply (final text only) is still spoken', () => {
    const { effects } = run([...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'ASSISTANT_COMPLETE', text: 'All done.' }]);
    expect(effects.filter((effect) => effect.type === 'speech-text')).toEqual([{ type: 'speech-text', text: 'All done.' }]);
    expect(effects).toContainEqual({ type: 'speech-finish' });
  });

  it('complete stays waiting until TTS ends, then returns to idle', () => {
    const waiting = run([...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'ASSISTANT_DELTA', text: 'Ok. ' }, { type: 'ASSISTANT_COMPLETE' }]);
    expect(waiting.state.phase).toBe('waiting');
    expect(run([{ type: 'TTS_ENDED' }], waiting.state).state.phase).toBe('idle');
  });

  it('a late TTS_STARTED after interrupt or idle never resurrects speaking', () => {
    const interrupted = run([...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'INTERRUPT' }, { type: 'TTS_STARTED' }]);
    expect(interrupted.state.phase).toBe('interrupted');
    expect(run([{ type: 'TTS_STARTED' }]).state.phase).toBe('idle');
  });

  it('TTS_FAILED degrades to text: no error phase, no more TTS, turn completes normally', () => {
    const failedTts = run([...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'ASSISTANT_DELTA', text: 'One. ' }, { type: 'TTS_STARTED' }, { type: 'TTS_FAILED', message: 'provider down' }]);
    expect(failedTts.state.phase).toBe('waiting');
    expect(failedTts.state.error).toBeNull();
    expect(failedTts.state.notice).toMatch(/text/i);
    expect(failedTts.effects).toContainEqual({ type: 'speech-stop' });
    const rest = run([{ type: 'ASSISTANT_DELTA', text: 'Two. ' }, { type: 'ASSISTANT_COMPLETE', text: 'One. Two. ' }], failedTts.state);
    expect(rest.effects.some((effect) => effect.type === 'speech-text' || effect.type === 'speech-finish')).toBe(false);
    expect(rest.state.phase).toBe('idle');
  });

  it('an unexpected TTS socket close while speech is pending degrades like a failure', () => {
    const { state } = run([...submitted, { type: 'ASSISTANT_DELTA', text: 'One. ' }, { type: 'SOCKET_CLOSED', channel: 'tts' }]);
    expect(state.phase).toBe('waiting');
    expect(state.error).toBeNull();
    expect(state.speechAvailable).toBe(false);
  });

  it('a TTS socket close before any text was sent degrades speech so later deltas are never sent', () => {
    const closed = run([...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'SOCKET_CLOSED', channel: 'tts' }]);
    expect(closed.state.phase).toBe('waiting');
    expect(closed.state.speechAvailable).toBe(false);
    expect(closed.state.notice).toMatch(/text/i);
    const rest = run([{ type: 'ASSISTANT_DELTA', text: 'One. ' }, { type: 'ASSISTANT_COMPLETE', text: 'One. ' }], closed.state);
    expect(rest.effects.some((effect) => effect.type === 'speech-text' || effect.type === 'speech-finish')).toBe(false);
    expect(rest.state.phase).toBe('idle');
    expect(rest.state.speechPending).toBe(false);
  });

  it('a TTS end before the assistant completes degrades speech for the rest of the turn', () => {
    const early = run([...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'ASSISTANT_DELTA', text: 'One. ' }, { type: 'TTS_STARTED' }, { type: 'TTS_ENDED' }]);
    expect(early.state.phase).toBe('waiting');
    expect(early.state.speechAvailable).toBe(false);
    expect(early.state.speechPending).toBe(false);
    expect(early.state.notice).toMatch(/text/i);
    expect(early.effects).toContainEqual({ type: 'speech-stop' });
    const rest = run([{ type: 'ASSISTANT_DELTA', text: 'Two. ' }, { type: 'ASSISTANT_COMPLETE', text: 'One. Two. ' }], early.state);
    expect(rest.effects.some((effect) => effect.type === 'speech-text' || effect.type === 'speech-finish')).toBe(false);
    expect(rest.state.phase).toBe('idle');
  });

  it('GATEWAY_LOST during an active turn or capture releases everything and returns to idle with a notice', () => {
    for (const events of [
      [{ type: 'START', scope }, { type: 'MIC_GRANTED' }],
      [...submitted],
      [...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'ASSISTANT_DELTA', text: 'One. ' }, { type: 'TTS_STARTED' }],
    ] as VoiceEvent[][]) {
      const { state, effects } = run([...events, { type: 'GATEWAY_LOST' }]);
      expect(state.phase).toBe('idle');
      expect(state.notice).toMatch(/connection/i);
      expect(state.scope).toEqual(scope);
      expect(effects.filter((effect) => effect.type === 'release-all')).toHaveLength(1);
      expect(run([{ type: 'ASSISTANT_DELTA', text: 'late' }, { type: 'ASSISTANT_COMPLETE', text: 'late' }], state).effects).toEqual([]);
    }
  });

  it('GATEWAY_LOST while the submit is still pending hands the exact final transcript back once, before releasing', () => {
    const { state, effects } = run([
      { type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STOP' },
      { type: 'STT_FINAL', text: '  what is on my plate  ' },
      { type: 'GATEWAY_LOST' },
    ]);
    expect(state.phase).toBe('idle');
    const lostEffects = effects.slice(effects.findIndex((effect) => effect.type === 'submit') + 1);
    expect(lostEffects).toEqual([{ type: 'restore-transcript', text: 'what is on my plate' }, { type: 'release-all' }]);
    expect(state.transcript).toBe('');
    // Nothing is left to restore a second time.
    expect(transition(state, { type: 'GATEWAY_LOST' }).effects).toEqual([]);
  });

  it('GATEWAY_LOST after the prompt was accepted, or while capturing, restores nothing', () => {
    for (const events of [
      [{ type: 'START', scope }, { type: 'MIC_GRANTED' }],
      [...submitted, { type: 'PROMPT_ACCEPTED' }],
      [...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'ASSISTANT_DELTA', text: 'One. ' }],
    ] as VoiceEvent[][]) {
      const { effects } = run([...events, { type: 'GATEWAY_LOST' }]);
      expect(effects.some((effect) => effect.type === 'restore-transcript')).toBe(false);
    }
  });

  it('GATEWAY_LOST while idle or already in error changes nothing', () => {
    const idle = initialVoiceState(scope);
    expect(transition(idle, { type: 'GATEWAY_LOST' })).toEqual({ state: idle, effects: [] });
    const failed = run([{ type: 'START', scope }, { type: 'FAIL', code: 'stt-failed', message: 'x' }]).state;
    expect(transition(failed, { type: 'GATEWAY_LOST' }).state).toBe(failed);
  });

  it('a TTS socket close after a clean end is ignored', () => {
    const { state } = run([...submitted, { type: 'ASSISTANT_DELTA', text: 'One. ' }, { type: 'ASSISTANT_COMPLETE' }, { type: 'TTS_ENDED' }, { type: 'SOCKET_CLOSED', channel: 'tts' }]);
    expect(state.phase).toBe('idle');
    expect(state.notice).toBe('');
  });

  it('assistant text in idle (a typed turn) is never spoken', () => {
    const { effects } = run([{ type: 'ASSISTANT_DELTA', text: 'typed reply' }, { type: 'ASSISTANT_COMPLETE', text: 'typed reply' }]);
    expect(effects).toEqual([]);
  });

  it('prompt failure is an error that keeps the transcript for recovery', () => {
    const { state, effects } = run([...submitted, { type: 'FAIL', code: 'prompt-failed', message: 'Not sent: boom' }]);
    expect(state.phase).toBe('error');
    expect(state.transcript).toBe('what is next');
    expect(effects).toContainEqual({ type: 'release-all' });
  });
});

describe('voice machine: interrupt, scope and reset', () => {
  it('INTERRUPT while speaking silences playback, keeps text, and mutes the rest of the turn', () => {
    const interrupted = run([...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'ASSISTANT_DELTA', text: 'Long answer. ' }, { type: 'TTS_STARTED' }, { type: 'INTERRUPT' }]);
    expect(interrupted.state.phase).toBe('interrupted');
    expect(interrupted.effects).toContainEqual({ type: 'speech-stop' });
    const more = run([{ type: 'ASSISTANT_DELTA', text: 'more. ' }, { type: 'ASSISTANT_COMPLETE', text: 'Long answer. more.' }], interrupted.state);
    expect(more.effects).toEqual([]);
    expect(more.state.phase).toBe('interrupted');
  });

  it('INTERRUPT while listening cancels capture and sends nothing', () => {
    const { state, effects } = run([{ type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STT_PARTIAL', text: 'abc' }, { type: 'INTERRUPT' }]);
    expect(state.phase).toBe('idle');
    expect(state.partial).toBe('');
    expect(effects).toContainEqual({ type: 'cancel-capture' });
    expect(effects.some((effect) => effect.type === 'submit')).toBe(false);
  });

  it('INTERRUPT while transcribing discards the dictation', () => {
    const { state, effects } = run([{ type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STOP' }, { type: 'INTERRUPT' }, { type: 'STT_FINAL', text: 'late' }]);
    expect(state.phase).toBe('idle');
    expect(effects.some((effect) => effect.type === 'submit')).toBe(false);
  });

  it('INTERRUPT in idle is a no-op', () => {
    const { state, effects } = run([{ type: 'INTERRUPT' }]);
    expect(state.phase).toBe('idle');
    expect(effects).toEqual([]);
  });

  it('can dictate again after an interrupt', () => {
    const { state } = run([...submitted, { type: 'INTERRUPT' }, { type: 'START', scope }]);
    expect(state.phase).toBe('requesting-permission');
  });

  it('PROFILE_CHANGED and SESSION_CHANGED reset to idle in the new scope and release everything', () => {
    for (const type of ['PROFILE_CHANGED', 'SESSION_CHANGED'] as const) {
      const next: VoiceScope = { profile: 'sales-test', sessionId: 'other' };
      const { state, effects } = run([{ type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STT_PARTIAL', text: 'x' }, { type, scope: next }]);
      expect(state.phase).toBe('idle');
      expect(state.partial).toBe('');
      expect(state.scope).toEqual(next);
      expect(effects).toContainEqual({ type: 'release-all' });
    }
  });

  it('a scope change drops a late final transcript instead of submitting it to the new chat', () => {
    const { effects } = run([{ type: 'START', scope }, { type: 'MIC_GRANTED' }, { type: 'STOP' }, { type: 'SESSION_CHANGED', scope: { profile: 'default', sessionId: 'other' } }, { type: 'STT_FINAL', text: 'old chat words' }]);
    expect(effects.some((effect) => effect.type === 'submit')).toBe(false);
  });

  it('RESET returns to a clean idle state and releases everything', () => {
    const { state, effects } = run([...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'ASSISTANT_DELTA', text: 'x' }, { type: 'RESET' }]);
    expect(state).toEqual(initialVoiceState());
    expect(effects).toContainEqual({ type: 'release-all' });
  });
});

describe('voice machine: idle scope changes', () => {
  it('a scope change while idle only updates the scope and does not tear down unlocked audio', () => {
    for (const type of ['PROFILE_CHANGED', 'SESSION_CHANGED'] as const) {
      const next: VoiceScope = { profile: 'sales-test', sessionId: 'other' };
      const { state, effects } = run([{ type, scope: next }]);
      expect(state.phase).toBe('idle');
      expect(state.scope).toEqual(next);
      expect(effects).toEqual([]);
    }
  });

  it('a scope change from error or interrupted still releases everything', () => {
    for (const events of [
      [{ type: 'START', scope }, { type: 'FAIL', code: 'stt-failed', message: 'x' }],
      [...submitted, { type: 'PROMPT_ACCEPTED' }, { type: 'INTERRUPT' }],
    ] as VoiceEvent[][]) {
      const { effects } = run([...events, { type: 'SESSION_CHANGED', scope: { profile: 'default', sessionId: 'other' } }]);
      expect(effects.filter((effect) => effect.type === 'release-all').length).toBeGreaterThan(0);
    }
  });
});
