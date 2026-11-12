import { useCallback, useEffect, useRef, useState } from 'react';
import type { JsonRpcEvent } from '../lib/jsonRpc';
import type { VoiceBackend, VoiceCapability } from '../lib/voiceBackend';
import { VoiceController } from '../lib/voiceController';
import { initialVoiceState, VoiceScope, VoiceState } from '../lib/voiceMachine';

export interface UseVoiceControllerOptions {
  backend: VoiceBackend | null;
  // Same path as the text composer.
  submitText(text: string): Promise<void>;
  onSubmitFailed?(text: string, message: string): void;
}

export interface VoiceApi {
  state: VoiceState;
  capability: VoiceCapability;
  start(scope: VoiceScope): void;
  stop(): void;
  interrupt(): void;
  reset(): void;
  scopeChanged(scope: VoiceScope | null): void;
  gatewayEvent(event: JsonRpcEvent): void;
  gatewayLost(): void;
  unlockAudio(): void;
}

const NO_BACKEND: VoiceCapability = { supported: false, code: 'unsupported', message: 'Voice is not available until you are connected.' };

// React binding only: one VoiceController per backend, disposed when the backend changes (sign-out,
// forget-device, new host) or the component unmounts, and released whenever the page is hidden.
export function useVoiceController(options: UseVoiceControllerOptions): VoiceApi {
  const { backend } = options;
  const [state, setState] = useState<VoiceState>(initialVoiceState);
  const controllerRef = useRef<VoiceController | null>(null);
  const submitRef = useRef(options.submitText);
  const failedRef = useRef(options.onSubmitFailed);
  submitRef.current = options.submitText;
  failedRef.current = options.onSubmitFailed;

  useEffect(() => {
    if (!backend) {
      controllerRef.current = null;
      setState(initialVoiceState());
      return undefined;
    }
    const controller = new VoiceController({
      backend,
      submitText: (text) => submitRef.current(text),
      onSubmitFailed: (text, message) => failedRef.current?.(text, message),
      onState: setState,
    });
    controllerRef.current = controller;
    setState(controller.getState());
    const release = () => controller.pageHidden();
    const onVisibility = () => { if (document.visibilityState === 'hidden') release(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', release);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', release);
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [backend]);

  const start = useCallback((scope: VoiceScope) => controllerRef.current?.start(scope), []);
  const stop = useCallback(() => controllerRef.current?.stop(), []);
  const interrupt = useCallback(() => controllerRef.current?.interrupt(), []);
  const reset = useCallback(() => controllerRef.current?.reset(), []);
  const scopeChanged = useCallback((scope: VoiceScope | null) => controllerRef.current?.scopeChanged(scope), []);
  const gatewayEvent = useCallback((event: JsonRpcEvent) => controllerRef.current?.gatewayEvent(event), []);
  const gatewayLost = useCallback(() => controllerRef.current?.gatewayLost(), []);
  const unlockAudio = useCallback(() => backend?.unlockAudio(), [backend]);

  return { state, capability: backend ? backend.capability() : NO_BACKEND, start, stop, interrupt, reset, scopeChanged, gatewayEvent, gatewayLost, unlockAudio };
}
