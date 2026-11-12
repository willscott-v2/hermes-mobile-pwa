import { describe, expect, it, vi } from 'vitest';
import { PcmPlayer } from './pcmPlayer';

class FakeSource {
  buffer: { duration: number; length: number; sampleRate: number } | null = null;
  startedAt: number | null = null;
  stopped = false;
  disconnected = false;
  onended: (() => void) | null = null;
  connect() { return this; }
  disconnect() { this.disconnected = true; }
  start(when: number) { this.startedAt = when; }
  stop() { this.stopped = true; }
  finish() { this.onended?.(); }
}

class FakeContext {
  currentTime = 10;
  state = 'running';
  destination = {};
  sources: FakeSource[] = [];
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { length, sampleRate, duration: length / sampleRate, getChannelData: () => new Float32Array(length), copyToChannel: () => undefined };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

function make() {
  const context = new FakeContext();
  const events: string[] = [];
  const player = new PcmPlayer(context as unknown as AudioContext, { onStarted: () => events.push('started'), onDrained: () => events.push('drained') });
  return { context, events, player };
}

const second = (rate: number) => new Float32Array(rate); // exactly one second of audio

describe('PcmPlayer', () => {
  it('schedules chunks back to back with no gap and announces the first audible chunk once', () => {
    const { context, events, player } = make();
    player.enqueue(second(24000), 24000);
    player.enqueue(second(24000), 24000);
    expect(events).toEqual(['started']);
    const [first, next] = context.sources;
    expect(first.startedAt).toBeGreaterThanOrEqual(context.currentTime);
    expect(next.startedAt).toBeCloseTo((first.startedAt as number) + 1, 5);
  });

  it('re-anchors to now after an underrun instead of scheduling in the past', () => {
    const { context, player } = make();
    player.enqueue(second(24000), 24000);
    context.currentTime = 99;
    player.enqueue(second(24000), 24000);
    expect(context.sources[1].startedAt).toBeGreaterThanOrEqual(99);
  });

  it('drains only after end() and after the last source finished', () => {
    const { context, events, player } = make();
    player.enqueue(second(24000), 24000);
    player.end();
    expect(events).toEqual(['started']);
    context.sources[0].finish();
    expect(events).toEqual(['started', 'drained']);
  });

  it('end() with nothing queued drains immediately and exactly once', () => {
    const { events, player } = make();
    player.end();
    player.end();
    expect(events).toEqual(['drained']);
  });

  it('a finished source before end() does not drain yet', () => {
    const { context, events, player } = make();
    player.enqueue(second(24000), 24000);
    context.sources[0].finish();
    expect(events).toEqual(['started']);
    player.end();
    expect(events).toEqual(['started', 'drained']);
  });

  it('stop() silences, disconnects, and cancels every queued source without draining', () => {
    const { context, events, player } = make();
    player.enqueue(second(24000), 24000);
    player.enqueue(second(24000), 24000);
    player.stop();
    expect(context.sources.every((source) => source.stopped && source.disconnected)).toBe(true);
    context.sources.forEach((source) => source.finish());
    expect(events).toEqual(['started']);
    expect(player.queuedSources).toBe(0);
  });

  it('ignores audio enqueued after stop() (late frames from a closing socket)', () => {
    const { context, player } = make();
    player.stop();
    player.enqueue(second(24000), 24000);
    expect(context.sources).toHaveLength(0);
  });

  it('a stopped source that throws on stop() does not break teardown', () => {
    const { context, player } = make();
    player.enqueue(second(24000), 24000);
    vi.spyOn(context.sources[0], 'stop').mockImplementation(() => { throw new Error('already stopped'); });
    expect(() => player.stop()).not.toThrow();
    expect(context.sources[0].disconnected).toBe(true);
  });
});
