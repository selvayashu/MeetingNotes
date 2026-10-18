import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bookmark as BookmarkIcon, Mic, Pause, Play, Square, ArrowLeft, Cpu, Server, Loader2 } from 'lucide-react';
import ConsentDialog from '../components/ConsentDialog';
import MicHelp from '../components/MicHelp';
import Waveform from '../components/Waveform';
import { api, isRetryableLater, serverReachable } from '../lib/api';
import { encodeWav } from '../lib/audio';
import { loadBrowserModel, onModelLoad, transcribeInBrowser } from '../lib/browserStt';
import { db, formatClock, newId, type Bookmark, type Segment } from '../lib/db';
import { TRANSCRIPTION_MODES, whisperLanguageFor, type TranscriptionMode } from '../lib/languages';
import { afterTranscription, processQueue, requestBackgroundSync } from '../lib/pipeline';
import { classifyMicError, MeetingRecorder, type MicErrorKind, type RecorderChunk } from '../lib/recorder';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { toast } from '../lib/toast';

type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'finishing';
type Engine = 'server' | 'browser';

function defaultTitle(): string {
  return `Meeting ${new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function tailText(segments: Segment[], chars: number): string {
  return segments.slice(-4).map((s) => s.text).join(' ').slice(-chars);
}

export default function Recording() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettings();

  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<TranscriptionMode>(settings.transcriptionLanguage);
  const [showConsent, setShowConsent] = useState(false);
  const [micError, setMicError] = useState<MicErrorKind | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [engine, setEngine] = useState<Engine>('server');
  const [modelLoading, setModelLoading] = useState<number | null>(null);
  const [title, setTitle] = useState(defaultTitle);
  const [notes, setNotes] = useState('');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const recorderRef = useRef<MeetingRecorder | null>(null);
  const meetingIdRef = useRef<string | null>(null);
  const modeRef = useRef(mode);
  const engineRef = useRef<Engine>('server');
  const segmentsRef = useRef<Segment[]>([]);
  const queueRef = useRef<RecorderChunk[]>([]);
  const busyRef = useRef(false);
  const failedRef = useRef(0);
  const skipRef = useRef(false);
  const finalizedRef = useRef(false);
  const drainWaitersRef = useRef<(() => void)[]>([]);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ title, notes, bookmarks });
  latest.current = { title, notes, bookmarks };

  modeRef.current = mode;
  const active = phase === 'recording' || phase === 'paused';

  // Proactively explain a blocked microphone.
  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((status) => {
        if (status.state === 'denied') setMicError('denied');
        status.onchange = () => status.state !== 'denied' && setMicError(null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => onModelLoad((e) => {
    if (e.status === 'progress' && typeof e.progress === 'number') setModelLoading(e.progress);
    if (e.status === 'ready') setModelLoading(null);
  }), []);

  // Timer.
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setElapsed(recorderRef.current?.elapsedMs ?? 0), 250);
    return () => window.clearInterval(id);
  }, [active]);

  // Persist title / notes / bookmarks while recording.
  useEffect(() => {
    const id = meetingIdRef.current;
    if (!id || finalizedRef.current) return;
    const timer = window.setTimeout(() => {
      void db.meetings.update(id, { title, manualNotes: notes, bookmarks, updatedAt: Date.now() });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [title, notes, bookmarks]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [segments.length]);

  // Warn before closing the tab mid-recording.
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);

  // Keep the screen awake while recording (mobile browsers may suspend audio otherwise).
  const acquireWakeLock = async () => {
    try {
      wakeLockRef.current = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      /* not supported or denied */
    }
  };
  useEffect(() => {
    const onVisible = () => {
      // The browser releases the lock when the page is hidden; take it again on return.
      if (document.visibilityState === 'visible' && recorderRef.current) void acquireWakeLock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const markFailed = () => {
    failedRef.current += 1;
    setFailed(failedRef.current);
  };

  const handleChunk = async (chunk: RecorderChunk) => {
    const chunkMode = modeRef.current;
    const prompt = tailText(segmentsRef.current, 200);
    let result: Segment[] | null = null;

    if (engineRef.current === 'server') {
      try {
        const res = await api.transcribeChunk(encodeWav(chunk.pcm), { language: chunkMode, offset: chunk.start, prompt });
        result = res.segments;
      } catch (e) {
        if (isRetryableLater(e) && getSettings().sttMode === 'auto') {
          engineRef.current = 'browser';
          setEngine('browser');
          toast(t('record.switchedToBrowser'));
        } else {
          markFailed();
          return;
        }
      }
    }
    if (!result) {
      try {
        result = await transcribeInBrowser(chunk.pcm, getSettings().browserModel, whisperLanguageFor(chunkMode), chunk.start);
      } catch (e) {
        console.error(e);
        markFailed();
        return;
      }
    }
    if (finalizedRef.current || !result.length) return;
    segmentsRef.current = [...segmentsRef.current, ...result];
    setSegments(segmentsRef.current);
    const id = meetingIdRef.current;
    if (id) void db.meetings.update(id, { segments: segmentsRef.current, updatedAt: Date.now() });
  };

  const notifyDrained = () => {
    const waiters = drainWaitersRef.current;
    drainWaitersRef.current = [];
    waiters.forEach((w) => w());
  };

  const pump = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      while (queueRef.current.length && !skipRef.current) {
        const chunk = queueRef.current.shift()!;
        setPending(queueRef.current.length + 1);
        await handleChunk(chunk);
      }
    } finally {
      busyRef.current = false;
      setPending(queueRef.current.length);
      notifyDrained();
    }
  };

  const waitForDrain = () =>
    new Promise<void>((resolve) => {
      const check = () => {
        if ((!busyRef.current && queueRef.current.length === 0) || skipRef.current) resolve();
        else drainWaitersRef.current.push(check);
      };
      check();
    });

  const begin = async () => {
    setMicError(null);
    if (!window.isSecureContext) return setMicError('insecure');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof AudioWorkletNode === 'undefined') {
      return setMicError('unsupported');
    }
    // Created synchronously inside the click so iOS Safari allows audio processing.
    const ctx = new AudioContext();
    void ctx.resume();
    setPhase('starting');

    let stream: MediaStream;
    try {
      stream = await MeetingRecorder.requestStream();
    } catch (e) {
      void ctx.close();
      setMicError(classifyMicError(e));
      setPhase('idle');
      return;
    }

    const s = getSettings();
    let eng: Engine = s.sttMode === 'browser' ? 'browser' : 'server';
    if (s.sttMode === 'auto' && !(await serverReachable().catch(() => false))) eng = 'browser';
    engineRef.current = eng;
    setEngine(eng);
    if (eng === 'browser') void loadBrowserModel(s.browserModel).catch(() => undefined);

    const id = newId();
    meetingIdRef.current = id;
    const now = Date.now();
    await db.meetings.add({
      id,
      title: latest.current.title,
      createdAt: now,
      updatedAt: now,
      durationMs: 0,
      languageMode: modeRef.current,
      tags: [],
      segments: [],
      manualNotes: latest.current.notes,
      bookmarks: [],
      status: 'recording',
      hasAudio: false,
    });
    void navigator.storage?.persist?.();

    const recorder = new MeetingRecorder({
      minSec: s.chunkMinSec,
      maxSec: Math.max(s.chunkMaxSec, s.chunkMinSec + 1),
      onChunk: (chunk) => {
        queueRef.current.push(chunk);
        setPending(queueRef.current.length + (busyRef.current ? 1 : 0));
        void pump();
      },
      onPart: (blob, seq, elapsedMs) => {
        void db.audioParts.add({ meetingId: id, seq, blob, mimeType: recorder.mimeType, elapsedMs });
        void db.meetings.update(id, { durationMs: elapsedMs, updatedAt: Date.now() });
      },
    });
    try {
      await recorder.start(stream, ctx);
    } catch (e) {
      console.error(e);
      stream.getTracks().forEach((track) => track.stop());
      void ctx.close();
      await db.meetings.delete(id);
      meetingIdRef.current = null;
      setMicError('unsupported');
      setPhase('idle');
      return;
    }
    recorderRef.current = recorder;
    setAnalyser(recorder.analyser ?? null);
    setPhase('recording');
    void acquireWakeLock();
  };

  const start = () => {
    if (getSettings().consentRemembered) void begin();
    else setShowConsent(true);
  };

  const finalize = useCallback(async (goToMeeting: boolean) => {
    const recorder = recorderRef.current;
    const id = meetingIdRef.current;
    if (!recorder || !id) return;
    recorderRef.current = null;
    setPhase('finishing');
    const { blob, mimeType, durationMs } = await recorder.stop();
    setAnalyser(null);
    void wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;

    if (goToMeeting) await waitForDrain();
    else skipRef.current = true;
    finalizedRef.current = true;

    const needsFull = failedRef.current > 0 || queueRef.current.length > 0 || busyRef.current;
    const segs = segmentsRef.current;
    const langTime: Record<string, number> = {};
    segs.forEach((seg) => seg.lang && (langTime[seg.lang] = (langTime[seg.lang] ?? 0) + seg.end - seg.start));
    const detected = Object.keys(langTime).sort((a, b) => langTime[b] - langTime[a])[0] ?? whisperLanguageFor(modeRef.current) ?? undefined;
    const { title: finalTitle, notes: finalNotes, bookmarks: finalBookmarks } = latest.current;

    await db.transaction('rw', db.meetings, db.audio, db.audioParts, async () => {
      await db.audio.put({ meetingId: id, blob, mimeType });
      await db.audioParts.where('meetingId').equals(id).delete();
      await db.meetings.update(id, {
        title: finalTitle.trim() || defaultTitle(),
        durationMs,
        segments: segs,
        manualNotes: finalNotes,
        bookmarks: finalBookmarks,
        detectedLanguage: detected,
        hasAudio: true,
        audioMime: mimeType,
        transcribedBy: needsFull ? undefined : engineRef.current === 'server' ? 'server (live)' : `browser:${getSettings().browserModel}`,
        status: needsFull ? 'queued' : 'transcribed',
        updatedAt: Date.now(),
      });
    });

    if (needsFull) {
      requestBackgroundSync();
      void processQueue();
    } else {
      void afterTranscription(id).then(processQueue);
    }
    if (goToMeeting) navigate(`/meeting/${id}`, { replace: true });
    // Only refs and stable functions are used, so this callback never needs to change.
  }, [navigate]);

  // Leaving the page while recording (e.g. browser back): save what we have.
  useEffect(() => () => void finalize(false), [finalize]);

  const pause = () => {
    recorderRef.current?.pause();
    setPhase('paused');
  };
  const resume = () => {
    recorderRef.current?.resume();
    setPhase('recording');
  };
  const addBookmark = () => {
    const time = (recorderRef.current?.elapsedMs ?? 0) / 1000;
    setBookmarks((b) => [...b, { id: newId(), time, label: '' }]);
  };
  const skipWaiting = () => {
    skipRef.current = true;
    notifyDrained();
  };

  return (
    <div className="page recording">
      <div className="record-top">
        {!active && phase !== 'finishing' && (
          <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <ArrowLeft size={20} />
          </button>
        )}
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label={t('meeting.title')}
        />
      </div>

      <div className="card recorder">
        <div className="record-status">
          {phase === 'recording' && <span className="rec-dot" aria-hidden />}
          <span className="timer" aria-live="off">{formatClock(elapsed / 1000)}</span>
          <span className="muted small">
            {phase === 'paused' ? t('record.paused') : phase === 'recording' ? t('record.recording') : ''}
          </span>
        </div>
        <Waveform analyser={analyser} active={phase === 'recording'} />

        <div className="field inline">
          <label htmlFor="lang">{t('record.language')}</label>
          <select id="lang" value={mode} onChange={(e) => setMode(e.target.value as TranscriptionMode)} disabled={phase === 'finishing'}>
            {TRANSCRIPTION_MODES.map((m) => (
              <option key={m} value={m}>{t(`modes.${m}`)}</option>
            ))}
          </select>
        </div>

        <div className="controls">
          {phase === 'idle' && (
            <button type="button" className="btn record-btn" onClick={start}>
              <Mic size={22} aria-hidden /> {t('record.start')}
            </button>
          )}
          {phase === 'starting' && (
            <button type="button" className="btn record-btn" disabled>
              <Loader2 size={22} className="spin" aria-hidden /> {t('record.starting')}
            </button>
          )}
          {active && (
            <>
              {phase === 'recording' ? (
                <button type="button" className="btn round" onClick={pause} aria-label={t('record.pause')}>
                  <Pause size={22} />
                </button>
              ) : (
                <button type="button" className="btn round" onClick={resume} aria-label={t('record.resume')}>
                  <Play size={22} />
                </button>
              )}
              <button type="button" className="btn round stop" onClick={() => void finalize(true)} aria-label={t('record.stop')}>
                <Square size={22} />
              </button>
              <button type="button" className="btn round" onClick={addBookmark} aria-label={t('record.bookmark')}>
                <BookmarkIcon size={22} />
              </button>
            </>
          )}
          {phase === 'finishing' && (
            <div className="finishing">
              <Loader2 size={18} className="spin" aria-hidden />
              <span>{t('record.finishing', { count: pending })}</span>
              {pending > 0 && (
                <button type="button" className="btn small ghost" onClick={skipWaiting}>{t('record.skipWaiting')}</button>
              )}
            </div>
          )}
        </div>

        {(active || phase === 'finishing') && (
          <div className="engine-line small muted">
            {engine === 'server' ? <Server size={14} aria-hidden /> : <Cpu size={14} aria-hidden />}
            {engine === 'server' ? t('record.engineServer') : t('record.engineBrowser')}
            {modelLoading !== null && ` · ${t('record.loadingModel', { percent: Math.round(modelLoading) })}`}
            {pending > 1 && ` · ${t('record.pending', { count: pending })}`}
            {failed > 0 && ` · ${t('record.failedChunks', { count: failed })}`}
          </div>
        )}
      </div>

      {micError && <MicHelp kind={micError} onRetry={start} />}

      <section className="card live-transcript" aria-live="polite">
        <h2>{t('record.liveTranscript')}</h2>
        {segments.length === 0 ? (
          <p className="muted small">{active ? t('record.listening') : t('record.transcriptHint')}</p>
        ) : (
          segments.map((seg, i) => (
            <p key={i} className="segment">
              <span className="time">{formatClock(seg.start)}</span> {seg.text}
            </p>
          ))
        )}
        <div ref={transcriptEndRef} />
      </section>

      <section className="card">
        <h2>{t('meeting.myNotes')}</h2>
        <textarea
          className="notes-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('record.notesPlaceholder')}
          rows={4}
        />
        {bookmarks.length > 0 && (
          <>
            <h3>{t('meeting.bookmarks')}</h3>
            <ul className="bookmarks">
              {bookmarks.map((b) => (
                <li key={b.id}>
                  <span className="time">{formatClock(b.time)}</span>
                  <input
                    value={b.label}
                    placeholder={t('record.bookmarkLabel')}
                    onChange={(e) => setBookmarks((all) => all.map((x) => (x.id === b.id ? { ...x, label: e.target.value } : x)))}
                    aria-label={t('record.bookmarkLabel')}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {showConsent && (
        <ConsentDialog
          onCancel={() => setShowConsent(false)}
          onAccept={(remember) => {
            setShowConsent(false);
            if (remember) updateSettings({ consentRemembered: true });
            void begin();
          }}
        />
      )}
    </div>
  );
}
