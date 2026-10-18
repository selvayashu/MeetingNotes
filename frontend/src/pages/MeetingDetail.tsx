import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Pencil, Plus, RefreshCw, Sparkles, Trash2, Users, Volume2, X, Check } from 'lucide-react';
import ExportMenu from '../components/ExportMenu';
import StatusBanner from '../components/StatusBanner';
import TagEditor from '../components/TagEditor';
import { db, deleteAudio, deleteMeeting, formatClock, transcriptText, type ActionItem, type Meeting, type Notes } from '../lib/db';
import { LANGUAGE_NAMES, OUTPUT_LANGUAGES, SUMMARY_STYLES, type OutputLanguage, type SummaryStyle } from '../lib/languages';
import { generateNotes, identifySpeakers, retranscribe } from '../lib/pipeline';
import { useSettings } from '../lib/settings';
import { toast } from '../lib/toast';

type Tab = 'summary' | 'transcript' | 'actions';

const update = (id: string, changes: Partial<Meeting>) => db.meetings.update(id, { ...changes, updatedAt: Date.now() });
const lines = (text: string) => text.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function MeetingDetail() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  // undefined while loading, null when the meeting does not exist.
  const meeting = useLiveQuery(async () => (await db.meetings.get(id)) ?? null, [id]);
  const audio = useLiveQuery(() => db.audio.get(id), [id]);
  const [tab, setTab] = useState<Tab>('summary');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!audio?.blob) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(audio.blob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);

  useEffect(() => {
    if (meeting) setTitle(meeting.title);
  }, [meeting?.title]); // only resync when the stored title changes

  if (meeting === undefined) {
    return <div className="page"><div className="skeleton-list" aria-busy="true"><div /><div /></div></div>;
  }
  if (meeting === null) {
    return (
      <div className="page">
        <p className="empty">{t('meeting.notFound')}</p>
        <button type="button" className="btn" onClick={() => navigate('/meetings')}>{t('nav.meetings')}</button>
      </div>
    );
  }

  const seek = (time: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = time;
    void el.play();
  };

  const remove = async () => {
    if (!window.confirm(t('meeting.confirmDelete'))) return;
    await deleteMeeting(meeting.id);
    toast(t('meeting.deleted'), 'success');
    navigate('/meetings', { replace: true });
  };

  const removeAudio = async () => {
    if (!window.confirm(t('meeting.confirmDeleteAudio'))) return;
    await deleteAudio(meeting.id);
    toast(t('meeting.audioDeleted'), 'success');
  };

  return (
    <div className="page meeting">
      <div className="record-top">
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <ArrowLeft size={20} />
        </button>
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== meeting.title && void update(meeting.id, { title: title.trim() })}
          aria-label={t('meeting.title')}
        />
      </div>
      <div className="meeting-meta small muted">
        <span>{new Date(meeting.createdAt).toLocaleString(i18n.language, { dateStyle: 'full', timeStyle: 'short' })}</span>
        <span>{formatClock(meeting.durationMs / 1000)}</span>
        {meeting.detectedLanguage && <span>{LANGUAGE_NAMES[meeting.detectedLanguage] ?? meeting.detectedLanguage}</span>}
      </div>
      <TagEditor tags={meeting.tags} onChange={(tags) => void update(meeting.id, { tags })} />

      <StatusBanner meeting={meeting} />

      {audioUrl && (
        <div className="audio-row">
          <Volume2 size={18} aria-hidden className="muted" />
          <audio ref={audioRef} controls src={audioUrl} preload="metadata" />
        </div>
      )}

      <div className="toolbar">
        <ExportMenu meeting={meeting} />
        {meeting.hasAudio && (
          <button type="button" className="btn ghost" onClick={removeAudio}>
            <Volume2 size={16} aria-hidden /> {t('meeting.deleteAudio')}
          </button>
        )}
        <button type="button" className="btn ghost danger" onClick={remove}>
          <Trash2 size={16} aria-hidden /> {t('meeting.delete')}
        </button>
      </div>

      <div className="tabs" role="tablist">
        {(['summary', 'transcript', 'actions'] as Tab[]).map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'active' : ''} onClick={() => setTab(x)}>
            {t(`tabs.${x}`)}
            {x === 'actions' && meeting.notes?.action_items.length ? <span className="count">{meeting.notes.action_items.length}</span> : null}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'summary' && <SummaryTab meeting={meeting} />}
        {tab === 'transcript' && <TranscriptTab meeting={meeting} seek={audioUrl ? seek : undefined} />}
        {tab === 'actions' && <ActionsTab meeting={meeting} />}
      </div>
    </div>
  );
}

function NotesControls({ meeting }: { meeting: Meeting }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>(meeting.notes?.outputLanguage ?? settings.outputLanguage);
  const [style, setStyle] = useState<SummaryStyle>(settings.summaryStyle);
  const busy = meeting.status === 'summarizing' || meeting.status === 'transcribing' || meeting.status === 'queued';
  const hasTranscript = transcriptText(meeting).trim().length > 0;

  const run = async () => {
    if (meeting.notes && !window.confirm(t('notes.confirmRegenerate'))) return;
    try {
      await generateNotes(meeting.id, { outputLanguage, style });
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  return (
    <div className="notes-controls">
      <label>
        <span className="small muted">{t('settings.outputLanguage')}</span>
        <select value={outputLanguage} onChange={(e) => setOutputLanguage(e.target.value as OutputLanguage)}>
          {OUTPUT_LANGUAGES.map((l) => <option key={l} value={l}>{t(`output.${l}`)}</option>)}
        </select>
      </label>
      <label>
        <span className="small muted">{t('settings.summaryStyle')}</span>
        <select value={style} onChange={(e) => setStyle(e.target.value as SummaryStyle)}>
          {SUMMARY_STYLES.map((s) => <option key={s} value={s}>{t(`styles.${s}`)}</option>)}
        </select>
      </label>
      <button type="button" className="btn primary" onClick={() => void run()} disabled={busy || !hasTranscript}>
        <Sparkles size={16} aria-hidden /> {meeting.notes ? t('notes.regenerate') : t('notes.generate')}
      </button>
    </div>
  );
}

function SummaryTab({ meeting }: { meeting: Meeting }) {
  const { t } = useTranslation();
  const notes = meeting.notes;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ summary: '', key_points: '', decisions: '', open_questions: '' });

  const startEdit = () => {
    if (!notes) return;
    setDraft({
      summary: notes.summary,
      key_points: notes.key_points.join('\n'),
      decisions: notes.decisions.join('\n'),
      open_questions: notes.open_questions.join('\n'),
    });
    setEditing(true);
  };

  const save = async () => {
    if (!notes) return;
    const next: Notes = {
      ...notes,
      summary: draft.summary.trim(),
      key_points: lines(draft.key_points),
      decisions: lines(draft.decisions),
      open_questions: lines(draft.open_questions),
    };
    await update(meeting.id, { notes: next });
    setEditing(false);
  };

  if (!notes) {
    return (
      <div className="card">
        {meeting.status === 'summarizing' ? (
          <p className="muted">{t('banner.summarizing')}</p>
        ) : transcriptText(meeting).trim() ? (
          <p className="muted">{t('notes.none')}</p>
        ) : (
          <p className="muted">{t('notes.noTranscript')}</p>
        )}
        <NotesControls meeting={meeting} />
      </div>
    );
  }

  if (editing) {
    const field = (key: keyof typeof draft, label: string, rows: number, hint?: string) => (
      <label className="field">
        <span>{label}</span>
        {hint && <span className="small muted">{hint}</span>}
        <textarea rows={rows} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
      </label>
    );
    return (
      <div className="card notes-edit">
        {field('summary', t('notes.summary'), 5)}
        {field('key_points', t('notes.keyPoints'), 6, t('notes.onePerLine'))}
        {field('decisions', t('notes.decisions'), 4, t('notes.onePerLine'))}
        {field('open_questions', t('notes.openQuestions'), 4, t('notes.onePerLine'))}
        <div className="row-actions">
          <button type="button" className="btn ghost" onClick={() => setEditing(false)}><X size={16} aria-hidden /> {t('common.cancel')}</button>
          <button type="button" className="btn primary" onClick={() => void save()}><Check size={16} aria-hidden /> {t('common.save')}</button>
        </div>
      </div>
    );
  }

  const list = (items: string[], heading: string) =>
    items.length > 0 && (
      <section>
        <h3>{heading}</h3>
        <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </section>
    );

  return (
    <div className="card notes">
      <div className="card-head">
        <h3>{t('notes.summary')}</h3>
        <button type="button" className="btn small ghost" onClick={startEdit}><Pencil size={14} aria-hidden /> {t('common.edit')}</button>
      </div>
      <p className="summary">{notes.summary}</p>
      {list(notes.key_points, t('notes.keyPoints'))}
      {list(notes.decisions, t('notes.decisions'))}
      {list(notes.open_questions, t('notes.openQuestions'))}
      {notes.model && <p className="small muted">{t('notes.generatedBy', { model: notes.model })}</p>}
      <NotesControls meeting={meeting} />
    </div>
  );
}

function TranscriptTab({ meeting, seek }: { meeting: Meeting; seek?: (time: number) => void }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [manualNotes, setManualNotes] = useState(meeting.manualNotes);
  const [busy, setBusy] = useState<'refine' | 'speakers' | null>(null);

  const startEdit = () => {
    setDraft(transcriptText(meeting, true));
    setEditing(true);
  };

  const refine = async () => {
    if (!window.confirm(t('transcript.confirmRefine'))) return;
    setBusy('refine');
    try {
      await retranscribe(meeting.id);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const speakers = async () => {
    setBusy('speakers');
    try {
      await identifySpeakers(meeting.id);
      toast(t('transcript.speakersDone'), 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const processing = meeting.status === 'transcribing' || meeting.status === 'queued';

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h3>{t('tabs.transcript')}</h3>
          {!editing && (
            <div className="row-actions">
              {meeting.hasAudio && (
                <button type="button" className="btn small ghost" onClick={() => void refine()} disabled={!!busy || processing}>
                  <RefreshCw size={14} aria-hidden className={busy === 'refine' ? 'spin' : ''} /> {t('transcript.refine')}
                </button>
              )}
              {meeting.hasAudio && settings.speakerLabels && meeting.segments.length > 0 && meeting.transcriptOverride === undefined && (
                <button type="button" className="btn small ghost" onClick={() => void speakers()} disabled={!!busy || processing}>
                  <Users size={14} aria-hidden className={busy === 'speakers' ? 'spin' : ''} /> {t('transcript.speakers')}
                </button>
              )}
              <button type="button" className="btn small ghost" onClick={startEdit}><Pencil size={14} aria-hidden /> {t('common.edit')}</button>
            </div>
          )}
        </div>

        {editing ? (
          <>
            <textarea className="transcript-edit" rows={16} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="row-actions">
              {meeting.transcriptOverride !== undefined && (
                <button type="button" className="btn ghost" onClick={() => { void update(meeting.id, { transcriptOverride: undefined }); setEditing(false); }}>
                  {t('transcript.restore')}
                </button>
              )}
              <button type="button" className="btn ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
              <button type="button" className="btn primary" onClick={() => { void update(meeting.id, { transcriptOverride: draft }); setEditing(false); }}>
                {t('common.save')}
              </button>
            </div>
          </>
        ) : meeting.transcriptOverride !== undefined ? (
          <>
            <p className="small muted">{t('transcript.edited')}</p>
            <p className="pre">{meeting.transcriptOverride}</p>
          </>
        ) : meeting.segments.length === 0 ? (
          <p className="muted">{processing ? t('banner.transcribing') : t('transcript.empty')}</p>
        ) : (
          <div className="segments">
            {meeting.segments.map((s, i) => (
              <p key={i} className="segment">
                {seek ? (
                  <button type="button" className="time link" onClick={() => seek(s.start)}>{formatClock(s.start)}</button>
                ) : (
                  <span className="time">{formatClock(s.start)}</span>
                )}{' '}
                {s.speaker && <strong className="speaker">{s.speaker}: </strong>}
                {s.text}
              </p>
            ))}
          </div>
        )}
        {meeting.transcribedBy && <p className="small muted">{t('transcript.engine', { engine: meeting.transcribedBy })}</p>}
      </div>

      {meeting.bookmarks.length > 0 && (
        <div className="card">
          <h3>{t('meeting.bookmarks')}</h3>
          <ul className="bookmarks">
            {meeting.bookmarks.map((b) => (
              <li key={b.id}>
                {seek ? (
                  <button type="button" className="time link" onClick={() => seek(b.time)}>{formatClock(b.time)}</button>
                ) : (
                  <span className="time">{formatClock(b.time)}</span>
                )}
                <span>{b.label || t('record.bookmark')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h3>{t('meeting.myNotes')}</h3>
        <textarea
          className="notes-input"
          rows={5}
          value={manualNotes}
          onChange={(e) => setManualNotes(e.target.value)}
          onBlur={() => manualNotes !== meeting.manualNotes && void update(meeting.id, { manualNotes })}
          placeholder={t('record.notesPlaceholder')}
        />
      </div>
    </>
  );
}

function ActionsTab({ meeting }: { meeting: Meeting }) {
  const { t } = useTranslation();
  const notes = meeting.notes;
  const [items, setItems] = useState<ActionItem[]>(notes?.action_items ?? []);

  useEffect(() => {
    setItems(meeting.notes?.action_items ?? []);
  }, [meeting.notes?.action_items]);

  if (!notes) {
    return <div className="card"><p className="muted">{t('actions.noNotes')}</p></div>;
  }

  const persist = (next: ActionItem[]) => {
    setItems(next);
    void update(meeting.id, { notes: { ...notes, action_items: next } });
  };
  const edit = (index: number, changes: Partial<ActionItem>) => setItems(items.map((a, i) => (i === index ? { ...a, ...changes } : a)));

  return (
    <div className="card">
      {items.length === 0 && <p className="muted">{t('actions.none')}</p>}
      <ul className="action-list">
        {items.map((a, i) => (
          <li key={i} className={a.done ? 'done' : ''}>
            <input
              type="checkbox"
              checked={!!a.done}
              onChange={(e) => persist(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
              aria-label={t('actions.done')}
            />
            <div className="action-fields">
              <input className="task" value={a.task} onChange={(e) => edit(i, { task: e.target.value })} onBlur={() => persist(items)} aria-label={t('actions.task')} placeholder={t('actions.task')} />
              <div className="action-meta">
                <input value={a.owner} onChange={(e) => edit(i, { owner: e.target.value })} onBlur={() => persist(items)} aria-label={t('actions.owner')} placeholder={t('actions.owner')} />
                <input value={a.due_date} onChange={(e) => edit(i, { due_date: e.target.value })} onBlur={() => persist(items)} aria-label={t('actions.due')} placeholder={t('actions.due')} />
              </div>
            </div>
            <button type="button" className="icon-btn" onClick={() => persist(items.filter((_, j) => j !== i))} aria-label={t('common.delete')}>
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn ghost" onClick={() => persist([...items, { task: '', owner: '', due_date: '', done: false }])}>
        <Plus size={16} aria-hidden /> {t('actions.add')}
      </button>
    </div>
  );
}
