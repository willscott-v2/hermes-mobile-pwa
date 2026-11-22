// Pure presentation model for the voice panel: what to say, what the primary control does, and
// whether it is enabled. Keeping this out of the component makes labels/disabled rules testable.

import { ASSISTANT_NAME } from './assistantName';
import type { VoiceCapability } from './voiceBackend';
import type { VoiceState } from './voiceMachine';

export type VoiceAction = 'start' | 'stop' | 'interrupt' | 'cancel';

export interface VoiceView {
  status: string;
  caption: string;
  hint: string;
  error: string | null;
  primary: { action: VoiceAction; label: string; disabled: boolean };
}

export interface VoiceViewContext {
  capability: VoiceCapability;
  canStart: boolean;
  blockedReason: string;
  live?: boolean; // full-duplex live voice: no dictate/send turn, "stop" hangs up
}

export function voiceView(state: VoiceState, context: VoiceViewContext): VoiceView {
  const supported = context.capability.supported;
  const youSaid = state.transcript ? `You said: “${state.transcript}”` : '';
  const hint = state.notice || (state.phase === 'idle' || state.phase === 'interrupted' || state.phase === 'error' ? (!context.canStart ? context.blockedReason : '') : '');
  const capabilityError = !supported && !context.capability.supported ? context.capability.message : null;
  const startable = { action: 'start' as const, label: context.live ? 'Start live voice' : 'Start talking', disabled: !context.canStart || !supported };
  const hangUp = { action: 'stop' as const, label: 'Hang up', disabled: false };

  switch (state.phase) {
    case 'requesting-permission':
      return { status: context.live ? 'Connecting live voice…' : 'Waiting for microphone…', caption: '', hint, error: null, primary: { action: 'cancel', label: 'Cancel voice input', disabled: false } };
    case 'listening':
      if (context.live) return { status: 'Live. Talk any time.', caption: youSaid, hint, error: null, primary: hangUp };
      return { status: 'Listening…', caption: state.partial || 'Say something…', hint, error: null, primary: { action: 'stop', label: 'Stop and send', disabled: false } };
    case 'transcribing':
      return { status: 'Transcribing…', caption: state.partial, hint, error: null, primary: { action: 'cancel', label: 'Cancel voice input', disabled: false } };
    case 'submitting':
      return { status: 'Sending…', caption: youSaid, hint, error: null, primary: { action: 'interrupt', label: 'Stop voice reply', disabled: false } };
    case 'waiting':
      if (context.live) return { status: `${ASSISTANT_NAME} is working. Keep talking.`, caption: youSaid, hint, error: null, primary: hangUp };
      return { status: 'Hermes is replying…', caption: youSaid, hint, error: null, primary: { action: 'interrupt', label: 'Stop voice reply', disabled: false } };
    case 'speaking':
      return { status: context.live ? `${ASSISTANT_NAME} is speaking…` : 'Speaking…', caption: youSaid, hint, error: null, primary: { action: 'interrupt', label: 'Stop speaking', disabled: false } };
    case 'interrupted':
      return { status: 'Stopped. The text reply stays in the chat.', caption: youSaid, hint, error: capabilityError, primary: startable };
    case 'error':
      return { status: 'Voice problem', caption: youSaid, hint, error: state.error?.message ?? capabilityError ?? 'Voice stopped unexpectedly.', primary: startable };
    default:
      return { status: supported ? (context.live ? 'Live voice ready' : 'Ready') : 'Voice unavailable', caption: state.transcript ? youSaid : '', hint, error: capabilityError, primary: startable };
  }
}
