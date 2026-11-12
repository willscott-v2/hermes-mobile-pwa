import { Mic, Square, Volume2, X } from 'lucide-react';
import type { VoiceCapability } from '../lib/voiceBackend';
import type { VoiceState } from '../lib/voiceMachine';
import { voiceView, VoiceAction } from '../lib/voiceView';

export interface VoiceControlsProps {
  state: VoiceState;
  capability: VoiceCapability;
  canStart: boolean;
  blockedReason: string;
  live?: boolean;
  onAction(action: VoiceAction): void;
}

// Presentational only: it never touches sockets, audio, or the /api/audio protocol.
export function VoiceControls({ state, capability, canStart, blockedReason, live, onAction }: VoiceControlsProps) {
  const view = voiceView(state, { capability, canStart, blockedReason, live });
  const { action, label, disabled } = view.primary;
  const Icon = action === 'start' ? Mic : action === 'interrupt' && state.phase === 'speaking' ? Volume2 : action === 'stop' ? Square : X;
  return (
    <section className="voice-panel" role="region" aria-label="Voice controls" data-voice-phase={state.phase} data-voice-engine={live ? 'live' : 'chained'}>
      <div className="voice-copy">
        <div className="voice-status" role="status" aria-live="polite">{view.status}</div>
        {view.caption && <p className="voice-caption" aria-live="polite" data-voice-caption>{view.caption}</p>}
        {view.hint && <p className="voice-hint">{view.hint}</p>}
        {view.error && <p className="voice-error" role="alert">{view.error}</p>}
      </div>
      <button type="button" className={`voice-main ${action}`} aria-label={label} disabled={disabled} onClick={() => onAction(action)}>
        <Icon size={20} aria-hidden="true" />
        <span>{label}</span>
      </button>
    </section>
  );
}
