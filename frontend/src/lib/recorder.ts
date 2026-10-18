import { Resampler, TARGET_RATE, rms } from './audio';

export interface RecorderChunk {
  index: number;
  pcm: Float32Array; // 16 kHz mono
  start: number; // seconds of recorded (un-paused) audio
  end: number;
}

interface RecorderOptions {
  minSec: number;
  maxSec: number;
  onChunk: (chunk: RecorderChunk) => void;
  onPart?: (blob: Blob, seq: number, elapsedMs: number) => void;
}

export type MicErrorKind = 'denied' | 'notfound' | 'busy' | 'insecure' | 'unsupported' | 'unknown';

export function classifyMicError(e: unknown): MicErrorKind {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'notfound';
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return 'busy';
  return 'unknown';
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
  return candidates.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
}

/**
 * Records the full meeting with MediaRecorder and, in parallel, captures 16 kHz PCM through an
 * AudioWorklet. PCM is cut into 5-10 s chunks at a quiet moment so words are not split.
 */
export class MeetingRecorder {
  analyser?: AnalyserNode;
  mimeType = '';

  private ctx?: AudioContext;
  private stream?: MediaStream;
  private media?: MediaRecorder;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private resampler?: Resampler;
  private parts: Blob[] = [];
  private partSeq = 0;
  private buf = new Float32Array(TARGET_RATE * 16);
  private len = 0;
  private emitted = 0;
  private chunkIndex = 0;
  private paused = false;
  private startedAt = 0;
  private accumulatedMs = 0;

  constructor(private opts: RecorderOptions) {}

  static requestStream(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  }

  /** `ctx` should be created synchronously inside the user's click so iOS lets it run. */
  async start(stream: MediaStream, ctx: AudioContext): Promise<void> {
    this.stream = stream;
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}worklets/pcm-capture.js`);
    this.resampler = new Resampler(ctx.sampleRate);
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.node = new AudioWorkletNode(ctx, 'pcm-capture');
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onPcm(e.data);
    this.source.connect(this.analyser);
    this.source.connect(this.node);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(ctx.destination); // keeps the worklet pulling audio in all browsers
    if (ctx.state === 'suspended') await ctx.resume();

    const mimeType = pickMimeType();
    this.media = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48_000 } : undefined);
    this.mimeType = this.media.mimeType || mimeType || 'audio/webm';
    this.media.ondataavailable = (e) => {
      if (!e.data.size) return;
      this.parts.push(e.data);
      this.opts.onPart?.(e.data, this.partSeq++, this.elapsedMs);
    };
    this.media.start(5000);
    this.startedAt = performance.now();
  }

  get elapsedMs(): number {
    if (!this.startedAt) return 0;
    return this.accumulatedMs + (this.paused ? 0 : performance.now() - this.startedAt);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    if (this.paused || !this.media) return;
    this.media.pause();
    this.accumulatedMs += performance.now() - this.startedAt;
    this.paused = true;
    if (this.len >= TARGET_RATE) this.emit(this.len); // show what was said before the pause
  }

  resume(): void {
    if (!this.paused || !this.media) return;
    this.media.resume();
    this.startedAt = performance.now();
    this.paused = false;
  }

  async stop(): Promise<{ blob: Blob; mimeType: string; durationMs: number }> {
    const durationMs = this.elapsedMs;
    if (this.len >= TARGET_RATE * 0.3) this.emit(this.len);
    const media = this.media;
    const blob = await new Promise<Blob>((resolve) => {
      const finish = () => resolve(new Blob(this.parts, { type: this.mimeType }));
      if (!media || media.state === 'inactive') return finish();
      media.onstop = finish;
      media.stop();
    });
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => undefined);
    return { blob, mimeType: this.mimeType, durationMs };
  }

  private onPcm(frame: Float32Array): void {
    if (this.paused || !this.resampler) return;
    const samples = this.resampler.process(frame);
    if (this.len + samples.length > this.buf.length) {
      const bigger = new Float32Array((this.len + samples.length) * 2);
      bigger.set(this.buf.subarray(0, this.len));
      this.buf = bigger;
    }
    this.buf.set(samples, this.len);
    this.len += samples.length;
    this.maybeFlush();
  }

  private maybeFlush(): void {
    const min = this.opts.minSec * TARGET_RATE;
    const max = this.opts.maxSec * TARGET_RATE;
    if (this.len < min) return;
    if (this.len >= max) {
      // Cut at the quietest 100 ms in the last 3 s.
      const frame = TARGET_RATE / 10;
      let best = this.len;
      let bestEnergy = Infinity;
      for (let pos = Math.max(min, this.len - 3 * TARGET_RATE); pos + frame <= this.len; pos += frame / 2) {
        const energy = rms(this.buf, pos, pos + frame);
        if (energy < bestEnergy) {
          bestEnergy = energy;
          best = pos + frame / 2;
        }
      }
      this.emit(best);
      return;
    }
    // Between min and max: cut as soon as the speaker pauses.
    const window = Math.floor(TARGET_RATE * 0.3);
    const tail = rms(this.buf, this.len - window, this.len);
    const overall = rms(this.buf, 0, this.len);
    if (tail < Math.max(0.004, overall * 0.25)) this.emit(this.len);
  }

  private emit(cut: number): void {
    const pcm = this.buf.slice(0, cut);
    this.buf.copyWithin(0, cut, this.len);
    this.len -= cut;
    const start = this.emitted / TARGET_RATE;
    this.emitted += cut;
    this.opts.onChunk({ index: this.chunkIndex++, pcm, start, end: this.emitted / TARGET_RATE });
  }
}
