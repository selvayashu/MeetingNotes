export const TARGET_RATE = 16000;

/** Streaming resampler to 16 kHz (box-filter decimation; nearest-neighbour when upsampling). */
export class Resampler {
  private ratio: number;
  private acc = 0;
  private accCount = 0;
  private consumed = 0;
  private next: number;

  constructor(inRate: number, outRate = TARGET_RATE) {
    this.ratio = inRate / outRate;
    this.next = this.ratio;
  }

  process(input: Float32Array): Float32Array {
    const out: number[] = [];
    if (this.ratio >= 1) {
      for (let i = 0; i < input.length; i++) {
        this.acc += input[i];
        this.accCount++;
        this.consumed++;
        if (this.consumed >= this.next) {
          out.push(this.acc / this.accCount);
          this.acc = 0;
          this.accCount = 0;
          this.next += this.ratio;
        }
      }
    } else {
      for (let i = 0; i < input.length; i++) {
        this.consumed++;
        while (this.next <= this.consumed) {
          out.push(input[i]);
          this.next += this.ratio;
        }
      }
    }
    return Float32Array.from(out);
  }
}

export function encodeWav(pcm: Float32Array, sampleRate = TARGET_RATE): Blob {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  let offset = 44;
  for (let i = 0; i < pcm.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function rms(pcm: Float32Array, from = 0, to = pcm.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** Decode a recorded file to 16 kHz mono for the in-browser model. */
export async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const data = await blob.arrayBuffer();
  let audio: AudioBuffer;
  try {
    audio = await new OfflineAudioContext(1, 1, TARGET_RATE).decodeAudioData(data.slice(0));
  } catch {
    // Some browsers refuse a 16 kHz context: decode at the native rate and resample.
    const ctx = new AudioContext();
    try {
      audio = await ctx.decodeAudioData(data);
    } finally {
      void ctx.close();
    }
  }
  const length = audio.length;
  const mono = new Float32Array(length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += ch[i] / audio.numberOfChannels;
  }
  return audio.sampleRate === TARGET_RATE ? mono : new Resampler(audio.sampleRate).process(mono);
}
