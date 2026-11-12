// Framework-free controller for live voice. Owns the LiveVoiceMachine state and one transport
// session, runs effects against injected deps (session factory, SDP exchange, gateway submit/steer/
// interrupt), and guards every async callback with an epoch so a superseded or released session can
// never affect the current one. Mirrors voiceController.ts for the chained mode; React only
// subscribes (useLiveVoice).

import { HttpError, InterruptOutcome, redactForLog, SteerOutcome, VoiceLiveHistoryMessage } from './hermesApi';
import type { JsonRpcEvent } from './jsonRpc';
import { eventText } from './hermesApi';
import { initialLiveState, LiveErrorCode, LiveScope, LiveVoiceEffect, LiveVoiceEvent, LiveVoiceState, transition } from './liveVoiceMachine';
import { LiveSessionHandlers, LiveTranscriptFragment, LiveVoiceSessionError } from './liveVoiceSession';

// The slice of LiveVoiceSession the controller drives (structural, so tests can fake it).
export interface LiveSessionLike {
  readonly liveSessionId: string | null;
  start(exchange: (offerSdp: string) => Promise<{ sessionId: string | null; sdp: string }>): Promise<void>;
  say(delegationId: string | null, content: string): void;
  think(delegationId: string | null, content: string): void;
  setMicMuted(muted: boolean): void;
  setPlaybackMuted(muted: boolean): void;
  close(): void;
  release(): void;
}

export interface LiveVoiceControllerDeps {
  createSession(handlers: LiveSessionHandlers): LiveSessionLike;
  // Authenticated POST /api/audio/voice-live/session for the scope's profile. Throws HttpError.
  exchange(scope: LiveScope, offerSdp: string): Promise<{ sessionId: string | null; sdp: string }>;
  // Delegated turn → the pinned session, tagged surface 'voice-live' (+ bounded voice context).
  submit(sessionId: string, text: string, voiceContext: string): Promise<void>;
  steer(sessionId: string, text: string): Promise<SteerOutcome>;
  interrupt?(sessionId: string): Promise<InterruptOutcome>;
  onState(state: LiveVoiceState): void;
  now?(): number;
  setTimeout?(fn: () => void, ms: number): number;
  clearTimeout?(id: number): void;
  utteranceSettleMs?: number;  // quiet after the last user fragment before the utterance is judged
  teardownGraceMs?: number;    // hidden → torn down after this unless the page returns
}

const UTTERANCE_SETTLE_MS = 1_500;
const TEARDOWN_GRACE_MS = 20_000;

// Turn transcript fragments into the Hermes turn: `prompt` is what the user last said (the
// persisted user row), `context` the recent spoken exchange that rides the model input only.
// Port of the desktop's delegationPrompt (use-voice-live-conversation.ts).
export function delegationPrompt(context: LiveTranscriptFragment[]): { prompt: string; context: string } {
  const turns: Array<{ speaker: 'user' | 'assistant'; text: string }> = [];
  for (const fragment of context) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === fragment.speaker) last.text += fragment.text;
    else turns.push({ speaker: fragment.speaker, text: fragment.text });
  }
  const lastUser = [...turns].reverse().find((turn) => turn.speaker === 'user');
  const prompt = (lastUser?.text ?? '').replace(/\s+/g, ' ').trim();
  const transcript = turns
    .map((turn) => `${turn.speaker === 'user' ? 'User' : 'Voice assistant'}: ${turn.text.replace(/\s+/g, ' ').trim()}`)
    .filter((line) => !line.endsWith(': '))
    .join('\n');
  return { prompt: prompt || transcript.slice(-400), context: transcript };
}

// Seed history for a new live session from the chat transcript (text turns only): newest ≤24
// messages / ≤6000 chars, each clipped to 1200 chars. Desktop parity (toLiveHistory).
export function toLiveHistory(turns: Array<{ role: string; text: string }>, maxMessages = 24, maxChars = 6_000): VoiceLiveHistoryMessage[] {
  const out: VoiceLiveHistoryMessage[] = [];
  let budget = maxChars;
  for (const turn of [...turns].reverse()) {
    if (turn.role !== 'user' && turn.role !== 'assistant') continue;
    const text = turn.text.replace(/\s+/g, ' ').trim().slice(0, 1_200);
    if (!text) continue;
    if (out.length >= maxMessages || budget - text.length < 0) break;
    budget -= text.length;
    out.unshift({ type: 'message', role: turn.role, content: [{ type: turn.role === 'assistant' ? 'output_text' : 'input_text', text }] });
  }
  return out;
}

export function classifyStartError(error: unknown): { code: LiveErrorCode; message: string } {
  if (error instanceof LiveVoiceSessionError) return { code: error.code, message: redactForLog(error.message) };
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) return { code: 'auth-expired', message: 'Sign in again to use live voice.' };
    if (error.status === 503) return { code: 'unavailable', message: 'Live voice is not configured on this Hermes.' };
    return { code: 'session-failed', message: redactForLog(error.message || `Live voice failed (HTTP ${error.status}).`) };
  }
  return { code: 'session-failed', message: redactForLog(error instanceof Error && error.message ? error.message : 'Live voice could not start.') };
}

export class LiveVoiceController {
  private state: LiveVoiceState = initialLiveState();
  private session: LiveSessionLike | null = null;
  private epoch = 0;
  private disposed = false;
  private utterance = '';
  private utteranceTimer: number | null = null;
  private teardownTimer: number | null = null;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => number;
  private readonly clearTimer: (id: number) => void;

  constructor(private readonly deps: LiveVoiceControllerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
    this.clearTimer = deps.clearTimeout ?? ((id) => clearTimeout(id));
  }

  getState(): LiveVoiceState { return this.state; }

  start(scope: LiveScope): void { if (!this.disposed) this.dispatch({ type: 'START', scope }); }
  stop(): void { this.dispatch({ type: 'STOP' }); }
  reset(): void { this.dispatch({ type: 'RESET' }); }
  pageHidden(): void { this.dispatch({ type: 'HIDDEN' }); }
  pageVisible(): void { this.dispatch({ type: 'VISIBLE' }); }
  gatewayLost(): void { this.dispatch({ type: 'GATEWAY_LOST' }); }
  // Manual barge-in from the UI (the "stop speaking" control).
  stopSpeaking(): void { this.dispatch({ type: 'USER_UTTERANCE', text: 'stop' }); }

  scopeChanged(scope: LiveScope | null): void {
    const current = this.state.scope;
    if (current === scope) return;
    if (current && scope && current.profile === scope.profile && current.sessionId === scope.sessionId) return;
    const profileChanged = (current?.profile ?? null) !== (scope?.profile ?? null);
    this.dispatch(profileChanged ? { type: 'PROFILE_CHANGED', scope } : { type: 'SESSION_CHANGED', scope });
  }

  // Only frames tagged with the exact pinned live session id are ever correlated to a delegation.
  gatewayEvent(event: JsonRpcEvent): void {
    const live = this.state.scope?.sessionId;
    if (!live || event.session_id !== live) return;
    if (event.type === 'message.start') this.dispatch({ type: 'WORK_STARTED' });
    else if (event.type === 'message.delta') this.dispatch({ type: 'WORK_DELTA', text: eventText(event, ['text', 'delta', 'content']) });
    else if (event.type === 'message.complete') this.dispatch({ type: 'WORK_RESULT', text: eventText(event, ['text', 'content']) });
  }

  dispose(): void {
    if (this.disposed) return;
    this.dispatch({ type: 'RESET' });
    this.disposed = true;
  }

  private dispatch(event: LiveVoiceEvent): void {
    const result = transition(this.state, event);
    const changed = result.state !== this.state;
    this.state = result.state;
    for (const effect of result.effects) this.run(effect);
    if (changed && !this.disposed) this.deps.onState(this.state);
  }

  private run(effect: LiveVoiceEffect): void {
    switch (effect.type) {
      case 'connect': return this.connect(effect.scope);
      case 'submit': return this.submit(effect.delegationId, effect.sessionId, effect.text, effect.context);
      case 'steer': return this.steer(effect.sessionId, effect.text);
      case 'interrupt': return this.interrupt(effect.sessionId);
      case 'say': this.session?.say(effect.delegationId, effect.text); return;
      case 'think': this.session?.think(effect.delegationId, effect.text); return;
      case 'playback-mute': this.session?.setPlaybackMuted(true); return;
      case 'playback-unmute': this.session?.setPlaybackMuted(false); return;
      case 'mic-mute': this.session?.setMicMuted(true); return;
      case 'mic-unmute': this.session?.setMicMuted(false); return;
      case 'schedule-teardown':
        this.cancelTeardown();
        this.teardownTimer = this.setTimer(() => { this.teardownTimer = null; this.dispatch({ type: 'TEARDOWN' }); }, this.deps.teardownGraceMs ?? TEARDOWN_GRACE_MS);
        return;
      case 'cancel-teardown': this.cancelTeardown(); return;
      case 'release-all': return this.releaseAll();
    }
  }

  private connect(scope: LiveScope): void {
    const epoch = ++this.epoch;
    const live = () => epoch === this.epoch && !this.disposed;
    const session = this.deps.createSession({
      onStarted: () => undefined,
      onTranscript: (fragment) => { if (live()) this.onTranscript(fragment); },
      onDelegation: (id, context) => {
        if (!live()) return;
        const { prompt, context: voiceContext } = delegationPrompt(context);
        this.dispatch({ type: 'DELEGATION', id, utterance: prompt, context: voiceContext, now: this.now() });
      },
      onSpeakingChange: (speaking) => { if (live()) this.dispatch({ type: 'SPEAKING', speaking }); },
      onError: (message) => { if (live()) this.dispatch({ type: 'PROVIDER_ERROR', message: redactForLog(message) }); },
      onClosed: (reason) => { if (live()) this.dispatch({ type: 'SESSION_CLOSED', reason }); },
    });
    this.session = session;
    void (async () => {
      try {
        await session.start((sdp) => this.deps.exchange(scope, sdp));
      } catch (error) {
        if (!live()) return;
        this.dispatch({ type: 'CONNECT_FAILED', ...classifyStartError(error) });
        return;
      }
      if (live()) this.dispatch({ type: 'CONNECTED', liveSessionId: session.liveSessionId });
    })();
  }

  private onTranscript(fragment: LiveTranscriptFragment): void {
    if (fragment.speaker !== 'user') return;
    if (!this.utterance) this.dispatch({ type: 'USER_SPEECH_STARTED' });
    this.utterance += fragment.text;
    if (this.utteranceTimer !== null) this.clearTimer(this.utteranceTimer);
    this.utteranceTimer = this.setTimer(() => {
      this.utteranceTimer = null;
      const text = this.utterance;
      this.utterance = '';
      this.dispatch({ type: 'USER_UTTERANCE', text });
    }, this.deps.utteranceSettleMs ?? UTTERANCE_SETTLE_MS);
  }

  private submit(delegationId: string, sessionId: string, text: string, context: string): void {
    const epoch = this.epoch;
    const live = () => epoch === this.epoch && !this.disposed && this.state.delegation?.id === delegationId;
    void (async () => {
      try {
        await this.deps.submit(sessionId, text, context);
      } catch (error) {
        if (live()) this.dispatch({ type: 'WORK_FAILED', message: redactForLog(error instanceof Error && error.message ? error.message : 'Not sent.') });
        return;
      }
      if (live()) this.dispatch({ type: 'WORK_STARTED' });
    })();
  }

  private steer(sessionId: string, text: string): void {
    const epoch = this.epoch;
    void (async () => {
      let accepted = false;
      try {
        accepted = (await this.deps.steer(sessionId, text)).status === 'accepted';
      } catch {
        accepted = false;
      }
      if (epoch === this.epoch && !this.disposed) this.dispatch({ type: 'STEER_RESULT', accepted });
    })();
  }

  private interrupt(sessionId: string): void {
    const epoch = this.epoch;
    const interrupt = this.deps.interrupt;
    if (!interrupt) { this.dispatch({ type: 'INTERRUPT_RESULT', interrupted: false }); return; }
    void (async () => {
      let interrupted = false;
      try {
        interrupted = (await interrupt(sessionId)).status === 'interrupted';
      } catch {
        interrupted = false;
      }
      if (epoch === this.epoch && !this.disposed) this.dispatch({ type: 'INTERRUPT_RESULT', interrupted });
    })();
  }

  private cancelTeardown(): void {
    if (this.teardownTimer !== null) { this.clearTimer(this.teardownTimer); this.teardownTimer = null; }
  }

  private releaseAll(): void {
    this.epoch += 1;
    this.cancelTeardown();
    if (this.utteranceTimer !== null) { this.clearTimer(this.utteranceTimer); this.utteranceTimer = null; }
    this.utterance = '';
    const session = this.session;
    this.session = null;
    session?.release();
  }
}
