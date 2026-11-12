import { describe, expect, it } from 'vitest';
import { initialVoiceState, VoiceState } from './voiceMachine';
import { voiceView } from './voiceView';

const supported = { supported: true } as const;
const base = (overrides: Partial<VoiceState>): VoiceState => ({ ...initialVoiceState({ profile: 'default', sessionId: 's' }), ...overrides });

describe('voiceView', () => {
  it('idle: offers a Start talking action, enabled only when the chat can take a prompt', () => {
    expect(voiceView(base({}), { capability: supported, canStart: true, blockedReason: '' }).primary).toEqual({ action: 'start', label: 'Start talking', disabled: false });
    const blocked = voiceView(base({}), { capability: supported, canStart: false, blockedReason: 'Hermes is working.' });
    expect(blocked.primary.disabled).toBe(true);
    expect(blocked.hint).toBe('Hermes is working.');
  });

  it('listening: stop-and-send with a live partial caption, or a prompt to speak', () => {
    const view = voiceView(base({ phase: 'listening', partial: 'what is on' }), { capability: supported, canStart: true, blockedReason: '' });
    expect(view.status).toBe('Listening…');
    expect(view.caption).toBe('what is on');
    expect(view.primary).toEqual({ action: 'stop', label: 'Stop and send', disabled: false });
    expect(voiceView(base({ phase: 'listening' }), { capability: supported, canStart: true, blockedReason: '' }).caption).toBe('Say something…');
  });

  it('permission and transcribing: cancellable, never an unlabeled spinner', () => {
    for (const phase of ['requesting-permission', 'transcribing'] as const) {
      const view = voiceView(base({ phase }), { capability: supported, canStart: true, blockedReason: '' });
      expect(view.primary).toEqual({ action: 'cancel', label: 'Cancel voice input', disabled: false });
      expect(view.status).toMatch(/…$/);
    }
  });

  it('turn in flight: waiting and speaking can be stopped without touching the text', () => {
    expect(voiceView(base({ phase: 'waiting', transcript: 'hello' }), { capability: supported, canStart: false, blockedReason: '' }).primary).toEqual({ action: 'interrupt', label: 'Stop voice reply', disabled: false });
    const speaking = voiceView(base({ phase: 'speaking', transcript: 'hello' }), { capability: supported, canStart: false, blockedReason: '' });
    expect(speaking.primary).toEqual({ action: 'interrupt', label: 'Stop speaking', disabled: false });
    expect(speaking.caption).toBe('You said: “hello”');
  });

  it('interrupted: says the text reply stays and offers another turn', () => {
    const view = voiceView(base({ phase: 'interrupted', transcript: 'hello' }), { capability: supported, canStart: true, blockedReason: '' });
    expect(view.status).toMatch(/text/i);
    expect(view.primary.action).toBe('start');
  });

  it('error: surfaces the specific message and allows trying again', () => {
    const view = voiceView(base({ phase: 'error', error: { code: 'permission-denied', message: 'Microphone permission was denied.' } }), { capability: supported, canStart: true, blockedReason: '' });
    expect(view.error).toBe('Microphone permission was denied.');
    expect(view.primary).toEqual({ action: 'start', label: 'Start talking', disabled: false });
  });

  it('an unsupported environment shows the specific capability reason and disables start (text chat unaffected)', () => {
    const view = voiceView(base({}), { capability: { supported: false, code: 'insecure-context', message: 'Voice needs HTTPS.' }, canStart: true, blockedReason: '' });
    expect(view.error).toBe('Voice needs HTTPS.');
    expect(view.primary.disabled).toBe(true);
  });

  it('non-fatal notices (blank transcript, TTS degraded) are shown as hints, not errors', () => {
    const view = voiceView(base({ notice: 'Voice playback is unavailable. Reading the reply as text.' }), { capability: supported, canStart: true, blockedReason: '' });
    expect(view.error).toBeNull();
    expect(view.hint).toMatch(/reading the reply as text/i);
  });
});
