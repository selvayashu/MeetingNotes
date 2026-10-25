import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { processMeeting } from '../lib/api'
import { formatClock } from '../lib/audio'
import { useAuth } from '../hooks/useAuth'
import { useQueueSync } from '../hooks/useQueueSync'
import { useI18n } from '../i18n/context'
import type { TKey } from '../i18n/translate'

interface MeetingRow {
  id: string
  title: string
  meeting_date: string
  language: string
  duration_seconds: number | null
  status: string
  error_message: string | null
  processed_parts: number
  audio_parts: unknown[]
}

const STATUS_STYLE: Record<string, string> = {
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  uploaded: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  transcribing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  summarising: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
}

const filterCls =
  'rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900'

export default function Dashboard() {
  const { user } = useAuth()
  const { t, lang } = useI18n()
  const [params, setParams] = useSearchParams()
  const [meetings, setMeetings] = useState<MeetingRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<
    Record<string, { processed: number; total: number; stage?: string }>
  >({})
  const inFlight = useRef(new Set<string>())

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('meetings')
      .select(
        'id,title,meeting_date,language,duration_seconds,status,error_message,processed_parts,audio_parts',
      )
      .order('meeting_date', { ascending: false })
    if (error) setError(error.message)
    else setMeetings(data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = useCallback(
    async (id: string) => {
      if (inFlight.current.has(id)) return
      inFlight.current.add(id)
      setError(null)
      setRunning((r) => ({ ...r, [id]: { processed: 0, total: 0 } }))
      try {
        await processMeeting(id, (p) => setRunning((r) => ({ ...r, [id]: p })))
      } catch (e) {
        setError((e as Error).message)
      } finally {
        inFlight.current.delete(id)
        setRunning((r) => {
          const { [id]: _drop, ...rest } = r
          return rest
        })
        void load()
      }
    },
    [load],
  )

  // After saving a recording, Record navigates here with ?process=<id> to start right away.
  useEffect(() => {
    const id = params.get('process')
    if (!id) return
    setParams({}, { replace: true })
    void load().then(() => run(id))
  }, [params, setParams, load, run])

  const { pending } = useQueueSync(user?.id, load)

  const [query, setQuery] = useState('')
  const [langFilter, setLangFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const filtered = meetings?.filter((m) => {
    if (query.trim() && !m.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) return false
    if (langFilter && m.language !== langFilter) return false
    const day = m.meeting_date.slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  })
  const filtering = Boolean(query || langFilter || from || to)

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('dashboard.title')}</h2>
      {pending > 0 && (
        <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          {t(pending > 1 ? 'dashboard.pendingMany' : 'dashboard.pendingOne', { n: pending })}
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-col gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('dashboard.search')}
          aria-label={t('dashboard.search')}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
        />
        <div className="flex flex-wrap gap-2 text-sm">
          <select
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value)}
            aria-label={t('dashboard.filterLanguage')}
            className={filterCls}
          >
            <option value="">{t('dashboard.allLanguages')}</option>
            <option value="en">{t('lang.en')}</option>
            <option value="hi">{t('lang.hi')}</option>
            <option value="ta">{t('lang.ta')}</option>
            <option value="auto">{t('lang.auto')}</option>
          </select>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label={t('dashboard.fromDate')} className={filterCls} />
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label={t('dashboard.toDate')} className={filterCls} />
          {filtering && (
            <button
              onClick={() => {
                setQuery('')
                setLangFilter('')
                setFrom('')
                setTo('')
              }}
              className="text-indigo-600 underline dark:text-indigo-400"
            >
              {t('common.clear')}
            </button>
          )}
        </div>
      </div>

      {meetings?.length === 0 && <p className="text-slate-500 dark:text-slate-400">{t('dashboard.empty')}</p>}
      {meetings && meetings.length > 0 && filtered?.length === 0 && (
        <p className="text-slate-500 dark:text-slate-400">{t('dashboard.noMatch')}</p>
      )}
      <ul className="flex flex-col gap-2">
        {filtered?.map((m) => {
          const prog = running[m.id]
          const total = prog?.total || m.audio_parts.length
          const processed = prog?.processed ?? m.processed_parts
          const status = prog ? (prog.stage ?? 'transcribing') : m.status
          const canStart =
            !prog &&
            (m.status === 'uploaded' ||
              m.status === 'failed' ||
              m.status === 'transcribing' ||
              m.status === 'summarising')
          return (
            <li key={m.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <Link to={`/meeting/${m.id}`} className="block font-medium">
                {m.title}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span>{new Date(m.meeting_date).toLocaleDateString(lang)}</span>
                <span>{t(`lang.${m.language}` as TKey)}</span>
                {m.duration_seconds != null && <span>{formatClock(m.duration_seconds)}</span>}
                <span className={`ml-auto rounded px-2 py-0.5 font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.uploaded}`}>
                  {t(`status.${status}` as TKey)}
                </span>
              </div>
              {prog && total > 0 && (
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={processed}
                >
                  <div className="h-full bg-indigo-600" style={{ width: `${(processed / total) * 100}%` }} />
                </div>
              )}
              {m.status === 'failed' && !prog && m.error_message && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{m.error_message}</p>
              )}
              {canStart && (
                <button onClick={() => run(m.id)} className="mt-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white">
                  {m.status === 'failed' ? t('common.retry') : m.status === 'uploaded' ? t('dashboard.generate') : t('dashboard.resume')}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <Link
        to="/record"
        className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-2xl text-white shadow-lg"
        aria-label={t('dashboard.newRecording')}
      >
        ●
      </Link>
    </div>
  )
}
