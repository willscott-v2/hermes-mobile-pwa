// Real-browser AudioEnv: getUserMedia + Web Audio. Prefers an AudioWorklet tap (off the main
// thread, Safari 14.1+) and falls back to ScriptProcessorNode where worklets are unavailable or
// fail to load. Mobile Safari needs the context created/resumed inside a user gesture; the backend
// does that from the tap/click that starts voice.

import type { AudioEnv, AudioTap } from './micCapture';

const WORKLET_NAME = 'hermes-pcm-tap';
const WORKLET_BLOCK_SAMPLES = 1024; // ~21 ms at 48 kHz: bounds the tail lost when capture stops

const WORKLET_SOURCE = `
class HermesPcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(${WORKLET_BLOCK_SAMPLES});
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    for (let i = 0; i < input[0].length; i += 1) {
      let sum = 0;
      for (let c = 0; c < input.length; c += 1) sum += input[c][i];
      this.buffer[this.filled++] = sum / input.length;
      if (this.filled === this.buffer.length) {
        const block = this.buffer;
        this.port.postMessage(block, [block.buffer]);
        this.buffer = new Float32Array(${WORKLET_BLOCK_SAMPLES});
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', HermesPcmTap);
`;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | undefined {
  const scope = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

const loadedWorklets = new WeakMap<AudioContext, Promise<void>>();

function loadWorklet(context: AudioContext): Promise<void> {
  let loaded = loadedWorklets.get(context);
  if (!loaded) {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
    loaded = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    loadedWorklets.set(context, loaded);
  }
  return loaded;
}

// Pulling a node requires it to reach the destination; a zero-gain stage keeps the microphone out
// of the speakers.
function silentSink(context: AudioContext): GainNode {
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(context.destination);
  return gain;
}

async function workletTap(context: AudioContext, source: MediaStreamAudioSourceNode, onSamples: (mono: Float32Array) => void): Promise<AudioTap> {
  await loadWorklet(context);
  const node = new AudioWorkletNode(context, WORKLET_NAME, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
  node.port.onmessage = (event: MessageEvent<Float32Array>) => onSamples(event.data);
  const sink = silentSink(context);
  source.connect(node);
  node.connect(sink);
  return {
    disconnect: () => {
      node.port.onmessage = null;
      node.port.close();
      node.disconnect();
      sink.disconnect();
    },
  };
}

function scriptProcessorTap(context: AudioContext, source: MediaStreamAudioSourceNode, onSamples: (mono: Float32Array) => void): AudioTap {
  const processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => onSamples(new Float32Array(event.inputBuffer.getChannelData(0)));
  const sink = silentSink(context);
  source.connect(processor);
  processor.connect(sink);
  return {
    disconnect: () => {
      processor.onaudioprocess = null;
      processor.disconnect();
      sink.disconnect();
    },
  };
}

export function browserAudioEnv(): AudioEnv {
  return {
    get isSecureContext() { return window.isSecureContext === true; },
    get hasMicrophone() { return typeof navigator.mediaDevices?.getUserMedia === 'function' && Boolean(audioContextCtor()); },
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
    createContext: () => {
      const Ctor = audioContextCtor();
      if (!Ctor) throw new Error('Web Audio is not available in this browser.');
      return new Ctor({ latencyHint: 'interactive' });
    },
    createTap: async (context, source, onSamples) => {
      if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        try {
          return await workletTap(context, source, onSamples);
        } catch {
          // Fall through to the legacy path.
        }
      }
      return scriptProcessorTap(context, source, onSamples);
    },
  };
}
