// Pure, UI-independent state machine for the voice mode of an ordinary chat.
//
// `transition(state, event)` returns the next state plus the side effects the controller must run.
// Nothing here touches the DOM, sockets, timers or React, so every invariant is unit-testable:
//   - a transcript is submitted only from a final STT result, exactly once, never when blank;
//   - partial text is a caption only and is never submitted;
//   - TTS trouble never fails the chat turn (it degrades to readable text);
//   - any scope change, reset, or fatal failure releases every audio/socket resource.

export type VoicePhase =
  | 'idle'
  | 'requesting-permission'
  | 'listening'
  | 'transcribing'
  | 'submitting'
  | 'waiting'
  | 'speaking'
  | 'interrupted'
  | 'error';

export interface VoiceScope { profile: string; sessionId: string }

export type VoiceErrorCode =
  | 'permission-denied'
  | 'insecure-context'
  | 'no-microphone'
  | 'unsupported'
  | 'stt-failed'
  | 'stt-disconnected'
  | 'prompt-failed'
  | 'internal';

export interface VoiceError { code: VoiceErrorCode; message: string }

export interface VoiceState {
  phase: VoicePhase;
  scope: VoiceScope | null;
  partial: string;       // ephemeral caption, never submitted
  transcript: string;    // last submitted final transcript
  notice: string;        // non-fatal, user-readable (blank transcript, TTS degraded)
  error: VoiceError | null;
  assistantStarted: boolean;
  assistantComplete: boolean;
  fedText: boolean;      // any assistant text has been sent to TTS this turn
  speechPending: boolean; // text sent to TTS and the server has not ended/failed yet
  speechActive: boolean;  // audio is audibly playing
  speechAvailable: boolean; // false after TTS failure/fallback or a user interrupt, for the rest of the turn
}

export type VoiceEvent =
  | { type: 'START'; scope: VoiceScope }
  | { type: 'MIC_GRANTED' }
  | { type: 'MIC_DENIED'; code?: VoiceErrorCode; message?: string }
  | { type: 'STT_PARTIAL'; text: string }
  | { type: 'STT_FINAL'; text: string }
  | { type: 'STOP' }
  | { type: 'PROMPT_ACCEPTED' }
  | { type: 'ASSISTANT_DELTA'; text: string }
  | { type: 'ASSISTANT_COMPLETE'; text?: string }
  | { type: 'TTS_STARTED' }
  | { type: 'TTS_ENDED' }
  | { type: 'TTS_FAILED'; message?: string }
  | { type: 'INTERRUPT' }
  | { type: 'PROFILE_CHANGED'; scope: VoiceScope | null }
  | { type: 'SESSION_CHANGED'; scope: VoiceScope | null }
  | { type: 'SOCKET_CLOSED'; channel: 'stt' | 'tts' }
  | { type: 'GATEWAY_LOST' }
  | { type: 'FAIL'; code: VoiceErrorCode; message: string }
  | { type: 'RESET' };

export type VoiceEffect =
  | { type: 'begin-capture'; scope: VoiceScope }
  | { type: 'finish-capture' }   // stop the microphone and send end-of-stream; keep the STT socket for the final
  | { type: 'cancel-capture' }   // discard: stop the microphone and drop the STT socket without a final
  | { type: 'submit'; text: string }
  | { type: 'restore-transcript'; text: string } // the final transcript was never accepted: hand it back to the UI draft
  | { type: 'speech-text'; text: string }
  | { type: 'speech-finish' }
  | { type: 'speech-stop' }      // silence playback and tell the server to stop; text is untouched
  | { type: 'release-all' };

export function initialVoiceState(scope: VoiceScope | null = null): VoiceState {
  return {
    phase: 'idle',
    scope,
    partial: '',
    transcript: '',
    notice: '',
    error: null,
    assistantStarted: false,
    assistantComplete: false,
    fedText: false,
    speechPending: false,
    speechActive: false,
    speechAvailable: true,
  };
}

export interface VoiceTransition { state: VoiceState; effects: VoiceEffect[] }

const same = (state: VoiceState, effects: VoiceEffect[] = []): VoiceTransition => ({ state, effects });

const STARTABLE: VoicePhase[] = ['idle', 'interrupted', 'error'];
const CAPTURE_PHASES: VoicePhase[] = ['requesting-permission', 'listening', 'transcribing'];
const TURN_PHASES: VoicePhase[] = ['submitting', 'waiting', 'speaking'];

export function transition(state: VoiceState, event: VoiceEvent): VoiceTransition {
  switch (event.type) {
    case 'START': {
      if (!STARTABLE.includes(state.phase)) return same(state);
      return {
        state: { ...initialVoiceState(event.scope), phase: 'requesting-permission' },
        effects: [{ type: 'begin-capture', scope: event.scope }],
      };
    }
    case 'MIC_GRANTED':
      return state.phase === 'requesting-permission' ? same({ ...state, phase: 'listening' }) : same(state);
    case 'MIC_DENIED':
      if (state.phase !== 'requesting-permission') return same(state);
      return failed(state, event.code ?? 'permission-denied', event.message ?? 'Microphone access was denied.');
    case 'STT_PARTIAL':
      return state.phase === 'listening' || state.phase === 'transcribing' ? same({ ...state, partial: event.text }) : same(state);
    case 'STT_FINAL': {
      if (state.phase !== 'transcribing') return same(state);
      const text = event.text.trim();
      if (!text) {
        return same({ ...state, phase: 'idle', partial: '', notice: 'Didn’t catch anything. Nothing was sent.' }, [{ type: 'cancel-capture' }]);
      }
      return same({ ...state, phase: 'submitting', partial: '', transcript: text, notice: '' }, [{ type: 'submit', text }]);
    }
    case 'STOP': {
      if (state.phase === 'requesting-permission') return same({ ...state, phase: 'idle', partial: '' }, [{ type: 'cancel-capture' }]);
      if (state.phase === 'listening') return same({ ...state, phase: 'transcribing' }, [{ type: 'finish-capture' }]);
      return same(state);
    }
    case 'SOCKET_CLOSED': {
      if (event.channel === 'stt' && CAPTURE_PHASES.includes(state.phase)) {
        return failed(state, 'stt-disconnected', 'Dictation disconnected. Nothing was sent.', [{ type: 'cancel-capture' }]);
      }
      // Any unexpected TTS close during a turn (even before the first delta) ends speech for the
      // rest of the turn; a clean end closes our side first, so its late socket close never lands here.
      if (event.channel === 'tts' && TURN_PHASES.includes(state.phase) && state.speechAvailable) return degradeSpeech(state);
      return same(state);
    }
    case 'PROMPT_ACCEPTED':
      return state.phase === 'submitting' ? settle({ ...state, phase: 'waiting' }) : same(state);
    case 'ASSISTANT_DELTA': {
      if (!TURN_PHASES.includes(state.phase)) return same(state);
      const next: VoiceState = { ...state, assistantStarted: true };
      const speak = state.speechAvailable && event.text.length > 0;
      return settle(
        speak ? { ...next, fedText: true, speechPending: true } : next,
        speak ? [{ type: 'speech-text', text: event.text }] : [],
      );
    }
    case 'ASSISTANT_COMPLETE': {
      if (!TURN_PHASES.includes(state.phase)) return same(state);
      const effects: VoiceEffect[] = [];
      let next: VoiceState = { ...state, assistantStarted: true, assistantComplete: true };
      const finalText = (event.text ?? '').trim();
      if (state.speechAvailable) {
        // A reply that never streamed (final text only) is still spoken.
        if (!state.fedText && finalText) {
          effects.push({ type: 'speech-text', text: finalText });
          next = { ...next, fedText: true, speechPending: true };
        }
        if (next.fedText) effects.push({ type: 'speech-finish' });
      }
      return settle(next, effects);
    }
    case 'TTS_STARTED':
      if (!TURN_PHASES.includes(state.phase) || !state.speechAvailable) return same(state);
      return settle({ ...state, speechActive: true, speechPending: true });
    case 'TTS_ENDED':
      if (!TURN_PHASES.includes(state.phase)) return same(state);
      // Synthesis only ends after we send `done` (on complete). An earlier end is an early
      // termination: later deltas must not target a finished speech session.
      if (!state.assistantComplete && state.speechAvailable) return degradeSpeech(state);
      return settle({ ...state, speechActive: false, speechPending: false });
    case 'TTS_FAILED':
      // Never fails the chat turn: speech is dropped for the rest of the turn and text stays readable.
      return TURN_PHASES.includes(state.phase) ? degradeSpeech(state) : same(state);
    case 'INTERRUPT': {
      if (CAPTURE_PHASES.includes(state.phase)) return same({ ...state, phase: 'idle', partial: '' }, [{ type: 'cancel-capture' }]);
      if (TURN_PHASES.includes(state.phase)) {
        return same({ ...state, phase: 'interrupted', speechAvailable: false, speechPending: false, speechActive: false }, [{ type: 'speech-stop' }]);
      }
      return same(state);
    }
    case 'PROFILE_CHANGED':
    case 'SESSION_CHANGED':
      // Idle holds no mic/socket/playback, so only the scope moves; anything else is released.
      return same(initialVoiceState(event.scope), state.phase === 'idle' ? [] : [{ type: 'release-all' }]);
    case 'RESET':
      return same(initialVoiceState(), [{ type: 'release-all' }]);
    case 'FAIL':
      return failed(state, event.code, event.message);
    case 'GATEWAY_LOST':
      // The chat transport dropped: the turn this voice session belongs to is abandoned. Idle holds
      // nothing and an error already released everything, so only an active capture/turn resets.
      if (state.phase === 'idle' || state.phase === 'error') return same(state);
      // A drop before the prompt was accepted may have lost the submit: give the exact final
      // transcript back once (the late submit result is ignored, so it can never double up).
      if (state.phase === 'submitting' && state.transcript) {
        return same(
          { ...initialVoiceState(state.scope), notice: 'Connection lost before your message was sent. It is back in the composer.' },
          [{ type: 'restore-transcript', text: state.transcript }, { type: 'release-all' }],
        );
      }
      return same(
        { ...initialVoiceState(state.scope), notice: 'Connection lost. Voice stopped; nothing more will be spoken.' },
        [{ type: 'release-all' }],
      );
    default:
      return same(state);
  }
}

function failed(state: VoiceState, code: VoiceErrorCode, message: string, extra: VoiceEffect[] = []): VoiceTransition {
  return same(
    { ...state, phase: 'error', partial: '', error: { code, message }, speechPending: false, speechActive: false },
    [...extra, { type: 'release-all' }],
  );
}

// Derive the visible phase of an active turn from the facts we track. Never touches idle/interrupted/error.
function settle(state: VoiceState, effects: VoiceEffect[] = []): VoiceTransition {
  if (!TURN_PHASES.includes(state.phase)) return same(state, effects);
  if (state.assistantComplete && !state.speechPending) return same({ ...state, phase: 'idle', speechActive: false }, effects);
  if (state.speechActive) return same({ ...state, phase: 'speaking' }, effects);
  if (state.assistantStarted || state.phase === 'waiting' || state.phase === 'speaking') return same({ ...state, phase: 'waiting' }, effects);
  return same(state, effects);
}

function degradeSpeech(state: VoiceState): VoiceTransition {
  return settle(
    { ...state, speechAvailable: false, speechPending: false, speechActive: false, notice: 'Voice playback is unavailable. Reading the reply as text.' },
    [{ type: 'speech-stop' }],
  );
}
