// Pure state machine for LIVE voice: one full-duplex GPT-Live session bound to exactly one Hermes
// session (the pinned Bob chat). Sibling of voiceMachine.ts (the chained dictate → turn → TTS mode);
// the two are deliberately separate because this mode has no dictation/submit/speak turn cycle: the
// voice model owns the microphone and the speaker, and every real request arrives as a DELEGATION.
//
// `transition(state, event)` returns the next state plus effects for the controller. Invariants:
//   - a delegation is routed exactly once: new work → submit, correction → steer, cancel → interrupt,
//     "stop talking" → playback only (never touches the agent turn);
//   - the result of a turn is spoken at most once and only for the delegation it belongs to
//     (a duplicate or late WORK_RESULT is ignored);
//   - exactly one brief acknowledgement per delegation, when work is seen to start;
//   - scope change, hang-up, reset, fatal failure, connection loss and background teardown all emit
//     `release-all`, which must close the peer connection, stop the mic tracks and silence playback.

export type LivePhase = 'idle' | 'connecting' | 'live' | 'working' | 'error';

export interface LiveScope { profile: string; sessionId: string }

export type LiveErrorCode =
  | 'permission-denied'
  | 'insecure-context'
  | 'no-microphone'
  | 'unsupported'
  | 'unavailable'      // status/session said live voice is not configured (503)
  | 'session-failed'   // vendor/transport failure (502, ICE failed, timeout)
  | 'auth-expired'
  | 'internal';

export interface LiveError { code: LiveErrorCode; message: string }

export type DelegationKind = 'new' | 'correction' | 'cancel' | 'stop-speech';

export interface LiveDelegation {
  id: string;          // GPT-Live delegation id the spoken result must be attributed to
  sessionId: string;   // the Hermes session the turn was submitted to (always the scope's)
  utterance: string;   // what the user asked (the persisted prompt)
  context: string;     // bounded recent spoken exchange (model input only)
  startedAt: number;
  acked: boolean;      // the one "on it" acknowledgement has been sent
  replyText: string;   // streamed assistant text, in case message.complete carries no text
}

export interface QueuedDelegation { id: string; utterance: string; context: string; startedAt: number }

export interface LiveVoiceState {
  phase: LivePhase;
  scope: LiveScope | null;
  error: LiveError | null;
  notice: string;
  liveSessionId: string | null; // provider session id (non-secret)
  speaking: boolean;            // remote (assistant) audio is audible
  playbackMuted: boolean;       // barge-in: remote audio silenced locally
  micMuted: boolean;            // page hidden: microphone paused
  delegation: LiveDelegation | null;
  queued: QueuedDelegation[];
  lastUtterance: string;
  spokenIds: string[];          // delegation ids whose result was already spoken (dedupe)
}

export type LiveVoiceEvent =
  | { type: 'START'; scope: LiveScope }
  | { type: 'CONNECTED'; liveSessionId: string | null }
  | { type: 'CONNECT_FAILED'; code: LiveErrorCode; message: string }
  | { type: 'SPEAKING'; speaking: boolean }
  | { type: 'USER_SPEECH_STARTED' }
  | { type: 'USER_UTTERANCE'; text: string }
  | { type: 'DELEGATION'; id: string; utterance: string; context: string; now: number }
  | { type: 'WORK_STARTED' }
  | { type: 'WORK_DELTA'; text: string }
  | { type: 'WORK_RESULT'; text?: string }
  | { type: 'WORK_FAILED'; message: string }
  | { type: 'STEER_RESULT'; accepted: boolean }
  | { type: 'INTERRUPT_RESULT'; interrupted: boolean }
  | { type: 'PROVIDER_ERROR'; message: string }
  | { type: 'SESSION_CLOSED'; reason: string }
  | { type: 'STOP' }
  | { type: 'HIDDEN' }
  | { type: 'VISIBLE' }
  | { type: 'TEARDOWN' }
  | { type: 'PROFILE_CHANGED'; scope: LiveScope | null }
  | { type: 'SESSION_CHANGED'; scope: LiveScope | null }
  | { type: 'GATEWAY_LOST' }
  | { type: 'FAIL'; code: LiveErrorCode; message: string }
  | { type: 'RESET' };

export type LiveVoiceEffect =
  | { type: 'connect'; scope: LiveScope }
  | { type: 'submit'; delegationId: string; sessionId: string; text: string; context: string }
  | { type: 'steer'; delegationId: string; sessionId: string; text: string }
  | { type: 'interrupt'; delegationId: string; sessionId: string }
  | { type: 'say'; delegationId: string; text: string }     // spoken by the voice (commentary)
  | { type: 'think'; delegationId: string; text: string }   // quiet progress for the voice model
  | { type: 'playback-mute' }
  | { type: 'playback-unmute' }
  | { type: 'mic-mute' }
  | { type: 'mic-unmute' }
  | { type: 'schedule-teardown' }
  | { type: 'cancel-teardown' }
  | { type: 'release-all' };

export interface LiveVoiceTransition { state: LiveVoiceState; effects: LiveVoiceEffect[] }

export const ACK_TEXT = 'On it.';
export const QUEUED_ACK_TEXT = 'Got it. I will do that after the current task.';
export const CANCELLED_TEXT = 'Okay, I stopped that.';
export const NOTHING_RUNNING_TEXT = 'Nothing is running right now.';
export const NO_RESULT_TEXT = 'Bob finished that without a spoken result.';
export const DELEGATION_FAILED_TEXT = 'Sorry, I could not reach Bob for that request.';
export const STOP_SPEECH_NOTE = 'The user asked you to stop talking. Stay quiet until they speak again.';

export function initialLiveState(scope: LiveScope | null = null): LiveVoiceState {
  return {
    phase: 'idle',
    scope,
    error: null,
    notice: '',
    liveSessionId: null,
    speaking: false,
    playbackMuted: false,
    micMuted: false,
    delegation: null,
    queued: [],
    lastUtterance: '',
    spokenIds: [],
  };
}

const same = (state: LiveVoiceState, effects: LiveVoiceEffect[] = []): LiveVoiceTransition => ({ state, effects });
const ACTIVE: LivePhase[] = ['connecting', 'live', 'working'];
const CONNECTED: LivePhase[] = ['live', 'working'];
const SPOKEN_IDS_KEPT = 32;

// ---- utterance classification (pure, exported for tests and the controller) ----

const STOP_SPEECH = /^(?:ok(?:ay)?[,.!]?\s+)?(?:stop|shh+|hush|quiet|be quiet|stop talking|that'?s enough|enough|pause)[.!]?$/i;
const CANCEL_WORK = /\b(?:cancel|abort|never ?mind|forget (?:it|that|about it)|stop (?:that|this|it|the task|working|doing that)|don'?t (?:do|bother)|scrap (?:that|it)|kill (?:it|that))\b/i;
const CORRECTION = /^(?:no[,.]?\s|actually\b|wait\b|instead\b|i meant\b|not that\b|correction\b|change (?:that|it)\b|make it\b|rather\b|sorry[,.]?\s+i meant\b)/i;

export function classifyUtterance(text: string, working: boolean): DelegationKind {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'new';
  if (STOP_SPEECH.test(clean)) return 'stop-speech';
  if (CANCEL_WORK.test(clean)) return 'cancel';
  if (working && CORRECTION.test(clean)) return 'correction';
  return 'new';
}

export function isStopSpeech(text: string): boolean {
  return STOP_SPEECH.test(text.replace(/\s+/g, ' ').trim());
}

// ---- transition ----

export function transition(state: LiveVoiceState, event: LiveVoiceEvent): LiveVoiceTransition {
  switch (event.type) {
    case 'START': {
      if (!['idle', 'error'].includes(state.phase)) return same(state);
      return same({ ...initialLiveState(event.scope), phase: 'connecting' }, [{ type: 'connect', scope: event.scope }]);
    }
    case 'CONNECTED':
      if (state.phase !== 'connecting') return same(state);
      return same({ ...state, phase: 'live', liveSessionId: event.liveSessionId, notice: '' });
    case 'CONNECT_FAILED':
      if (state.phase !== 'connecting') return same(state);
      return failed(state, event.code, event.message);

    case 'SPEAKING': {
      if (!CONNECTED.includes(state.phase) || state.speaking === event.speaking) return same(state);
      return same({ ...state, speaking: event.speaking });
    }
    case 'USER_SPEECH_STARTED': {
      // Barge-in: silence the remote track locally first; the model's own VAD cuts generation.
      if (!CONNECTED.includes(state.phase) || !state.speaking || state.playbackMuted) return same(state);
      return same({ ...state, playbackMuted: true }, [{ type: 'playback-mute' }]);
    }
    case 'USER_UTTERANCE': {
      if (!CONNECTED.includes(state.phase)) return same(state);
      const text = event.text.replace(/\s+/g, ' ').trim();
      const next = { ...state, lastUtterance: text };
      if (isStopSpeech(text)) {
        return state.playbackMuted ? same(next) : same({ ...next, playbackMuted: true }, [{ type: 'playback-mute' }]);
      }
      if (state.playbackMuted) return same({ ...next, playbackMuted: false }, [{ type: 'playback-unmute' }]);
      return same(next);
    }

    case 'DELEGATION': {
      if (!CONNECTED.includes(state.phase) || !state.scope) return same(state);
      const sessionId = state.scope.sessionId;
      const utterance = event.utterance.replace(/\s+/g, ' ').trim();
      const working = state.delegation !== null;
      const kind = classifyUtterance(utterance, working);
      if (kind === 'stop-speech') {
        // Playback only. The agent turn, if any, keeps running and its result is still spoken later.
        const effects: LiveVoiceEffect[] = [{ type: 'think', delegationId: event.id, text: STOP_SPEECH_NOTE }];
        if (state.speaking && !state.playbackMuted) effects.unshift({ type: 'playback-mute' });
        return same({ ...state, playbackMuted: state.playbackMuted || state.speaking }, effects);
      }
      if (kind === 'cancel') {
        if (!state.delegation) return same(state, [{ type: 'say', delegationId: event.id, text: NOTHING_RUNNING_TEXT }]);
        return settle({ ...state, delegation: null, queued: [] }, [
          { type: 'interrupt', delegationId: event.id, sessionId },
          { type: 'say', delegationId: event.id, text: CANCELLED_TEXT },
        ]);
      }
      if (kind === 'correction' && state.delegation) {
        // The running turn absorbs the correction; its eventual result answers the latest delegation.
        const delegation: LiveDelegation = { ...state.delegation, id: event.id, utterance, context: event.context };
        return settle({ ...state, delegation }, [{ type: 'steer', delegationId: event.id, sessionId, text: utterance }]);
      }
      if (!utterance) return same(state);
      if (state.delegation) {
        const queued: QueuedDelegation = { id: event.id, utterance, context: event.context, startedAt: event.now };
        return settle({ ...state, queued: [...state.queued, queued] }, [{ type: 'say', delegationId: event.id, text: QUEUED_ACK_TEXT }]);
      }
      const delegation: LiveDelegation = { id: event.id, sessionId, utterance, context: event.context, startedAt: event.now, acked: false, replyText: '' };
      return settle({ ...state, delegation }, [{ type: 'submit', delegationId: event.id, sessionId, text: utterance, context: event.context }]);
    }

    case 'WORK_STARTED': {
      const delegation = state.delegation;
      if (state.phase !== 'working' || !delegation || delegation.acked) return same(state);
      return same({ ...state, delegation: { ...delegation, acked: true } }, [{ type: 'say', delegationId: delegation.id, text: ACK_TEXT }]);
    }
    case 'WORK_DELTA': {
      const delegation = state.delegation;
      if (state.phase !== 'working' || !delegation || !event.text) return same(state);
      return same({ ...state, delegation: { ...delegation, replyText: delegation.replyText + event.text } });
    }
    case 'WORK_RESULT': {
      const delegation = state.delegation;
      if (state.phase !== 'working' || !delegation) return same(state); // duplicate or late: ignored
      const text = (event.text ?? '').trim() || delegation.replyText.trim();
      const effects: LiveVoiceEffect[] = text
        ? [{ type: 'say', delegationId: delegation.id, text }]
        : [{ type: 'think', delegationId: delegation.id, text: NO_RESULT_TEXT }];
      return startNextQueued({ ...state, delegation: null, spokenIds: remember(state.spokenIds, delegation.id) }, effects);
    }
    case 'WORK_FAILED': {
      const delegation = state.delegation;
      if (state.phase !== 'working' || !delegation) return same(state);
      return startNextQueued({ ...state, delegation: null, notice: event.message }, [{ type: 'say', delegationId: delegation.id, text: DELEGATION_FAILED_TEXT }]);
    }
    case 'STEER_RESULT':
      if (state.phase !== 'working' || !state.delegation || event.accepted) return same(state);
      // The gateway could not steer (turn already finished or unsupported): re-submit as new work.
      return same(state, [{ type: 'submit', delegationId: state.delegation.id, sessionId: state.delegation.sessionId, text: state.delegation.utterance, context: state.delegation.context }]);
    case 'INTERRUPT_RESULT':
      return same(state);
    case 'PROVIDER_ERROR':
      return ACTIVE.includes(state.phase) ? same({ ...state, notice: event.message }) : same(state);

    case 'SESSION_CLOSED': {
      if (!ACTIVE.includes(state.phase)) return same(state);
      const dropped = state.delegation ? ' Bob is still working; the answer lands in the chat.' : '';
      const reason = event.reason === 'connection_lost' ? 'Live voice lost its connection.' : 'Live voice ended.';
      return same({ ...initialLiveState(state.scope), notice: `${reason}${dropped}` }, [{ type: 'release-all' }]);
    }
    case 'STOP': {
      if (state.phase === 'idle') return same(state);
      const dropped = state.delegation ? 'Hung up. Bob is still working; the answer lands in the chat.' : '';
      return same({ ...initialLiveState(state.scope), notice: dropped }, [{ type: 'release-all' }]);
    }
    case 'HIDDEN': {
      if (!CONNECTED.includes(state.phase) || state.micMuted) return same(state);
      return same({ ...state, micMuted: true }, [{ type: 'mic-mute' }, { type: 'schedule-teardown' }]);
    }
    case 'VISIBLE': {
      if (!CONNECTED.includes(state.phase) || !state.micMuted) return same(state);
      return same({ ...state, micMuted: false }, [{ type: 'cancel-teardown' }, { type: 'mic-unmute' }]);
    }
    case 'TEARDOWN': {
      if (!ACTIVE.includes(state.phase)) return same(state);
      return same({ ...initialLiveState(state.scope), notice: 'Live voice ended while the app was in the background.' }, [{ type: 'release-all' }]);
    }
    case 'PROFILE_CHANGED':
    case 'SESSION_CHANGED':
      return same(initialLiveState(event.scope), state.phase === 'idle' ? [] : [{ type: 'release-all' }]);
    case 'GATEWAY_LOST': {
      if (state.phase === 'idle' || state.phase === 'error') return same(state);
      return same({ ...initialLiveState(state.scope), notice: 'Connection to Hermes lost. Live voice stopped.' }, [{ type: 'release-all' }]);
    }
    case 'FAIL':
      return failed(state, event.code, event.message);
    case 'RESET':
      return same(initialLiveState(), state.phase === 'idle' ? [] : [{ type: 'release-all' }]);
    default:
      return same(state);
  }
}

function failed(state: LiveVoiceState, code: LiveErrorCode, message: string): LiveVoiceTransition {
  return same({ ...initialLiveState(state.scope), phase: 'error', error: { code, message } }, [{ type: 'release-all' }]);
}

// Derive live/working from whether a delegation is in flight. Never touches idle/connecting/error.
function settle(state: LiveVoiceState, effects: LiveVoiceEffect[] = []): LiveVoiceTransition {
  if (!CONNECTED.includes(state.phase)) return same(state, effects);
  return same({ ...state, phase: state.delegation ? 'working' : 'live' }, effects);
}

function startNextQueued(state: LiveVoiceState, effects: LiveVoiceEffect[]): LiveVoiceTransition {
  const [next, ...rest] = state.queued;
  if (!next || !state.scope) return settle({ ...state, queued: [] }, effects);
  const delegation: LiveDelegation = { id: next.id, sessionId: state.scope.sessionId, utterance: next.utterance, context: next.context, startedAt: next.startedAt, acked: false, replyText: '' };
  return settle({ ...state, delegation, queued: rest }, [...effects, { type: 'submit', delegationId: next.id, sessionId: state.scope.sessionId, text: next.utterance, context: next.context }]);
}

function remember(ids: string[], id: string): string[] {
  return [...ids, id].slice(-SPOKEN_IDS_KEPT);
}
