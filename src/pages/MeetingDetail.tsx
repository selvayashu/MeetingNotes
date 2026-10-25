import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ActionItemsTab from '../components/ActionItemsTab'
import AudioBar from '../components/AudioBar'
import SummaryTab from '../components/SummaryTab'
import TranscriptTab from '../components/TranscriptTab'
import { useAudioTimeline } from '../hooks/useAudioTimeline'
import { useMeeting } from '../hooks/useMeeting'
import { processMeeting } from '../lib/api'
import { buildMarkdown, buildPlainText, fileSlug } from '../lib/export'
import { supabase } from '../lib/supabase'

type Tab = 'summary' | 'actions' | 'transcript'
const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'actions', label: 'Action items' },
  { id: 'transcript', label: 'Transcript' },
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

  const exportData = useMemo(
    () => (data ? { meeting: data.meeting, notes: data.notes, items: data.items, segments: data.segments } : null),
    [data],
  )

  const saveTitle = useCallback(
    async (title: string) => {
      if (!data) return
      const t = title.trim()
      if (!t || t === data.meeting.title) return
      const { error } = await supabase.from('meetings').update({ title: t }).eq('id', data.meeting.id)
      if (error) return setActionError(error.message)
      setActionError(null)
      patch((d) => ({ ...d, meeting: { ...d.meeting, title: t } }))
    },
    [data, patch],
  )

  async function copyMarkdown() {
    if (!exportData) return
    try {
      await navigator.clipboard.writeText(buildMarkdown(exportData, { transcript: withTranscript }))
      say('Copied as Markdown')
    } catch {
      say('Could not copy. Try downloading instead.')
    }
    setMenuOpen(false)
  }

  function downloadAs(kind: 'md' | 'txt') {
    if (!exportData) return
    const name = `${fileSlug(exportData.meeting.title)}.${kind}`
    if (kind === 'md') download(name, buildMarkdown(exportData, { transcript: withTranscript }), 'text/markdown')
    else download(name, buildPlainText(exportData, { transcript: withTranscript }), 'text/plain')
    setMenuOpen(false)
  }

  async function share() {
    if (!exportData) return
    const text = buildPlainText(exportData, { transcript: withTranscript })
    setMenuOpen(false)
    if (navigator.share) {
      try {
        await navigator.share({ title: exportData.meeting.title, text })
      } catch (e) {
        if ((e as DOMException).name !== 'AbortError') say('Sharing failed')
      }
    } else {
      try {
        await navigator.clipboard.writeText(text)
        say('Sharing is not supported here, so the notes were copied')
      } catch {
        say('Sharing is not supported in this browser')
      }
    }
  }

  async function remove() {
    if (!data || !window.confirm(`Delete "${data.meeting.title}"? This cannot be undone.`)) return
    const paths = data.meeting.audio_parts.map((p) => p.path)
    if (paths.length) await supabase.storage.from('recordings').remove(paths)
    const { error } = await supabase.from('meetings').delete().eq('id', data.meeting.id)
    if (error) return setActionError(error.message)
    navigate('/')
  }

  async function run() {
    if (!data) return
    setActionError(null)
    setRunning('Starting…')
    try {
      await processMeeting(data.meeting.id, (p) =>
        setRunning(`${p.stage === 'summarising' ? 'Writing notes' : 'Transcribing'}… ${p.processed}/${p.total}`),
      )
      await reload()
    } catch (e) {
      setActionError((e as Error).message)
      await reload()
    } finally {
      setRunning(null)
    }
  }

  if (loading) return <p className="text-slate-500">Loading…</p>
  if (error || !data) {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-red-600">{error ?? 'Meeting not found'}</p>
        <Link to="/" className="text-indigo-600 underline">Back to meetings</Link>
      </div>
    )
  }

  const { meeting, notes, items, segments } = data
  const done = meeting.status === 'done'

  return (
    <div className={`flex flex-col gap-4 ${hasAudio ? 'pb-20' : ''}`}>
      <div className="flex items-center justify-between">
        <Link to="/" className="text-sm text-indigo-600 underline">← Meetings</Link>
        {done && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold dark:border-slate-700"
            >
              Export / Share
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <label className="flex items-center gap-2 px-2 py-2 text-sm">
                  <input type="checkbox" checked={withTranscript} onChange={(e) => setWithTranscript(e.target.checked)} />
                  Include transcript
                </label>
                {[
                  ['Share…', share],
                  ['Copy as Markdown', copyMarkdown],
                  ['Download .md', () => downloadAs('md')],
                  ['Download .txt', () => downloadAs('txt')],
                ].map(([label, fn]) => (
                  <button
                    key={label as string}
                    role="menuitem"
                    onClick={fn as () => void}
                    className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {label as string}
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
          aria-label="Meeting title"
          className="w-full bg-transparent text-2xl font-bold"
        />
        <p className="text-xs text-slate-500">
          {new Date(meeting.meeting_date).toLocaleString()} · {meeting.language}
          {meeting.duration_seconds != null && ` · ${Math.max(1, Math.round(meeting.duration_seconds / 60))} min`}
        </p>
      </div>

      {flash && <p role="status" className="rounded-lg bg-emerald-100 p-2 text-sm text-emerald-900">{flash}</p>}
      {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}

      {!done ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <p>
            Status: <b>{meeting.status}</b>
          </p>
          {meeting.status === 'failed' && meeting.error_message && (
            <p className="text-sm text-red-600">{meeting.error_message}</p>
          )}
          {running ? (
            <p className="text-sm text-slate-500">{running}</p>
          ) : (
            <button onClick={run} className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white">
              {meeting.status === 'failed' ? 'Retry' : meeting.status === 'uploaded' ? 'Generate notes' : 'Resume'}
            </button>
          )}
        </div>
      ) : (
        <>
          <div role="tablist" className="flex border-b border-slate-200 dark:border-slate-800">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 border-b-2 px-2 py-2.5 text-sm font-semibold ${
                  tab === t.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'
                }`}
              >
                {t.label}
                {t.id === 'actions' && items.length > 0 && ` (${items.filter((i) => !i.is_done).length})`}
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
          {!hasAudio && <p className="text-xs text-slate-500">The audio for this meeting was deleted, so playback is unavailable.</p>}
        </>
      )}

      <button onClick={remove} className="self-start pt-4 text-sm text-red-600 underline">
        Delete meeting
      </button>

      {hasAudio && done && <AudioBar player={player} />}
    </div>
  )
}
