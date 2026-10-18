// In-browser Whisper (transformers.js): WebGPU when available, else WASM. Used offline or with no server.
import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
}
const scope = self as unknown as WorkerScope;

type Asr = (audio: Float32Array, options: Record<string, unknown>) => Promise<{
  text: string;
  chunks?: { text: string; timestamp: [number | null, number | null] }[];
}>;

const SAMPLE_RATE = 16000;
const WINDOW = SAMPLE_RATE * 28;

let asr: Promise<Asr> | null = null;
let asrModel = '';

function load(model: string): Promise<Asr> {
  if (asr && asrModel === model) return asr;
  asrModel = model;
  const progress_callback = (data: unknown) => scope.postMessage({ type: 'load-progress', data });
  asr = (async () => {
    if ('gpu' in navigator) {
      try {
        return (await pipeline('automatic-speech-recognition', model, {
          device: 'webgpu',
          dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
          progress_callback,
        })) as unknown as Asr;
      } catch (e) {
        console.warn('WebGPU unavailable, using WASM', e);
      }
    }
    return (await pipeline('automatic-speech-recognition', model, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback,
    })) as unknown as Asr;
  })();
  asr.catch(() => {
    asr = null;
  });
  return asr;
}

scope.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { id: number; type: 'load' | 'transcribe'; model: string; audio?: Float32Array; language?: string | null };
  try {
    const transcriber = await load(msg.model);
    if (msg.type === 'load') {
      scope.postMessage({ id: msg.id, type: 'result', result: true });
      return;
    }
    const audio = msg.audio ?? new Float32Array();
    const chunks: { text: string; start: number; end: number }[] = [];
    for (let start = 0; start < audio.length; start += WINDOW) {
      const piece = audio.subarray(start, Math.min(audio.length, start + WINDOW));
      if (piece.length >= SAMPLE_RATE / 5) {
        const options: Record<string, unknown> = { task: 'transcribe', return_timestamps: true };
        if (msg.language) options.language = msg.language;
        const out = await transcriber(piece, options);
        const offset = start / SAMPLE_RATE;
        const pieceEnd = offset + piece.length / SAMPLE_RATE;
        const parts = out.chunks?.length ? out.chunks : [{ text: out.text, timestamp: [0, null] as [number, null] }];
        for (const c of parts) {
          const text = c.text.trim();
          if (!text) continue;
          const s = offset + (c.timestamp[0] ?? 0);
          chunks.push({ text, start: s, end: c.timestamp[1] != null ? offset + c.timestamp[1] : pieceEnd });
        }
      }
      scope.postMessage({ id: msg.id, type: 'progress', progress: Math.min(1, (start + WINDOW) / audio.length) });
    }
    scope.postMessage({ id: msg.id, type: 'result', result: chunks });
  } catch (err) {
    scope.postMessage({ id: msg.id, type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
