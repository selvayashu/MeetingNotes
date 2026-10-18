import { getSettings } from './settings';
import type { Notes, Segment } from './db';
import type { OutputLanguage, SummaryStyle, TranscriptionMode } from './languages';

export type ApiErrorKind = 'config' | 'network' | 'timeout' | 'auth' | 'notfound' | 'server';

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  constructor(message: string, kind: ApiErrorKind, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

/** Errors that mean "try again later" (offline, server down) rather than a real failure. */
export function isRetryableLater(e: unknown): boolean {
  return e instanceof ApiError && (e.kind === 'network' || e.kind === 'timeout' || e.kind === 'config');
}

export interface Health {
  status: string;
  version: string;
  stt: { default: string; routes: Record<string, string>; loaded: string[] };
  llm: { reachable: boolean; default_model: string; error?: string | null };
  diarization: boolean;
  max_upload_mb: number;
}

export interface TranscriptionResult {
  language: string | null;
  language_probability: number | null;
  engine: string;
  duration: number;
  segments: Segment[];
  text: string;
}

export interface NotesRequest {
  transcript: string;
  meeting_language?: string;
  output_language: OutputLanguage;
  style: SummaryStyle;
  model?: string;
  title?: string;
  meeting_date?: string;
  manual_notes?: string;
}

type ServerNotes = Pick<Notes, 'summary' | 'key_points' | 'decisions' | 'action_items' | 'open_questions'>;

interface Job<T> {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  result: T | null;
  error: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function baseUrl(): string {
  const url = getSettings().serverUrl.trim().replace(/\/+$/, '');
  if (!url) throw new ApiError('Server URL is not configured', 'config');
  return url;
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getSettings().accessToken.trim();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(baseUrl() + path, { ...init, headers, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (ctrl.signal.aborted) throw new ApiError('The server took too long to respond', 'timeout');
    throw new ApiError('Cannot reach the server', 'network');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* non-JSON error body */
    }
    const kind: ApiErrorKind =
      res.status === 401 || res.status === 403
        ? 'auth'
        : res.status === 404
          ? 'notfound'
          : res.status === 502 || res.status === 503 || res.status === 504
            ? 'network'
            : 'server';
    throw new ApiError(detail || `HTTP ${res.status}`, kind, res.status);
  }
  return (await res.json()) as T;
}

let healthCache: { at: number; value: Health } | null = null;

export function clearHealthCache(): void {
  healthCache = null;
}

export async function getHealth(force = false): Promise<Health> {
  if (!force && healthCache && Date.now() - healthCache.at < 30_000) return healthCache.value;
  const value = await request<Health>('/api/health', {}, 8_000);
  healthCache = { at: Date.now(), value };
  return value;
}

/** True when the server answers. Auth errors are re-thrown so the user sees them. */
export async function serverReachable(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    await getHealth();
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'auth') throw e;
    return false;
  }
}

async function runJob<T>(
  start: () => Promise<{ id: string }>,
  onProgress?: (p: number) => void,
  timeoutMs = 4 * 3600_000,
): Promise<T> {
  const { id } = await start();
  const deadline = Date.now() + timeoutMs;
  let failures = 0;
  for (;;) {
    await sleep(2000);
    if (Date.now() > deadline) throw new ApiError('The job took too long', 'timeout');
    let job: Job<T>;
    try {
      job = await request<Job<T>>(`/api/jobs/${id}`, {}, 15_000);
      failures = 0;
    } catch (e) {
      if (e instanceof ApiError && (e.kind === 'network' || e.kind === 'timeout') && ++failures < 15) continue;
      if (e instanceof ApiError && e.kind === 'notfound') {
        throw new ApiError('The server lost this job (it may have restarted)', 'network');
      }
      throw e;
    }
    onProgress?.(job.progress);
    if (job.status === 'done') return job.result as T;
    if (job.status === 'error') throw new ApiError(job.error || 'Job failed', 'server');
  }
}

function extensionFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

export const api = {
  health: getHealth,

  models: () => request<{ models: string[]; default: string }>('/api/models', {}, 10_000),

  /** Short live chunk, synchronous. */
  transcribeChunk(wav: Blob, opts: { language: TranscriptionMode; offset: number; prompt?: string }) {
    const fd = new FormData();
    fd.append('file', wav, 'chunk.wav');
    fd.append('language', opts.language);
    fd.append('offset', String(opts.offset));
    if (opts.prompt) fd.append('prompt', opts.prompt);
    return request<TranscriptionResult>('/api/transcribe', { method: 'POST', body: fd }, 90_000);
  },

  /** Full recording, as a background job with progress. */
  transcribeFile(blob: Blob, language: TranscriptionMode, onProgress?: (p: number) => void) {
    const fd = new FormData();
    fd.append('file', blob, `meeting.${extensionFor(blob.type)}`);
    fd.append('language', language);
    return runJob<TranscriptionResult>(
      () => request('/api/jobs/transcribe', { method: 'POST', body: fd }, 15 * 60_000),
      onProgress,
    );
  },

  diarize(blob: Blob, segments: Segment[], onProgress?: (p: number) => void) {
    const fd = new FormData();
    fd.append('file', blob, `meeting.${extensionFor(blob.type)}`);
    fd.append('segments', JSON.stringify(segments));
    return runJob<{ segments: Segment[]; speakers: string[] }>(
      () => request('/api/jobs/diarize', { method: 'POST', body: fd }, 15 * 60_000),
      onProgress,
    );
  },

  notes(body: NotesRequest, onProgress?: (p: number) => void) {
    return runJob<{ notes: ServerNotes; model: string }>(
      () =>
        request('/api/jobs/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      onProgress,
    );
  },
};
