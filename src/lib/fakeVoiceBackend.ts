// Deterministic VoiceBackend for mock mode, unit tests and Playwright: no microphone, provider, or
// audio server. Everything is scriptable and every call is recorded so tests can assert which
// profile/session each "socket" was opened for and that it was released.

import { DictationHandlers, DictationSession, SpeechHandlers, SpeechSession, VoiceBackend, VoiceBackendError, VoiceCapability } from './voiceBackend';
import type { VoiceErrorCode, VoiceScope } from './voiceMachine';

export interface FakeAutoScript {
  listen: boolean;             // report "listening" right after startDictation
  transcript: string | null;   // when set, finish() answers with this final transcript
  deny: VoiceErrorCode | null; // when set, startDictation fails like a denied microphone
  speak: boolean;              // report started/ended for speech automatically
  failSpeech: boolean;         // speech reports an error on first text
  fallbackSpeech: boolean;     // speech reports a server fallback on first text
}

export class FakeDictation implements DictationSession {
  finished = false;
  cancelled = false;
  settled = false;
  constructor(readonly scope: VoiceScope, readonly handlers: DictationHandlers) {}
  get live() { return !this.cancelled && !this.settled; }
  listening() { if (this.live) this.handlers.onListening(); }
  partial(text: string) { if (this.live) this.handlers.onPartial(text); }
  final(text: string) { if (this.live) { this.settled = true; this.handlers.onFinal(text); } }
  error(code: VoiceErrorCode, message: string) { if (this.live) { this.settled = true; this.handlers.onError(new VoiceBackendError(code, message)); } }
  closed() { if (this.live) { this.settled = true; this.handlers.onClosed(); } }
  finish() { this.finished = true; }
  cancel() { this.cancelled = true; }
}

export class FakeSpeech implements SpeechSession {
  spoken: string[] = [];
  done = false;
  stopped = false;
  closedByUs = false;
  over = false;
  constructor(readonly scope: VoiceScope, readonly handlers: SpeechHandlers) {}
  get live() { return !this.stopped && !this.closedByUs && !this.over; }
  speak(text: string) { if (this.live) this.spoken.push(text); }
  finish() { if (this.live) this.done = true; }
  stop() { this.stopped = true; }
  close() { this.closedByUs = true; }
  started() { if (this.live) this.handlers.onStarted(); }
  ended() { if (this.live) { this.over = true; this.handlers.onEnded(); } }
  fallback() { if (this.live) { this.over = true; this.handlers.onFallback(); } }
  error(message = 'speech failed') { if (this.live) { this.over = true; this.handlers.onError(new VoiceBackendError('internal', message)); } }
  closedByServer() { if (this.live) { this.over = true; this.handlers.onClosed(); } }
}

export class FakeVoiceBackend implements VoiceBackend {
  readonly id = 'fake';
  capabilityResult: VoiceCapability = { supported: true };
  unlocks = 0;
  disposals = 0;
  dictations: FakeDictation[] = [];
  speeches: FakeSpeech[] = [];
  auto: FakeAutoScript = { listen: false, transcript: null, deny: null, speak: false, failSpeech: false, fallbackSpeech: false };

  capability(): VoiceCapability { return this.capabilityResult; }
  unlockAudio(): void { this.unlocks += 1; }

  startDictation(scope: VoiceScope, handlers: DictationHandlers): DictationSession {
    const dictation = new FakeDictation(scope, handlers);
    this.dictations.push(dictation);
    const finish = dictation.finish.bind(dictation);
    dictation.finish = () => {
      finish();
      const transcript = this.auto.transcript;
      if (transcript !== null) setTimeout(() => dictation.final(transcript), 40);
    };
    queueMicrotask(() => {
      if (this.auto.deny) {
        dictation.error(this.auto.deny, this.auto.deny === 'permission-denied' ? 'Microphone permission was denied.' : 'Voice is unavailable.');
        return;
      }
      if (!this.auto.listen) return;
      dictation.listening();
      const transcript = this.auto.transcript;
      if (transcript) setTimeout(() => dictation.partial(transcript.split(' ').slice(0, 3).join(' ')), 20);
    });
    return dictation;
  }

  openSpeech(scope: VoiceScope, handlers: SpeechHandlers): SpeechSession {
    const speech = new FakeSpeech(scope, handlers);
    this.speeches.push(speech);
    let first = true;
    const speak = speech.speak.bind(speech);
    speech.speak = (text) => {
      speak(text);
      if (!first) return;
      first = false;
      if (this.auto.failSpeech) setTimeout(() => speech.error(), 10);
      else if (this.auto.fallbackSpeech) setTimeout(() => speech.fallback(), 10);
      else if (this.auto.speak) setTimeout(() => speech.started(), 10);
    };
    const finish = speech.finish.bind(speech);
    speech.finish = () => {
      finish();
      if (this.auto.speak && !this.auto.failSpeech && !this.auto.fallbackSpeech) setTimeout(() => speech.ended(), 150);
    };
    return speech;
  }

  dispose(): void {
    this.disposals += 1;
    for (const dictation of this.dictations) dictation.cancel();
    for (const speech of this.speeches) speech.close();
  }

  // Plain, serializable view for Playwright assertions.
  snapshot() {
    return {
      unlocks: this.unlocks,
      disposals: this.disposals,
      dictations: this.dictations.map((item) => ({ ...item.scope, finished: item.finished, cancelled: item.cancelled, settled: item.settled })),
      speeches: this.speeches.map((item) => ({ ...item.scope, spoken: item.spoken, done: item.done, stopped: item.stopped, closed: item.closedByUs })),
    };
  }
}
