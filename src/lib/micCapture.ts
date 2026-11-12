// Microphone capture: getUserMedia -> Web Audio -> mono s16le PCM frames. Compressed MediaRecorder
// chunks are deliberately not used; the transcriber needs raw PCM it can stream incrementally.

import { captureFormat, decimate, floatToPcm16Bytes } from './pcm';
import { VoiceBackendError } from './voiceBackend';

export interface AudioTap { disconnect(): void }

// Everything the capture/playback path needs from the browser, injectable so it is testable
// without a real microphone or AudioContext.
export interface AudioEnv {
  readonly isSecureContext: boolean;
  readonly hasMicrophone: boolean;
  getUserMedia(): Promise<MediaStream>;
  createContext(): AudioContext;
  // Delivers mono float samples from the source. The browser implementation uses an AudioWorklet
  // and falls back to ScriptProcessorNode where worklets are unavailable.
  createTap(context: AudioContext, source: MediaStreamAudioSourceNode, onSamples: (mono: Float32Array) => void): Promise<AudioTap>;
}

export interface MicCapture {
  readonly sampleRate: number;
  stop(): void; // idempotent: disconnects every node and stops every track
}

function abortError(): Error {
  return Object.assign(new Error('Microphone capture was cancelled.'), { name: 'AbortError' });
}

function mapMediaError(error: unknown): VoiceBackendError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new VoiceBackendError('permission-denied', 'Microphone permission was denied. Allow it in your browser settings to use voice.');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return new VoiceBackendError('no-microphone', 'No microphone was found on this device.');
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new VoiceBackendError('no-microphone', 'The microphone is busy or unavailable. Close other apps using it and try again.');
  }
  return new VoiceBackendError('internal', error instanceof Error && error.message ? error.message : 'Could not start the microphone.');
}

export async function openMicCapture(env: AudioEnv, context: AudioContext, onFrame: (frame: Uint8Array) => void, signal?: AbortSignal): Promise<MicCapture> {
  if (signal?.aborted) throw abortError();
  const format = captureFormat(context.sampleRate);

  let stream: MediaStream;
  try {
    stream = await env.getUserMedia();
  } catch (error) {
    throw mapMediaError(error);
  }
  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());
  if (signal?.aborted) {
    stopTracks();
    throw abortError();
  }

  let closed = false;
  let source: MediaStreamAudioSourceNode | null = null;
  let tap: AudioTap | null = null;
  const release = () => {
    closed = true;
    try { tap?.disconnect(); } catch { /* already disconnected */ }
    try { source?.disconnect(); } catch { /* already disconnected */ }
    stopTracks();
  };

  try {
    source = context.createMediaStreamSource(stream);
    tap = await env.createTap(context, source, (mono) => {
      if (closed) return;
      onFrame(floatToPcm16Bytes(decimate(mono, format.decimation)));
    });
  } catch (error) {
    release();
    throw error instanceof VoiceBackendError ? error : new VoiceBackendError('unsupported', 'This browser cannot capture microphone audio for voice.');
  }
  if (signal?.aborted) {
    release();
    throw abortError();
  }
  return { sampleRate: format.sampleRate, stop: release };
}
