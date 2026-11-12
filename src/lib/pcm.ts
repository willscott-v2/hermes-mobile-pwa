// Pure PCM helpers shared by microphone capture and TTS playback. No DOM access.

// The server accepts an initial {sample_rate: N} with N in 8000..48000 (hermes_cli/web_routers/audio.py).
export const MIN_CAPTURE_RATE = 8000;
export const MAX_CAPTURE_RATE = 48000;

export function captureFormat(contextRate: number): { sampleRate: number; decimation: number } {
  if (!Number.isFinite(contextRate) || contextRate < MIN_CAPTURE_RATE) {
    throw new Error(`Unsupported microphone sample rate: ${contextRate}`);
  }
  const decimation = Math.ceil(contextRate / MAX_CAPTURE_RATE);
  const sampleRate = Math.round(contextRate / decimation);
  if (sampleRate < MIN_CAPTURE_RATE) throw new Error(`Unsupported microphone sample rate: ${contextRate}`);
  return { sampleRate, decimation };
}

export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let index = 0; index < length; index += 1) mono[index] += channel[index] / channels.length;
  }
  return mono;
}

// Average each group of `factor` samples (a cheap low-pass + decimate for rates above 48 kHz).
export function decimate(input: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return input;
  const output = new Float32Array(Math.floor(input.length / factor));
  for (let index = 0; index < output.length; index += 1) {
    let sum = 0;
    for (let offset = 0; offset < factor; offset += 1) sum += input[index * factor + offset];
    output[index] = sum / factor;
  }
  return output;
}

// Mono float [-1, 1] -> signed little-endian 16-bit bytes. Endianness is explicit, not host-dependent.
export function floatToPcm16Bytes(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const raw = samples[index];
    const clamped = Number.isNaN(raw) ? 0 : Math.max(-1, Math.min(1, raw));
    view.setInt16(index * 2, Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), true);
  }
  return bytes;
}

export const WAV_HEADER_BYTES = 44;
// POST /api/audio/transcribe rejects decoded audio above this (413), WAV header included.
export const MAX_TRANSCRIBE_UPLOAD_BYTES = 25 * 1024 * 1024;

// Mono s16le PCM chunks -> one canonical 44-byte-header RIFF/WAVE file at the capture rate.
export function encodeWavMono16(chunks: readonly Uint8Array[], sampleRate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError(`Invalid WAV sample rate: ${sampleRate}`);
  const dataBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  if (dataBytes % 2 !== 0) throw new RangeError('WAV data must be whole 16-bit samples.');
  const wav = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(wav.buffer);
  const tag = (offset: number, text: string) => { for (let index = 0; index < text.length; index += 1) wav[offset + index] = text.charCodeAt(index); };
  tag(0, 'RIFF');
  view.setUint32(4, wav.byteLength - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);              // PCM
  view.setUint16(22, 1, true);              // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);              // block align
  view.setUint16(34, 16, true);             // bits per sample
  tag(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = WAV_HEADER_BYTES;
  for (const chunk of chunks) { wav.set(chunk, offset); offset += chunk.byteLength; }
  return wav;
}

// Incremental s16le -> float decoder. WebSocket frames can end mid-sample, so one trailing byte is
// carried into the next frame.
export class Pcm16Decoder {
  private carry: number | null = null;

  push(frame: ArrayBuffer | Uint8Array): Float32Array {
    const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
    let source = bytes;
    if (this.carry !== null) {
      source = new Uint8Array(bytes.length + 1);
      source[0] = this.carry;
      source.set(bytes, 1);
      this.carry = null;
    }
    const usable = source.length - (source.length % 2);
    if (usable < source.length) this.carry = source[source.length - 1];
    const out = new Float32Array(usable / 2);
    const view = new DataView(source.buffer, source.byteOffset, usable);
    for (let index = 0; index < out.length; index += 1) out[index] = view.getInt16(index * 2, true) / 0x8000;
    return out;
  }

  reset(): void {
    this.carry = null;
  }
}
