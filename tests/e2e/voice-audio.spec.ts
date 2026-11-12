declare const Buffer: { from(input: ArrayBufferLike): Uint8Array };

import { expect, test } from '@playwright/test';

// Real-browser check of the Web Audio path with Chromium's synthetic microphone: no real mic,
// provider, or audio server is involved. Modules are imported through the Vite dev server.
test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
});

test('browser capture produces mono s16le frames and releases the microphone on stop', async ({ page }) => {
  await page.goto('/?e2e=voice-audio');
  const result = await page.evaluate(async () => {
    const { browserAudioEnv } = await import('/src/lib/browserAudio.ts');
    const { openMicCapture } = await import('/src/lib/micCapture.ts');
    const env = browserAudioEnv();
    const context = env.createContext();
    await context.resume();
    const frames: Uint8Array[] = [];
    const capture = await openMicCapture(env, context, (frame) => frames.push(frame));
    await new Promise((resolve) => setTimeout(resolve, 900));
    const framesWhileOpen = frames.length;
    const bytes = frames.reduce((total, frame) => total + frame.byteLength, 0);
    const odd = frames.some((frame) => frame.byteLength % 2 !== 0);
    // Non-silent: the fake device beeps, so at least one sample is non-zero.
    const nonZero = frames.some((frame) => frame.some((byte) => byte !== 0));
    capture.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const framesAfterStop = frames.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    await context.close();
    return { sampleRate: capture.sampleRate, contextRate: context.sampleRate, framesWhileOpen, bytes, odd, nonZero, framesAfterStop, framesLater: frames.length };
  });
  expect(result.sampleRate).toBeGreaterThanOrEqual(8000);
  expect(result.sampleRate).toBeLessThanOrEqual(48000);
  expect(result.framesWhileOpen).toBeGreaterThan(5);
  expect(result.bytes).toBeGreaterThan(result.sampleRate * 2 * 0.3); // at least ~0.3s of audio
  expect(result.odd).toBe(false);
  expect(result.nonZero).toBe(true);
  expect(result.framesLater).toBe(result.framesAfterStop); // nothing arrives after stop()
});

test('PCM player plays a chunk, drains once, and stop() silences deterministically', async ({ page }) => {
  await page.goto('/?e2e=voice-player');
  const result = await page.evaluate(async () => {
    const { browserAudioEnv } = await import('/src/lib/browserAudio.ts');
    const { PcmPlayer } = await import('/src/lib/pcmPlayer.ts');
    const env = browserAudioEnv();
    const context = env.createContext();
    await context.resume();
    const events: string[] = [];
    const tone = (seconds: number) => Float32Array.from({ length: Math.floor(24000 * seconds) }, (_, index) => Math.sin(index / 20) * 0.2);
    const player = new PcmPlayer(context, { onStarted: () => events.push('started'), onDrained: () => events.push('drained') });
    player.enqueue(tone(0.15), 24000);
    player.end();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const afterPlay = [...events];
    const stopped = new PcmPlayer(context, { onStarted: () => events.push('started2'), onDrained: () => events.push('drained2') });
    stopped.enqueue(tone(5), 24000);
    const queuedBeforeStop = stopped.queuedSources;
    stopped.stop();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await context.close();
    return { afterPlay, queuedBeforeStop, queuedAfterStop: stopped.queuedSources, events };
  });
  expect(result.afterPlay).toEqual(['started', 'drained']);
  expect(result.queuedBeforeStop).toBe(1);
  expect(result.queuedAfterStop).toBe(0);
  expect(result.events).toEqual(['started', 'drained', 'started2']);
});

test('capture falls back to ScriptProcessor when AudioWorklet is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(AudioContext.prototype, 'audioWorklet', { get: () => undefined });
  });
  await page.goto('/?e2e=voice-audio-fallback');
  const result = await page.evaluate(async () => {
    const { browserAudioEnv } = await import('/src/lib/browserAudio.ts');
    const { openMicCapture } = await import('/src/lib/micCapture.ts');
    const env = browserAudioEnv();
    const context = env.createContext();
    await context.resume();
    const frames: Uint8Array[] = [];
    const capture = await openMicCapture(env, context, (frame) => frames.push(frame));
    await new Promise((resolve) => setTimeout(resolve, 900));
    capture.stop();
    const count = frames.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    await context.close();
    return { hasWorklet: Boolean(context.audioWorklet), count, later: frames.length, odd: frames.some((frame) => frame.byteLength % 2 !== 0) };
  });
  expect(result.hasWorklet).toBe(false);
  expect(result.count).toBeGreaterThan(2);
  expect(result.odd).toBe(false);
  expect(result.later).toBe(result.count);
});

// The real ChainedVoiceBackend (real getUserMedia on the synthetic mic, real Web Audio playback)
// against a routed WebSocket that mirrors hermes_cli/web_routers/audio.py. No provider, no server.
test('ChainedVoiceBackend speaks the transcribe-stream and speak-stream protocols end to end', async ({ page }) => {
  const server = {
    urls: [] as string[],
    sampleRate: 0,
    binaryFrames: 0,
    oddFrames: 0,
    events: [] as string[],
    spoken: [] as string[],
  };
  await page.routeWebSocket(/\/api\/audio\/transcribe-stream/, (ws) => {
    server.urls.push(ws.url());
    ws.onMessage((message) => {
      if (typeof message === 'string') {
        const frame = JSON.parse(message);
        if (frame.sample_rate) { server.sampleRate = frame.sample_rate; server.events.push('rate'); }
        if (frame.eos) {
          server.events.push('eos');
          ws.send(JSON.stringify({ type: 'final', transcript: 'hello from the fake transcriber', provider: 'fake' }));
          ws.close();
        }
        return;
      }
      server.binaryFrames += 1;
      if (message.length % 2 !== 0) server.oddFrames += 1;
      if (server.binaryFrames === 1) ws.send(JSON.stringify({ type: 'partial', text: 'hello' }));
    });
  });
  await page.routeWebSocket(/\/api\/audio\/speak-stream/, (ws) => {
    server.urls.push(ws.url());
    ws.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.text) server.spoken.push(frame.text);
      if (frame.done) {
        const samples = new Int16Array(4800).map((_, index) => Math.round(Math.sin(index / 12) * 8000));
        ws.send(JSON.stringify({ type: 'start', sample_rate: 24000, channels: 1 }));
        ws.send(Buffer.from(samples.buffer));
        ws.send(JSON.stringify({ type: 'end' }));
      }
    });
  });

  await page.goto('/?e2e=voice-chained');
  const origin = new URL(page.url()).origin.replace('http', 'ws');
  const result = await page.evaluate(async (wsOrigin) => {
    const { ChainedVoiceBackend } = await import('/src/lib/chainedVoiceBackend.ts');
    const { browserAudioEnv } = await import('/src/lib/browserAudio.ts');
    const backend = new ChainedVoiceBackend({
      audio: browserAudioEnv(),
      socketUrl: async (kind, profile) => `${wsOrigin}/api/audio/${kind}?profile=${profile}&ticket=test-ticket`,
    });
    const events: string[] = [];
    const waitFor = async (label: string) => {
      for (let attempt = 0; attempt < 100 && !events.includes(label); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
      if (!events.includes(label)) throw new Error(`timed out waiting for ${label}; saw ${events.join(',')}`);
    };
    const scope = { profile: 'default', sessionId: 'sess-1' };
    backend.unlockAudio();
    const dictation = backend.startDictation(scope, {
      onListening: () => events.push('listening'),
      onPartial: (text) => events.push(`partial:${text}`),
      onFinal: (text) => events.push(`final:${text}`),
      onError: (error) => events.push(`error:${error.message}`),
      onClosed: () => events.push('closed'),
    });
    await waitFor('listening');
    await new Promise((resolve) => setTimeout(resolve, 700)); // let real microphone frames flow
    dictation.finish();
    await waitFor('final:hello from the fake transcriber');
    const speech = backend.openSpeech(scope, {
      onStarted: () => events.push('tts-started'),
      onEnded: () => events.push('tts-ended'),
      onFallback: () => events.push('tts-fallback'),
      onError: (error) => events.push(`tts-error:${error.message}`),
      onClosed: () => events.push('tts-closed'),
    });
    speech.speak('Hello ');
    speech.speak('there. ');
    speech.finish();
    await waitFor('tts-ended');
    speech.close();
    backend.dispose();
    return events;
  }, origin);

  expect(result).toContain('listening');
  expect(result).toContain('partial:hello');
  expect(result).toContain('final:hello from the fake transcriber');
  expect(result).not.toContain('closed');
  expect(result.filter((event) => event.startsWith('error'))).toEqual([]);
  expect(result).toEqual(expect.arrayContaining(['tts-started', 'tts-ended']));
  expect(result.some((event) => event.startsWith('tts-error') || event === 'tts-fallback' || event === 'tts-closed')).toBe(false);

  // Server view: profile + credential on every socket, rate first, PCM frames, eos once, text in order.
  expect(server.urls).toHaveLength(2);
  for (const url of server.urls) {
    expect(new URL(url).searchParams.get('profile')).toBe('default');
    expect(new URL(url).searchParams.get('ticket')).toBe('test-ticket');
  }
  expect(server.sampleRate).toBeGreaterThanOrEqual(8000);
  expect(server.sampleRate).toBeLessThanOrEqual(48000);
  expect(server.events).toEqual(['rate', 'eos']);
  expect(server.binaryFrames).toBeGreaterThan(5);
  expect(server.oddFrames).toBe(0);
  expect(server.spoken).toEqual(['Hello ', 'there. ']);
});

// A server whose STT provider has no live wire (local whisper) answers transcribe-stream with the
// documented error frame. The real VoiceController + ChainedVoiceBackend + HermesApiClient must keep
// the microphone open until Stop, upload one WAV to POST /api/audio/transcribe, and submit the text
// through the ordinary prompt path -- never showing "Voice problem".
test('no-live-STT server falls back to a batch WAV upload that follows the ordinary submit path', async ({ page }) => {
  const server = {
    streamSockets: 0,
    streamClosedByServer: false,
    posts: [] as Array<{ url: string; authorization: string | undefined; contentType: string | undefined; body: Buffer | null }>,
  };
  await page.routeWebSocket(/\/api\/audio\/transcribe-stream/, (ws) => {
    server.streamSockets += 1;
    ws.send(JSON.stringify({ type: 'error', message: 'no live STT for the configured provider' }));
    ws.close();
    server.streamClosedByServer = true;
  });
  await page.routeWebSocket(/\/api\/audio\/speak-stream/, (ws) => {
    ws.onMessage(() => { ws.send(JSON.stringify({ type: 'fallback' })); ws.close(); });
  });
  await page.route('**/api/audio/transcribe?*', async (route) => {
    const request = route.request();
    server.posts.push({ url: request.url(), authorization: request.headers().authorization, contentType: request.headers()['content-type'], body: request.postDataBuffer() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, transcript: 'what is on my plate today', provider: 'local' }) });
  });

  await page.goto('/?e2e=voice-batch-fallback');
  const result = await page.evaluate(async (origin) => {
    const { ChainedVoiceBackend } = await import('/src/lib/chainedVoiceBackend.ts');
    const { browserAudioEnv } = await import('/src/lib/browserAudio.ts');
    const { HermesApiClient } = await import('/src/lib/hermesApi.ts');
    const { VoiceController } = await import('/src/lib/voiceController.ts');
    const { voiceView } = await import('/src/lib/voiceView.ts');

    const streams: MediaStream[] = [];
    const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => { const stream = await realGetUserMedia(constraints); streams.push(stream); return stream; };
    const micLive = () => streams.some((stream) => stream.getTracks().some((track) => track.readyState === 'live'));

    const client = new HermesApiClient(origin);
    const auth = { mode: 'token' as const, token: 'e2e-token' };
    const wsOrigin = origin.replace('http', 'ws');
    const backend = new ChainedVoiceBackend({
      audio: browserAudioEnv(),
      socketUrl: async (kind, profile) => `${wsOrigin}/api/audio/${kind}?profile=${profile}&token=e2e-token`,
      transcribeBatch: (profile, wav, signal) => client.transcribeAudio(auth, profile, wav, signal),
    });
    const submitted: string[] = [];
    const statuses: string[] = [];
    let micLiveWhileListening: boolean[] = [];
    const controller: InstanceType<typeof VoiceController> = new VoiceController({
      backend,
      submitText: async (text) => { submitted.push(text); },
      onState: (state) => {
        const view = voiceView(state, { capability: backend.capability(), canStart: true, blockedReason: '' });
        statuses.push(`${state.phase}|${view.status}`);
      },
    });
    const waitFor = async (predicate: () => boolean, label: string) => {
      for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
      if (!predicate()) throw new Error(`timed out waiting for ${label}; saw ${statuses.join(',')}`);
    };

    controller.start({ profile: 'default', sessionId: 'sess-1' });
    await waitFor(() => controller.getState().phase === 'listening', 'listening');
    await new Promise((resolve) => setTimeout(resolve, 900)); // stream already refused; mic must keep going
    const phaseBeforeStop = controller.getState().phase;
    micLiveWhileListening = [micLive()];
    controller.stop();
    await waitFor(() => submitted.length > 0, 'submit');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const micLiveAfter = micLive();
    backend.dispose();
    return { phaseBeforeStop, micLiveWhileListening, micLiveAfter, submitted, statuses };
  }, new URL(page.url()).origin);

  expect(result.phaseBeforeStop).toBe('listening');
  expect(result.micLiveWhileListening).toEqual([true]);
  expect(result.micLiveAfter).toBe(false);
  expect(result.submitted).toEqual(['what is on my plate today']);
  expect(result.statuses.some((status) => /Voice problem|error/.test(status))).toBe(false);
  expect(result.statuses.some((status) => status.startsWith('listening|Listening'))).toBe(true);

  expect(server.streamSockets).toBe(1);
  expect(server.posts).toHaveLength(1);
  const post = server.posts[0];
  expect(new URL(post.url).searchParams.get('profile')).toBe('default');
  expect(post.url).not.toContain('e2e-token');
  expect(post.authorization).toBe('Bearer e2e-token');
  expect(post.contentType).toContain('application/json');
  const body = JSON.parse(post.body!.toString('utf8')) as { data_url: string; mime_type: string };
  expect(body.mime_type).toBe('audio/wav');
  expect(body.data_url.startsWith('data:audio/wav;base64,')).toBe(true);
  expect(post.body!.toString('utf8')).not.toContain('e2e-token');
  const wav = Buffer.from(body.data_url.split(',', 2)[1], 'base64');
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  expect(wav.subarray(0, 4).toString()).toBe('RIFF');
  expect(wav.subarray(8, 12).toString()).toBe('WAVE');
  expect(view.getUint16(22, true)).toBe(1);   // mono
  expect(view.getUint16(34, true)).toBe(16);  // 16-bit
  const rate = view.getUint32(24, true);
  expect(rate).toBeGreaterThanOrEqual(8000);
  expect(rate).toBeLessThanOrEqual(48000);
  expect(view.getUint32(40, true)).toBe(wav.byteLength - 44);
  expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
  expect(wav.byteLength - 44).toBeGreaterThan(rate * 2 * 0.5); // ~1s of audio, captured after the stream was refused
  expect(wav.subarray(44).some((byte) => byte !== 0)).toBe(true); // the fake device beeps
});
