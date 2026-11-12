// Transport-neutral voice contract. The chat UI and controller depend only on this file: nothing
// here knows about /api/audio/* paths, WebSockets, PCM framing or tickets. ChainedVoiceBackend
// (separate STT socket + chat turn + TTS socket) is one implementation; a speech-to-speech
// realtime adapter can replace it without touching the chat controls.

import { redactForLog } from './hermesApi';
import type { VoiceErrorCode, VoiceScope } from './voiceMachine';

export type VoiceCapability =
  | { supported: true }
  | { supported: false; code: Extract<VoiceErrorCode, 'insecure-context' | 'no-microphone' | 'unsupported'>; message: string };

export class VoiceBackendError extends Error {
  constructor(public readonly code: VoiceErrorCode, message: string) {
    // Browser and server errors can echo a socket URL; never let a ticket/token reach the UI.
    super(redactForLog(message));
    this.name = 'VoiceBackendError';
  }
}

export interface DictationHandlers {
  onListening(): void;               // microphone granted and audio is flowing to the transcriber
  onPartial(text: string): void;     // ephemeral caption
  onFinal(text: string): void;       // authoritative transcript, delivered at most once
  onError(error: VoiceBackendError): void;
  onClosed(): void;                  // transport went away before a final arrived or the session was cancelled
}

export interface DictationSession {
  finish(): void;  // stop the microphone and ask for the final transcript
  cancel(): void;  // discard: release the microphone and drop the transport without a final
}

export interface SpeechHandlers {
  onStarted(): void;   // first audio is audible
  onEnded(): void;     // all audio finished playing
  onFallback(): void;  // the server could not synthesize; the reply stays text-only
  onError(error: VoiceBackendError): void;
  onClosed(): void;
}

export interface SpeechSession {
  speak(text: string): void;  // incremental assistant text, in order
  finish(): void;             // the reply is complete
  stop(): void;               // silence now and tell the server to stop; text elsewhere is untouched
  close(): void;              // release the transport and any queued audio
}

export interface VoiceBackend {
  readonly id: string;
  capability(): VoiceCapability;
  // Must be called synchronously inside the user gesture that starts voice (unlocks/resumes audio).
  unlockAudio(): void;
  // Both return immediately; progress arrives via handlers. Everything opened is tagged with the
  // scope's profile.
  startDictation(scope: VoiceScope, handlers: DictationHandlers): DictationSession;
  openSpeech(scope: VoiceScope, handlers: SpeechHandlers): SpeechSession;
  // Idempotent. Closes every socket, source, track and the audio context.
  dispose(): void;
}
