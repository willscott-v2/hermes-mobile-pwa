// Presents live-voice state through the existing VoiceControls panel (no new UI surface): maps a
// LiveVoiceState onto the chained VoiceState shape and flags the view as live so labels read
// "Hang up" / "Stop speaking" instead of "Stop and send".

import type { LiveVoiceState } from './liveVoiceMachine';
import { initialVoiceState, VoiceErrorCode, VoiceState } from './voiceMachine';

function errorCode(code: NonNullable<LiveVoiceState['error']>['code']): VoiceErrorCode {
  switch (code) {
    case 'permission-denied':
    case 'insecure-context':
    case 'no-microphone':
    case 'unsupported':
      return code;
    default:
      return 'internal';
  }
}

export function liveStateToVoiceState(live: LiveVoiceState): VoiceState {
  const base = initialVoiceState(live.scope);
  const transcript = live.delegation?.utterance || live.lastUtterance;
  switch (live.phase) {
    case 'connecting':
      return { ...base, phase: 'requesting-permission', notice: live.notice };
    case 'live':
      return { ...base, phase: live.speaking && !live.playbackMuted ? 'speaking' : 'listening', transcript, notice: live.notice, speechActive: live.speaking };
    case 'working':
      return { ...base, phase: live.speaking && !live.playbackMuted ? 'speaking' : 'waiting', transcript, notice: live.notice, assistantStarted: true, speechActive: live.speaking };
    case 'error':
      return { ...base, phase: 'error', error: live.error ? { code: errorCode(live.error.code), message: live.error.message } : null, notice: live.notice };
    default:
      return { ...base, phase: 'idle', transcript: live.lastUtterance, notice: live.notice };
  }
}
