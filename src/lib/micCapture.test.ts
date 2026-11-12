import { describe, expect, it } from 'vitest';
import { AudioEnv, openMicCapture } from './micCapture';

function makeEnv(options: { contextRate?: number; getUserMedia?: () => Promise<MediaStream> } = {}) {
  const log: string[] = [];
  const tracks = [{ stopped: false, stop() { this.stopped = true; log.push('track.stop'); } }, { stopped: false, stop() { this.stopped = true; log.push('track.stop'); } }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  const sourceNode = { connect: () => undefined, disconnect: () => log.push('source.disconnect') };
  const context = {
    sampleRate: options.contextRate ?? 48000,
    createMediaStreamSource: () => sourceNode,
  } as unknown as AudioContext;
  let onSamples: (samples: Float32Array) => void = () => undefined;
  const env: AudioEnv = {
    isSecureContext: true,
    hasMicrophone: true,
    getUserMedia: options.getUserMedia ?? (async () => stream),
    createContext: () => context,
    createTap: async (_context, _source, handler) => {
      onSamples = handler;
      return { disconnect: () => log.push('tap.disconnect') };
    },
  };
  return { env, context, tracks, log, emit: (samples: Float32Array) => onSamples(samples) };
}

describe('openMicCapture', () => {
  it('reports the capture sample rate and converts samples to mono s16le frames', async () => {
    const { env, context, emit } = makeEnv({ contextRate: 44100 });
    const frames: Uint8Array[] = [];
    const capture = await openMicCapture(env, context, (frame) => frames.push(frame));
    expect(capture.sampleRate).toBe(44100);
    emit(Float32Array.from([0, 1, -1]));
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0])).toEqual([0, 0, 0xff, 0x7f, 0x00, 0x80]);
  });

  it('decimates a >48 kHz context and reports the server-acceptable rate', async () => {
    const { env, context, emit } = makeEnv({ contextRate: 96000 });
    const frames: Uint8Array[] = [];
    const capture = await openMicCapture(env, context, (frame) => frames.push(frame));
    expect(capture.sampleRate).toBe(48000);
    emit(Float32Array.from([1, 1, 0, 0]));
    expect(frames[0].byteLength).toBe(4); // 4 input samples -> 2 output samples
  });

  it('stop() disconnects the tap and source and stops every media track; frames stop flowing', async () => {
    const { env, context, tracks, log, emit } = makeEnv();
    const frames: Uint8Array[] = [];
    const capture = await openMicCapture(env, context, (frame) => frames.push(frame));
    capture.stop();
    capture.stop(); // idempotent
    expect(tracks.every((track) => track.stopped)).toBe(true);
    expect(log).toContain('tap.disconnect');
    expect(log).toContain('source.disconnect');
    emit(Float32Array.from([1]));
    expect(frames).toHaveLength(0);
  });

  it('permission denial surfaces as a permission-denied error', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const { env, context } = makeEnv({ getUserMedia: async () => { throw denied; } });
    await expect(openMicCapture(env, context, () => undefined)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('a missing device surfaces as no-microphone', async () => {
    const missing = Object.assign(new Error('none'), { name: 'NotFoundError' });
    const { env, context } = makeEnv({ getUserMedia: async () => { throw missing; } });
    await expect(openMicCapture(env, context, () => undefined)).rejects.toMatchObject({ code: 'no-microphone' });
  });

  it('cancelling while the permission prompt is open stops the stream the moment it is granted', async () => {
    let grant: (stream: MediaStream) => void = () => undefined;
    const pending = new Promise<MediaStream>((resolve) => { grant = resolve; });
    const { env, context, tracks, log } = makeEnv({ getUserMedia: () => pending });
    const controller = new AbortController();
    const opening = openMicCapture(env, context, () => undefined, controller.signal);
    controller.abort();
    grant({ getTracks: () => tracks } as unknown as MediaStream);
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    expect(tracks.every((track) => track.stopped)).toBe(true);
    expect(log).not.toContain('tap.disconnect'); // never wired
  });

  it('aborting during tap setup releases the tracks and the tap', async () => {
    const { env, context, tracks, log } = makeEnv();
    const controller = new AbortController();
    const originalTap = env.createTap;
    env.createTap = async (...args) => {
      const tap = await originalTap(...args);
      controller.abort();
      return tap;
    };
    await expect(openMicCapture(env, context, () => undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(tracks.every((track) => track.stopped)).toBe(true);
    expect(log).toContain('tap.disconnect');
  });
});
