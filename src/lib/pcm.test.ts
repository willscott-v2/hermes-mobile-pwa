import { describe, expect, it } from 'vitest';
import { captureFormat, downmixToMono, encodeWavMono16, floatToPcm16Bytes, MAX_TRANSCRIBE_UPLOAD_BYTES, Pcm16Decoder, WAV_HEADER_BYTES } from './pcm';

function int16s(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.byteLength / 2 }, (_, index) => view.getInt16(index * 2, true));
}

describe('floatToPcm16Bytes', () => {
  it('encodes mono signed little-endian 16-bit with full-scale clamping', () => {
    const bytes = floatToPcm16Bytes(Float32Array.from([0, 1, -1, 0.5, -0.5, 2, -3]));
    expect(bytes.byteLength).toBe(14);
    expect(int16s(bytes)).toEqual([0, 32767, -32768, 16384, -16384, 32767, -32768]);
  });

  it('writes explicit little-endian bytes regardless of host endianness', () => {
    const bytes = floatToPcm16Bytes(Float32Array.from([1]));
    expect(Array.from(bytes)).toEqual([0xff, 0x7f]);
  });

  it('maps NaN to silence', () => {
    expect(int16s(floatToPcm16Bytes(Float32Array.from([NaN])))).toEqual([0]);
  });
});

describe('downmixToMono', () => {
  it('passes one channel through and averages several', () => {
    const left = Float32Array.from([1, 0.5]);
    const right = Float32Array.from([0, 0.5]);
    expect(Array.from(downmixToMono([left]))).toEqual([1, 0.5]);
    expect(Array.from(downmixToMono([left, right]))).toEqual([0.5, 0.5]);
  });
});

describe('captureFormat', () => {
  it('sends the context rate as-is while it is inside the server window (8000-48000)', () => {
    expect(captureFormat(48000)).toEqual({ sampleRate: 48000, decimation: 1 });
    expect(captureFormat(44100)).toEqual({ sampleRate: 44100, decimation: 1 });
  });

  it('decimates a context rate above the server maximum by an integer factor', () => {
    expect(captureFormat(96000)).toEqual({ sampleRate: 48000, decimation: 2 });
    expect(captureFormat(192000)).toEqual({ sampleRate: 48000, decimation: 4 });
  });

  it('rejects a rate the server cannot accept', () => {
    expect(() => captureFormat(4000)).toThrow(/sample rate/i);
  });
});

describe('Pcm16Decoder', () => {
  it('decodes s16le to float and carries an odd trailing byte into the next frame', () => {
    const decoder = new Pcm16Decoder();
    // samples 16384 (0x4000) and -32768 (0x8000); split the second sample across two frames.
    const first = decoder.push(Uint8Array.from([0x00, 0x40, 0x00]));
    const second = decoder.push(Uint8Array.from([0x80]));
    expect(Array.from(first)).toEqual([0.5]);
    expect(Array.from(second)).toEqual([-1]);
  });

  it('returns an empty chunk for an empty frame', () => {
    expect(new Pcm16Decoder().push(new Uint8Array(0)).length).toBe(0);
  });
});

describe('encodeWavMono16', () => {
  const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));

  it('writes a canonical 44-byte RIFF/WAVE PCM header for mono 16-bit at the capture rate', () => {
    const wav = encodeWavMono16([Uint8Array.from([1, 2, 3, 4]), Uint8Array.from([5, 6])], 44100);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(WAV_HEADER_BYTES).toBe(44);
    expect(wav.byteLength).toBe(44 + 6);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);        // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1);         // PCM
    expect(view.getUint16(22, true)).toBe(1);         // mono
    expect(view.getUint32(24, true)).toBe(44100);     // sample rate
    expect(view.getUint32(28, true)).toBe(44100 * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2);         // block align
    expect(view.getUint16(34, true)).toBe(16);        // bits per sample
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(6);
  });

  it('copies the PCM chunks in order after the header', () => {
    const wav = encodeWavMono16([Uint8Array.from([0xff, 0x7f]), new Uint8Array(0), Uint8Array.from([0x00, 0x80])], 16000);
    expect(Array.from(wav.subarray(44))).toEqual([0xff, 0x7f, 0x00, 0x80]);
  });

  it('round-trips with floatToPcm16Bytes', () => {
    const wav = encodeWavMono16([floatToPcm16Bytes(Float32Array.from([0, 1, -1]))], 8000);
    expect(int16s(wav.subarray(44))).toEqual([0, 32767, -32768]);
  });

  it('encodes an empty recording as a header-only file', () => {
    const wav = encodeWavMono16([], 48000);
    expect(wav.byteLength).toBe(44);
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(0);
  });

  it('rejects an invalid sample rate or a half sample', () => {
    expect(() => encodeWavMono16([], 0)).toThrow(/sample rate/i);
    expect(() => encodeWavMono16([], 44100.5)).toThrow(/sample rate/i);
    expect(() => encodeWavMono16([], NaN)).toThrow(/sample rate/i);
    expect(() => encodeWavMono16([Uint8Array.from([1, 2, 3])], 16000)).toThrow(/whole 16-bit samples/i);
  });

  it('exposes the server raw-upload limit (25 MiB)', () => {
    expect(MAX_TRANSCRIBE_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });
});
