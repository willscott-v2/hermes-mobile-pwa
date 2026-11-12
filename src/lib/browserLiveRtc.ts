// Real-browser LiveRtcEnv: RTCPeerConnection, getUserMedia, an <audio> element for the remote track
// and a Web Audio analyser for the speaking probe. Everything the session needs from the browser
// comes through this one object so the session itself stays testable with fakeLiveRtc.ts.
//
// Mobile Safari only lets audio start inside a user gesture: call `unlock()` from the tap that
// starts live voice (the same moment the chained backend resumes its AudioContext).

import type { LiveRtcEnv, MediaStreamLike, PeerLike, PlaybackLike, SpeakingProbeLike, TrackLike } from './liveVoiceSession';

// 44-byte silent WAV header + 0 samples: enough for play() to unlock the element in a gesture.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

function audioContextCtor(): (new () => AudioContext) | undefined {
  const scope = window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

class BrowserPlayback implements PlaybackLike {
  constructor(private readonly audio: HTMLAudioElement) {}
  get muted() { return this.audio.muted; }
  set muted(value: boolean) { this.audio.muted = value; }
  attach(track: TrackLike): void {
    this.audio.srcObject = new MediaStream([track as unknown as MediaStreamTrack]);
    void this.audio.play().catch(() => undefined);
  }
  detach(): void {
    this.audio.pause();
    this.audio.srcObject = null;
    this.audio.muted = false;
  }
}

export class BrowserLiveRtcEnv implements LiveRtcEnv {
  private audio: HTMLAudioElement | null = null;

  // Inside the user gesture: create the element and start a silent clip so later srcObject playback
  // is allowed without another tap.
  unlock(): void {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.autoplay = true;
      this.audio.setAttribute('playsinline', 'true');
    }
    if (!this.audio.srcObject) {
      this.audio.src = SILENT_WAV;
      void this.audio.play().catch(() => undefined);
    }
  }

  createPeer(): PeerLike {
    return new RTCPeerConnection() as unknown as PeerLike;
  }

  async getMicrophone(): Promise<MediaStreamLike> {
    if (!window.isSecureContext) throw new DOMException('Voice needs HTTPS (or localhost).', 'NotSupportedError');
    if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Microphone capture is unavailable here.', 'NotSupportedError');
    if (typeof RTCPeerConnection === 'undefined') throw new DOMException('WebRTC is unavailable in this browser.', 'NotSupportedError');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    return stream as unknown as MediaStreamLike;
  }

  createPlayback(): PlaybackLike {
    if (!this.audio) this.unlock();
    return new BrowserPlayback(this.audio as HTMLAudioElement);
  }

  // Desktop parity: peak > 6 on a 100 ms tick, four quiet frames of hysteresis.
  probeSpeaking(track: TrackLike, onChange: (speaking: boolean) => void): SpeakingProbeLike {
    const Ctor = audioContextCtor();
    if (!Ctor) return { stop: () => undefined };
    let context: AudioContext | null = null;
    let timer: number | null = null;
    try {
      context = new Ctor();
      const source = context.createMediaStreamSource(new MediaStream([track as unknown as MediaStreamTrack]));
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      let quiet = 0;
      let last = false;
      timer = window.setInterval(() => {
        analyser.getByteTimeDomainData(buffer);
        let peak = 0;
        for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128));
        const loud = peak > 6;
        quiet = loud ? 0 : quiet + 1;
        const speaking = loud || quiet < 4;
        if (speaking !== last) { last = speaking; onChange(speaking); }
      }, 100);
    } catch {
      // No analyser → no speaking indicator; the conversation still works.
    }
    return {
      stop: () => {
        if (timer !== null) window.clearInterval(timer);
        void context?.close().catch(() => undefined);
      },
    };
  }

  setTimeout(fn: () => void, ms: number): number { return window.setTimeout(fn, ms); }
  clearTimeout(id: number): void { window.clearTimeout(id); }
}
