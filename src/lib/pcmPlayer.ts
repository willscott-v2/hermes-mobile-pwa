// Gapless PCM playback on a shared AudioContext. TTS audio arrives as variable-size chunks; each is
// scheduled to start exactly where the previous one ends. stop() is synchronous and total: every
// source is stopped and disconnected, nothing queued survives, and later enqueue() calls are ignored.

export interface PcmPlayerHandlers {
  onStarted(): void;  // first chunk scheduled in this session
  onDrained(): void;  // end() was called and every source has finished playing
}

const START_LEAD_SECONDS = 0.05;

export class PcmPlayer {
  private nextStart = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private started = false;
  private ended = false;
  private drained = false;
  private stopped = false;

  constructor(private readonly context: AudioContext, private readonly handlers: PcmPlayerHandlers) {}

  get queuedSources(): number {
    return this.sources.size;
  }

  enqueue(samples: Float32Array, sampleRate: number): void {
    if (this.stopped || this.ended || samples.length === 0) return;
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const startAt = Math.max(this.nextStart, this.context.currentTime + START_LEAD_SECONDS);
    this.nextStart = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      this.maybeDrain();
    };
    source.start(startAt);
    if (!this.started) {
      this.started = true;
      this.handlers.onStarted();
    }
  }

  // No more audio will arrive. onDrained fires once the queue has played out.
  end(): void {
    if (this.stopped) return;
    this.ended = true;
    this.maybeDrain();
  }

  stop(): void {
    this.stopped = true;
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      try { source.disconnect(); } catch { /* already disconnected */ }
    }
    this.sources.clear();
  }

  private maybeDrain(): void {
    if (this.stopped || this.drained || !this.ended || this.sources.size > 0) return;
    this.drained = true;
    this.handlers.onDrained();
  }
}
