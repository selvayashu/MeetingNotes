import type { Segment } from './db';

type Pending = { resolve: (value: unknown) => void; reject: (e: Error) => void; onProgress?: (p: number) => void };

export interface ModelLoadEvent {
  status: string;
  file?: string;
  progress?: number;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
const loadListeners = new Set<(e: ModelLoadEvent) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data;
    if (msg.type === 'load-progress') {
      loadListeners.forEach((l) => l(msg.data as ModelLoadEvent));
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') {
      p.onProgress?.(msg.progress);
      return;
    }
    pending.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  };
  worker.onerror = (e) => {
    pending.forEach((p) => p.reject(new Error(e.message || 'Browser transcription failed')));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function call<T>(message: Record<string, unknown>, transfer: Transferable[] = [], onProgress?: (p: number) => void): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    getWorker().postMessage({ ...message, id }, transfer);
  });
}

export function onModelLoad(listener: (e: ModelLoadEvent) => void): () => void {
  loadListeners.add(listener);
  return () => loadListeners.delete(listener);
}

/** Downloads (first time) and initialises the model; it is then cached by the browser for offline use. */
export function loadBrowserModel(model: string): Promise<boolean> {
  return call<boolean>({ type: 'load', model });
}

/** Transcribe 16 kHz mono PCM. The buffer is transferred to the worker and must not be reused. */
export async function transcribeInBrowser(
  pcm: Float32Array,
  model: string,
  language: string | null,
  offset = 0,
  onProgress?: (p: number) => void,
): Promise<Segment[]> {
  const chunks = await call<{ text: string; start: number; end: number }[]>(
    { type: 'transcribe', model, audio: pcm, language },
    [pcm.buffer],
    onProgress,
  );
  return chunks.map((c) => ({
    start: +(c.start + offset).toFixed(2),
    end: +(c.end + offset).toFixed(2),
    text: c.text,
    ...(language ? { lang: language } : {}),
  }));
}
