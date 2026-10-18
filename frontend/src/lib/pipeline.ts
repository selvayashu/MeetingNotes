import { api, ApiError, clearHealthCache, getHealth, isRetryableLater, serverReachable } from './api';
import { decodeToMono16k } from './audio';
import { transcribeInBrowser } from './browserStt';
import { db, deleteAudio, transcriptText, type Meeting, type Segment } from './db';
import { whisperLanguageFor, type OutputLanguage, type SummaryStyle } from './languages';
import { setProgress } from './progress';
import { getSettings } from './settings';

/**
 * Processing pipeline for saved meetings:
 *   queued -> transcribing -> (speaker labels) -> (delete audio) -> needs_notes -> summarizing -> ready
 * Anything that fails because the server is unreachable stays queued and is retried when back online.
 */

export interface NotesOptions {
  outputLanguage?: OutputLanguage;
  style?: SummaryStyle;
  model?: string;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function patch(id: string, changes: Partial<Meeting>) {
  await db.meetings.update(id, { ...changes, updatedAt: Date.now() });
}

function topLanguage(segments: Segment[]): string | undefined {
  const time: Record<string, number> = {};
  for (const s of segments) if (s.lang) time[s.lang] = (time[s.lang] ?? 0) + (s.end - s.start);
  return Object.keys(time).sort((a, b) => time[b] - time[a])[0];
}

/** Ask the service worker to wake us when connectivity returns (Background Sync, where supported). */
export function requestBackgroundSync(): void {
  navigator.serviceWorker?.ready
    .then((reg) => (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register('meetnotes-queue'))
    .catch(() => undefined);
}

async function transcribeStep(meeting: Meeting): Promise<boolean> {
  const id = meeting.id;
  const settings = getSettings();
  const audio = await db.audio.get(id);
  if (!audio) {
    await patch(id, { status: 'failed', failedStep: 'transcribe', error: 'The audio for this meeting is not available.' });
    return false;
  }
  await patch(id, { status: 'transcribing', error: undefined });
  const onProgress = (p: number) => setProgress(id, p);
  setProgress(id, 0);
  try {
    let segments: Segment[];
    let language: string | undefined;
    let engine: string;
    const useServer = settings.sttMode !== 'browser' && (await serverReachable());
    if (useServer) {
      const result = await api.transcribeFile(audio.blob, meeting.languageMode, onProgress);
      segments = result.segments;
      language = result.language ?? undefined;
      engine = result.engine;
    } else if (settings.sttMode !== 'server') {
      const pcm = await decodeToMono16k(audio.blob);
      segments = await transcribeInBrowser(pcm, settings.browserModel, whisperLanguageFor(meeting.languageMode), 0, onProgress);
      language = whisperLanguageFor(meeting.languageMode) ?? undefined;
      engine = `browser:${settings.browserModel}`;
    } else {
      await patch(id, { status: 'queued' });
      requestBackgroundSync();
      return false;
    }
    await patch(id, {
      segments,
      transcriptOverride: undefined,
      detectedLanguage: language ?? topLanguage(segments) ?? meeting.detectedLanguage,
      transcribedBy: engine,
      status: 'transcribed',
      failedStep: undefined,
      error: undefined,
    });
    await afterTranscription(id);
    return true;
  } catch (e) {
    if (isRetryableLater(e)) {
      await patch(id, { status: 'queued', error: errorMessage(e) });
      requestBackgroundSync();
    } else {
      await patch(id, { status: 'failed', failedStep: 'transcribe', error: errorMessage(e) });
    }
    return false;
  } finally {
    setProgress(id, undefined);
  }
}

/** Optional speaker labels, optional audio deletion, then mark the meeting ready for notes. */
export async function afterTranscription(id: string): Promise<void> {
  const settings = getSettings();
  let meeting = await db.meetings.get(id);
  if (!meeting) return;
  let warning: string | undefined;

  if (settings.speakerLabels && meeting.hasAudio && meeting.segments.length) {
    try {
      const health = await getHealth();
      if (health.diarization) {
        await identifySpeakers(id);
      } else {
        warning = 'Speaker labels are disabled on the server (ENABLE_DIARIZATION=false).';
      }
    } catch (e) {
      warning = `Speaker labels skipped: ${errorMessage(e)}`;
    }
    meeting = (await db.meetings.get(id)) ?? meeting;
  }

  if (settings.deleteAudioAfterTranscription && meeting.hasAudio) await deleteAudio(id);

  const hasText = transcriptText(meeting).trim().length > 0;
  await patch(id, {
    status: settings.autoNotes && hasText ? 'needs_notes' : 'transcribed',
    warning,
  });
}

export async function identifySpeakers(id: string): Promise<void> {
  const meeting = await db.meetings.get(id);
  const audio = await db.audio.get(id);
  if (!meeting || !audio) throw new Error('The audio for this meeting is not available.');
  setProgress(id, 0);
  try {
    const result = await api.diarize(audio.blob, meeting.segments, (p) => setProgress(id, p));
    await patch(id, { segments: result.segments, warning: undefined });
  } finally {
    setProgress(id, undefined);
  }
}

const pendingNotesOptions = new Map<string, NotesOptions>();

async function notesStep(meeting: Meeting): Promise<boolean> {
  const id = meeting.id;
  const settings = getSettings();
  const options = pendingNotesOptions.get(id) ?? {};
  const transcript = transcriptText(meeting, false).trim();
  if (!transcript) {
    await patch(id, { status: 'transcribed' });
    return true;
  }
  if (!(await serverReachable())) {
    await patch(id, { status: 'needs_notes' });
    requestBackgroundSync();
    return false;
  }
  const outputLanguage = options.outputLanguage ?? settings.outputLanguage;
  await patch(id, { status: 'summarizing', error: undefined });
  setProgress(id, 0);
  try {
    const result = await api.notes(
      {
        transcript,
        meeting_language: meeting.detectedLanguage ?? whisperLanguageFor(meeting.languageMode) ?? undefined,
        output_language: outputLanguage,
        style: options.style ?? settings.summaryStyle,
        model: options.model ?? (settings.llmModel || undefined),
        title: meeting.title,
        meeting_date: new Date(meeting.createdAt).toISOString().slice(0, 10),
        manual_notes: meeting.manualNotes || undefined,
      },
      (p) => setProgress(id, p),
    );
    await patch(id, {
      notes: {
        ...result.notes,
        action_items: result.notes.action_items.map((a) => ({ ...a, done: false })),
        model: result.model,
        outputLanguage,
        generatedAt: Date.now(),
      },
      status: 'ready',
      failedStep: undefined,
      error: undefined,
    });
    pendingNotesOptions.delete(id);
    return true;
  } catch (e) {
    if (isRetryableLater(e)) {
      await patch(id, { status: 'needs_notes', error: errorMessage(e) });
      requestBackgroundSync();
    } else {
      await patch(id, { status: 'failed', failedStep: 'notes', error: errorMessage(e) });
    }
    return false;
  } finally {
    setProgress(id, undefined);
  }
}

export async function processMeeting(id: string): Promise<boolean> {
  let meeting = await db.meetings.get(id);
  if (!meeting) return false;
  if (meeting.status === 'queued') {
    if (!(await transcribeStep(meeting))) return false;
    meeting = await db.meetings.get(id);
    if (!meeting) return false;
  }
  if (meeting.status === 'needs_notes') return notesStep(meeting);
  return true;
}

let running = false;
let again = false;

async function drainQueue(): Promise<void> {
  do {
    again = false;
    const items = await db.meetings.where('status').anyOf('queued', 'needs_notes').sortBy('createdAt');
    for (const m of items) {
      try {
        await processMeeting(m.id);
      } catch (e) {
        if (e instanceof ApiError && e.kind === 'auth') return; // wrong token: stop until settings change
        console.error('processing failed', e);
      }
    }
  } while (again);
}

/** Process queued meetings. Safe to call often; one tab at a time does the work. */
export async function processQueue(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    if (navigator.locks) await navigator.locks.request('meetnotes-queue', { ifAvailable: true }, async (lock) => lock && drainQueue());
    else await drainQueue();
  } finally {
    running = false;
  }
}

/** Manual retry from the UI. Surfaces errors to the caller. */
export async function retryMeeting(id: string): Promise<void> {
  const meeting = await db.meetings.get(id);
  if (!meeting) return;
  clearHealthCache();
  const status = meeting.status === 'failed' ? (meeting.failedStep === 'notes' ? 'needs_notes' : 'queued') : meeting.status;
  await patch(id, { status, error: undefined });
  await processMeeting(id);
}

export async function generateNotes(id: string, options: NotesOptions): Promise<void> {
  pendingNotesOptions.set(id, options);
  await patch(id, { status: 'needs_notes', failedStep: undefined, error: undefined });
  await processMeeting(id);
}

export async function retranscribe(id: string): Promise<void> {
  await patch(id, { status: 'queued', failedStep: undefined, error: undefined });
  await processMeeting(id);
}

/** Recover meetings left mid-way by a crash, a closed tab or a killed app. */
async function recoverInterrupted(): Promise<void> {
  const stale = Date.now() - 2 * 60_000;
  const recordings = await db.meetings.where('status').equals('recording').toArray();
  for (const m of recordings) {
    if (m.updatedAt > stale) continue; // probably still recording in another tab
    const parts = await db.audioParts.where('meetingId').equals(m.id).sortBy('seq');
    if (parts.length) {
      const blob = new Blob(parts.map((p) => p.blob), { type: parts[0].mimeType });
      await db.transaction('rw', db.meetings, db.audio, db.audioParts, async () => {
        await db.audio.put({ meetingId: m.id, blob, mimeType: parts[0].mimeType });
        await db.audioParts.where('meetingId').equals(m.id).delete();
        await patch(m.id, {
          status: 'queued',
          hasAudio: true,
          audioMime: parts[0].mimeType,
          durationMs: parts[parts.length - 1].elapsedMs,
          warning: 'Recording was interrupted; audio up to that point was recovered.',
        });
      });
    } else {
      await patch(m.id, { status: 'failed', failedStep: 'transcribe', error: 'Recording was interrupted before any audio was saved.' });
    }
  }
  await db.meetings.where('status').equals('transcribing').modify({ status: 'queued' });
  await db.meetings.where('status').equals('summarizing').modify({ status: 'needs_notes' });
}

export function startQueueProcessing(): () => void {
  void recoverInterrupted().then(processQueue);
  const onOnline = () => {
    clearHealthCache();
    void processQueue();
  };
  const onMessage = (e: MessageEvent) => {
    if (e.data?.type === 'PROCESS_QUEUE') void processQueue();
  };
  window.addEventListener('online', onOnline);
  navigator.serviceWorker?.addEventListener('message', onMessage);
  const timer = window.setInterval(() => void processQueue(), 60_000);
  return () => {
    window.removeEventListener('online', onOnline);
    navigator.serviceWorker?.removeEventListener('message', onMessage);
    window.clearInterval(timer);
  };
}
