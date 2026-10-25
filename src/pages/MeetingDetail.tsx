import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ActionItemsTab from '../components/ActionItemsTab'
import AudioBar from '../components/AudioBar'
import SummaryTab from '../components/SummaryTab'
import TranscriptTab from '../components/TranscriptTab'
import { useAudioTimeline } from '../hooks/useAudioTimeline'
import { useMeeting } from '../hooks/useMeeting'
import { useI18n } from '../i18n/context'
import type { TKey } from '../i18n/translate'
import { processMeeting } from '../lib/api'
import { buildMarkdown, buildPlainText, fileSlug, type ExportLabels } from '../lib/export'
import { supabase } from '../lib/supabase'

type Tab = 'summary' | 'actions' | 'transcript'
const TABS: { id: Tab; key: TKey }[] = [
  { id: 'summary', key: 'tabs.summary' },
  { id: 'actions', key: 'tabs.actions' },
  { id: 'transcript', key: 'tabs.transcript' },
]

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function MeetingDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const { data, loading, error, reload, patch } = useMeeting(id)
  const [tab, setTab] = useState<Tab>('summary')
  const [withTranscript, setWithTranscript] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)

  const parts = useMemo(() => data?.meeting.audio_parts ?? [], [data?.meeting.audio_parts])
  const player = useAudioTimeline(parts)
  const hasAudio = parts.length > 0

  const say = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(null), 2500)
  }

  const labels: ExportLabels = useMemo(
    () => ({
      summary: t('export.summary'),
      decisions: t('export.decisions'),
      actions: t('export.actions'),
      transcript: t('export.transcript'),
      due: (date) => t('export.due', { date }),
      minutes: (n) => t('common.minutes', { n }),
      lang: (c) => t(`lang.${c}` as TKey),
    }),
    [t],
  )

  const exportData = useMemo(
    () => (data ? { meeting: data.meeting, notes: data.notes, items: data.items, segments: data.segments } : null),
    [data],
  )

  const saveTitle = useCallback(
    async (title: string) => {
      if (!data) return
      const next = title.trim()
      if (!next || next === data.meeting.title) return
      const { error } = await supabase.from('meetings').update({ title: next }).eq('id', data.meeting.id)
      if (error) return setActionError(error.message)
      setActionError(null)
      patch((d) => ({ ...d, meeting: { ...d.meeting, title: next } }))
    },
    [data, patch],
  )

  async function copyMarkdown() {
    if (!exportData) return
    try {
      await navigator.clipboard.writeText(buildMarkdown(exportData, { transcript: withTranscript, labels }))
      say(t('detail.copied'))
    } catch {
      say(t('detail.copyFailed'))
    }
    setMenuOpen(false)
  }

  function downloadAs(kind: 'md' | 'txt') {
    if (!exportData) return
    const name = `${fileSlug(exportData.meeting.title)}.${kind}`
    const opts = { transcript: withTranscript, labels }
    if (kind === 'md') download(name, buildMarkdown(exportData, opts), 'text/markdown')
    else download(name, buildPlainText(exportData, opts), 'text/plain')
    setMenuOpen(false)
  }

  async function share() {
    if (!exportData) return
    const text = buildPlainText(exportData, { transcript: withTranscript, labels })
    setMenuOpen(false)
    if (navigator.share) {
      try {
        await navigator.share({ title: exportData.meeting.title, text })
      } catch (e) {
        if ((e as DOMException).name !== 'AbortError') say(t('detail.shareFailed'))
      }
    } else {
      try {
        await navigator.clipboard.writeText(text)
        say(t('detail.shareCopied'))
      } catch {
        say(t('detail.shareUnsupported'))
      }
    }
  }

  async function remove() {
    if (!data || !window.confirm(t('detail.confirmDelete', { title: data.meeting.title }))) return
    const paths = data.meeting.audio_parts.map((p) => p.path)
    if (paths.length) await supabase.storage.from('recordings').remove(paths)
    const { error } = await supabase.from('meetings').delete().eq('id', data.meeting.id)
    if (error) return setActionError(error.message)
    navigate('/')
  }

  async function run() {
    if (!data) return
    setActionError(null)
    setRunning(t('detail.starting'))
    try {
      await processMeeting(data.meeting.id, (p) =>
        setRunning(
          t(p.stage === 'summarising' ? 'detail.progressSummarising' : 'detail.progressTranscribing', {
            done: p.processed,
            total: p.total,
          }),
        ),
      )
      await reload()
    } catch (e) {
      setActionError((e as Error).message)
      await reload()
    } finally {
      setRunning(null)
    }
  }

  if (loading) return <p className="text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
  if (error || !data) {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-red-600 dark:text-red-400">{error ?? t('detail.notFound')}</p>
        <Link to="/" className="text-indigo-600 underline dark:text-indigo-400">{t('detail.back')}</Link>
      </div>
    )
  }

  const { meeting, notes, items, segments } = data
  const done = meeting.status === 'done'
  const menu: [string, () => void][] = [
    [t('detail.share'), share],
    [t('detail.copyMd'), copyMarkdown],
    [t('detail.dlMd'), () => downloadAs('md')],
    [t('detail.dlTxt'), () => downloadAs('txt')],
  ]

  return (
    <div className={`flex flex-col gap-4 ${hasAudio && done ? 'pb-20' : ''}`}>
      <div className="flex items-center justify-between">
        <Link to="/" className="text-sm text-indigo-600 underline dark:text-indigo-400">{t('detail.back')}</Link>
        {done && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700"
            >
              {t('detail.exportShare')}
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <label className="flex items-center gap-2 px-2 py-2 text-sm">
                  <input type="checkbox" checked={withTranscript} onChange={(e) => setWithTranscript(e.target.checked)} />
                  {t('detail.includeTranscript')}
                </label>
                {menu.map(([label, fn]) => (
                  <button
                    key={label}
                    role="menuitem"
                    onClick={fn}
                    className="block w-full rounded px-2 py-2.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <input
          key={meeting.title}
          defaultValue={meeting.title}
          onBlur={(e) => void saveTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label={t('detail.titleLabel')}
          className="w-full bg-transparent text-2xl font-bold"
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {new Date(meeting.meeting_date).toLocaleString(lang)} · {t(`lang.${meeting.language}` as TKey)}
          {meeting.duration_seconds != null &&
            ` · ${t('common.minutes', { n: Math.max(1, Math.round(meeting.duration_seconds / 60)) })}`}
        </p>
      </div>

      {flash && (
        <p role="status" className="rounded-lg bg-emerald-100 p-2 text-sm text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
          {flash}
        </p>
      )}
      {actionError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}

      {!done ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <p>
            {t('detail.status')}: <b>{t(`status.${meeting.status}` as TKey)}</b>
          </p>
          {meeting.status === 'failed' && meeting.error_message && (
            <p className="text-sm text-red-600 dark:text-red-400">{meeting.error_message}</p>
          )}
          {running ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{running}</p>
          ) : (
            <button onClick={run} className="rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white">
              {meeting.status === 'failed'
                ? t('common.retry')
                : meeting.status === 'uploaded'
                  ? t('dashboard.generate')
                  : t('dashboard.resume')}
            </button>
          )}
        </div>
      ) : (
        <>
          <div role="tablist" className="flex border-b border-slate-200 dark:border-slate-800">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                role="tab"
                aria-selected={tab === tb.id}
                onClick={() => setTab(tb.id)}
                className={`flex-1 border-b-2 px-2 py-3 text-sm font-semibold ${
                  tab === tb.id
                    ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400'
                }`}
              >
                {t(tb.key)}
                {tb.id === 'actions' && items.length > 0 && ` (${items.filter((i) => !i.is_done).length})`}
              </button>
            ))}
          </div>
          <div role="tabpanel">
            {tab === 'summary' && (
              <SummaryTab
                meetingId={meeting.id}
                notes={notes}
                onSaved={(summary) => patch((d) => ({ ...d, notes: d.notes && { ...d.notes, summary } }))}
              />
            )}
            {tab === 'actions' && (
              <ActionItemsTab
                meetingId={meeting.id}
                items={items}
                onChange={(next) => patch((d) => ({ ...d, items: next }))}
              />
            )}
            {tab === 'transcript' && (
              <TranscriptTab
                segments={segments}
                currentMs={player.currentMs}
                playing={player.playing}
                canSeek={hasAudio && player.ready}
                onSeek={(ms) => player.seekMs(ms, true)}
              />
            )}
          </div>
          {!hasAudio && <p className="text-xs text-slate-500 dark:text-slate-400">{t('detail.noAudio')}</p>}
        </>
      )}

      <button onClick={remove} className="self-start py-3 text-sm text-red-600 underline dark:text-red-400">
        {t('detail.delete')}
      </button>

      {hasAudio && done && <AudioBar player={player} />}
    </div>
  )
}
