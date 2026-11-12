// Framework-free voice controller. Owns the VoiceMachine state, runs its effects against a
// transport-neutral VoiceBackend, and guards every async callback with an epoch so a superseded
// or released session can never affect the current one. React only subscribes (useVoiceController).

import { eventText, redactForLog } from './hermesApi';
import type { JsonRpcEvent } from './jsonRpc';
import { DictationSession, SpeechSession, VoiceBackend } from './voiceBackend';
import { initialVoiceState, transition, VoiceEffect, VoiceErrorCode, VoiceEvent, VoiceScope, VoiceState } from './voiceMachine';

export interface VoiceControllerDeps {
  backend: VoiceBackend;
  // Must be the same submit path as the text composer (GatewayHandle.submitPrompt on the live session).
  submitText(text: string): Promise<void>;
  onState(state: VoiceState): void;
  // Lets the UI hand an unsent transcript back (e.g. into the composer draft).
  onSubmitFailed?(text: string, message: string): void;
}

const MIC_CODES: VoiceErrorCode[] = ['permission-denied', 'no-microphone', 'insecure-context', 'unsupported'];

export class VoiceController {
  private state: VoiceState = initialVoiceState();
  private dictation: DictationSession | null = null;
  private speech: SpeechSession | null = null;
  private epoch = 0;        // bumps on every start/release: guards dictation + prompt callbacks
  private speechEpoch = 0;  // bumps on every speech open/close: guards speech callbacks
  private disposed = false;

  constructor(private readonly deps: VoiceControllerDeps) {}

  getState(): VoiceState {
    return this.state;
  }

  capability() {
    return this.deps.backend.capability();
  }

  // Call from a user gesture: audio is unlocked and the microphone requested synchronously.
  start(scope: VoiceScope): void {
    if (this.disposed) return;
    const capability = this.deps.backend.capability();
    if (!capability.supported) {
      this.dispatch({ type: 'FAIL', code: capability.code, message: redactForLog(capability.message) });
      return;
    }
    this.deps.backend.unlockAudio();
    this.dispatch({ type: 'START', scope });
  }

  stop(): void { this.dispatch({ type: 'STOP' }); }
  interrupt(): void { this.dispatch({ type: 'INTERRUPT' }); }
  reset(): void { this.dispatch({ type: 'RESET' }); }
  pageHidden(): void { this.dispatch({ type: 'RESET' }); }

  scopeChanged(scope: VoiceScope | null): void {
    const current = this.state.scope;
    if (current === scope) return;
    if (current && scope && current.profile === scope.profile && current.sessionId === scope.sessionId) return;
    const profileChanged = (current?.profile ?? null) !== (scope?.profile ?? null);
    this.dispatch(profileChanged ? { type: 'PROFILE_CHANGED', scope } : { type: 'SESSION_CHANGED', scope });
  }

  // The chat gateway closed or failed fatally: abandon any active voice capture/turn so a later
  // reconnect or resume cannot be spoken as part of it.
  gatewayLost(): void { this.dispatch({ type: 'GATEWAY_LOST' }); }

  gatewayEvent(event: JsonRpcEvent): void {
    // Real frames carry the live gateway session id. Voice fails closed: only an exact match with
    // the active scope's live session is ever spoken (a missing id is never assumed to be ours).
    const live = this.state.scope?.sessionId;
    if (!live || event.session_id !== live) return;
    if (event.type === 'message.delta') {
      this.dispatch({ type: 'ASSISTANT_DELTA', text: eventText(event, ['text', 'delta', 'content']) });
    } else if (event.type === 'message.complete') {
      this.dispatch({ type: 'ASSISTANT_COMPLETE', text: eventText(event, ['text', 'content']) });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.dispatch({ type: 'RESET' });
    this.disposed = true;
  }

  private dispatch(event: VoiceEvent): void {
    const result = transition(this.state, event);
    const changed = result.state !== this.state;
    this.state = result.state;
    for (const effect of result.effects) this.run(effect);
    // An idle machine owns no speech session: a turn that never produced speakable text ends here.
    if (this.state.phase === 'idle' && this.speech) this.closeSpeech();
    if (changed && !this.disposed) this.deps.onState(this.state);
  }

  private run(effect: VoiceEffect): void {
    switch (effect.type) {
      case 'begin-capture': return this.beginCapture(effect.scope);
      case 'finish-capture': this.dictation?.finish(); return;
      case 'cancel-capture': this.cancelCapture(); return;
      case 'submit': return this.submit(effect.text);
      case 'restore-transcript': this.deps.onSubmitFailed?.(effect.text, 'Connection lost before the message was sent.'); return;
      case 'speech-text': this.speech?.speak(effect.text); return;
      case 'speech-finish': this.speech?.finish(); return;
      case 'speech-stop': this.speech?.stop(); this.closeSpeech(); return;
      case 'release-all': return this.releaseAll();
    }
  }

  private beginCapture(scope: VoiceScope): void {
    const epoch = ++this.epoch;
    const live = () => epoch === this.epoch && !this.disposed;
    this.dictation = this.deps.backend.startDictation(scope, {
      onListening: () => { if (live()) this.dispatch({ type: 'MIC_GRANTED' }); },
      onPartial: (text) => { if (live()) this.dispatch({ type: 'STT_PARTIAL', text }); },
      onFinal: (text) => {
        if (!live()) return;
        this.dictation = null; // the backend already released the capture + socket
        this.dispatch({ type: 'STT_FINAL', text });
      },
      onError: (error) => {
        if (!live()) return;
        if (this.state.phase === 'requesting-permission' && MIC_CODES.includes(error.code)) {
          this.dispatch({ type: 'MIC_DENIED', code: error.code, message: redactForLog(error.message) });
        } else {
          this.dispatch({ type: 'FAIL', code: error.code === 'internal' ? 'stt-failed' : error.code, message: redactForLog(error.message) });
        }
      },
      onClosed: () => { if (live()) this.dispatch({ type: 'SOCKET_CLOSED', channel: 'stt' }); },
    });
  }

  private cancelCapture(): void {
    this.dictation?.cancel();
    this.dictation = null;
  }

  private submit(text: string): void {
    const turn = this.epoch;
    const scope = this.state.scope;
    if (scope) this.openSpeech(scope);
    void (async () => {
      try {
        await this.deps.submitText(text);
      } catch (error) {
        if (turn !== this.epoch || this.disposed) return;
        const message = redactForLog(error instanceof Error && error.message ? error.message : 'Not sent.');
        this.deps.onSubmitFailed?.(text, message);
        this.dispatch({ type: 'FAIL', code: 'prompt-failed', message });
        return;
      }
      if (turn === this.epoch && !this.disposed) this.dispatch({ type: 'PROMPT_ACCEPTED' });
    })();
  }

  private openSpeech(scope: VoiceScope): void {
    this.closeSpeech();
    const epoch = ++this.speechEpoch;
    const live = () => epoch === this.speechEpoch && !this.disposed;
    this.speech = this.deps.backend.openSpeech(scope, {
      onStarted: () => { if (live()) this.dispatch({ type: 'TTS_STARTED' }); },
      onEnded: () => { if (!live()) return; this.dispatch({ type: 'TTS_ENDED' }); this.closeSpeech(); },
      onFallback: () => { if (live()) this.dispatch({ type: 'TTS_FAILED', message: 'fallback' }); },
      onError: (error) => { if (live()) this.dispatch({ type: 'TTS_FAILED', message: redactForLog(error.message) }); },
      onClosed: () => { if (live()) this.dispatch({ type: 'SOCKET_CLOSED', channel: 'tts' }); },
    });
  }

  private closeSpeech(): void {
    this.speechEpoch += 1;
    this.speech?.close();
    this.speech = null;
  }

  private releaseAll(): void {
    this.epoch += 1;
    this.cancelCapture();
    this.closeSpeech();
    this.deps.backend.dispose();
  }
}
