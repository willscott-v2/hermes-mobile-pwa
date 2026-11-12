import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { initialVoiceState, VoiceState } from '../lib/voiceMachine';
import { VoiceControls } from './VoiceControls';

const base = (overrides: Partial<VoiceState>): VoiceState => ({ ...initialVoiceState({ profile: 'default', sessionId: 's' }), ...overrides });
const render = (state: VoiceState, extra: { canStart?: boolean; blockedReason?: string; supported?: boolean } = {}) => renderToStaticMarkup(
  <VoiceControls
    state={state}
    capability={extra.supported === false ? { supported: false, code: 'insecure-context', message: 'Voice needs HTTPS.' } : { supported: true }}
    canStart={extra.canStart ?? true}
    blockedReason={extra.blockedReason ?? ''}
    onAction={() => undefined}
  />,
);

describe('VoiceControls markup', () => {
  it('is a labelled region with a polite live status and a stably named primary button', () => {
    const html = render(base({}));
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Voice controls"');
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
    expect(html).toContain('aria-label="Start talking"');
    expect(html).toContain('data-voice-phase="idle"');
  });

  it('announces partial captions in a live region while listening', () => {
    const html = render(base({ phase: 'listening', partial: 'hello th' }));
    expect(html).toContain('aria-label="Stop and send"');
    expect(html).toMatch(/aria-live="polite"[^>]*data-voice-caption[^>]*>hello th</);
  });

  it('exposes errors as alerts and disables start when unsupported', () => {
    const html = render(base({}), { supported: false });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Voice needs HTTPS.');
    expect(html).toMatch(/<button[^>]*aria-label="Start talking"[^>]*disabled/);
  });

  it('shows why starting is blocked without claiming an error', () => {
    const html = render(base({}), { canStart: false, blockedReason: 'Answer the pending request above first.' });
    expect(html).toContain('Answer the pending request above first.');
    expect(html).not.toContain('role="alert"');
  });
});
