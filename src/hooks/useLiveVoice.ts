import { useCallback, useEffect, useRef, useState } from 'react';
import type { JsonRpcEvent } from '../lib/jsonRpc';
import { LiveVoiceController, LiveVoiceControllerDeps } from '../lib/liveVoiceController';
import { initialLiveState, LiveScope, LiveVoiceState } from '../lib/liveVoiceMachine';

export interface UseLiveVoiceOptions {
  // null → live voice is not available for this client/profile; the hook is inert.
  deps: Omit<LiveVoiceControllerDeps, 'onState'> | null;
}

export interface LiveVoiceApi {
  state: LiveVoiceState;
  available: boolean;
  start(scope: LiveScope): void;
  stop(): void;
  stopSpeaking(): void;
  reset(): void;
  scopeChanged(scope: LiveScope | null): void;
  gatewayEvent(event: JsonRpcEvent): void;
  gatewayLost(): void;
}

// React binding only: one LiveVoiceController per deps object, disposed when deps change (sign-out,
// new host, profile switch) or on unmount. Unlike the chained hook, hiding the page does NOT reset
// immediately: the mic is paused and the session torn down after a short grace (iPhone lock /
// app switch), so a quick return keeps the call.
export function useLiveVoice(options: UseLiveVoiceOptions): LiveVoiceApi {
  const { deps } = options;
  const [state, setState] = useState<LiveVoiceState>(initialLiveState);
  const controllerRef = useRef<LiveVoiceController | null>(null);

  useEffect(() => {
    if (!deps) {
      controllerRef.current = null;
      setState(initialLiveState());
      return undefined;
    }
    const controller = new LiveVoiceController({ ...deps, onState: setState });
    controllerRef.current = controller;
    setState(controller.getState());
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') controller.pageHidden();
      else controller.pageVisible();
    };
    const onPageHide = () => controller.pageHidden();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [deps]);

  const start = useCallback((scope: LiveScope) => controllerRef.current?.start(scope), []);
  const stop = useCallback(() => controllerRef.current?.stop(), []);
  const stopSpeaking = useCallback(() => controllerRef.current?.stopSpeaking(), []);
  const reset = useCallback(() => controllerRef.current?.reset(), []);
  const scopeChanged = useCallback((scope: LiveScope | null) => controllerRef.current?.scopeChanged(scope), []);
  const gatewayEvent = useCallback((event: JsonRpcEvent) => controllerRef.current?.gatewayEvent(event), []);
  const gatewayLost = useCallback(() => controllerRef.current?.gatewayLost(), []);

  return { state, available: deps !== null, start, stop, stopSpeaking, reset, scopeChanged, gatewayEvent, gatewayLost };
}
