import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { processMeeting } from '../lib/api'
import { formatClock } from '../lib/audio'
import { useAuth } from '../hooks/useAuth'
import { useDraftRecovery } from '../hooks/useDraftRecovery'
import { useQueueSync } from '../hooks/useQueueSync'
import Onboarding from '../components/Onboarding'
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

/** Soft tints for the date badge; picked from the meeting id so a meeting keeps its colour. */
const BADGES = [
  'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/60 dark:text-indigo-100',
  'bg-pink-100 text-pink-900 dark:bg-pink-900/50 dark:text-pink-100',
  'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100',
  'bg-teal-100 text-teal-900 dark:bg-teal-900/50 dark:text-teal-100',
]
const badgeFor = (id: string) => BADGES[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % BADGES.length]

const STATUS_STYLE: Record<string, string> = {
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  uploaded: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  transcribing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  summarising: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
}

const filterCls = 'rounded-full border border-transparent bg-white px-3 py-2 shadow-sm dark:bg-slate-900'

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
  const { found: lostRecording } = useDraftRecovery(user?.id)

  // Meetings can also be finished by the server in the background (tab was closed, other device): keep the list fresh.
  const anyActive = meetings?.some((m) => ['uploaded', 'transcribing', 'summarising'].includes(m.status)) ?? false
  useEffect(() => {
    if (!anyActive) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && inFlight.current.size === 0) void load()
    }, 15_000)
    return () => clearInterval(timer)
  }, [anyActive, load])

  // Overdue action items for the stat tile (a count only; the Insights page lists them).
  const [overdue, setOverdue] = useState<number | null>(null)
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    void supabase
      .from('action_items')
      .select('id', { count: 'exact', head: true })
      .eq('is_done', false)
      .lt('due_date', today)
      .then(({ count, error }) => setOverdue(error ? null : (count ?? 0)))
  }, [meetings])

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
  // "This week" tiles: finished meetings from the last 7 days.
  const week = (() => {
    const since = Date.now() - 7 * 86_400_000
    const recent = (meetings ?? []).filter((m) => m.status === 'done' && Date.parse(m.meeting_date) >= since)
    return { count: recent.length, minutes: recent.reduce((s, m) => s + (m.duration_seconds ?? 0) / 60, 0) }
  })()

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-extrabold tracking-tight">{t('dashboard.title')}</h2>
      <section aria-label={t('dashboard.heroTitle')} className="flex items-center gap-4 rounded-3xl bg-indigo-700 p-5 text-white dark:bg-indigo-800">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-extrabold leading-snug">{t('dashboard.heroTitle')}</h3>
          <p className="mt-1 text-sm leading-relaxed text-indigo-100">{t('dashboard.heroHelp')}</p>
        </div>
        <Link
          to="/record"
          aria-label={t('dashboard.newRecording')}
          className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full bg-white shadow-md"
        >
          <span className="h-7 w-7 rounded-full bg-red-600" />
        </Link>
      </section>
      {meetings && meetings.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5">
          <div className="card px-3 py-3">
            <div className="text-2xl font-extrabold tracking-tight">{week.count}</div>
            <div className="text-xs text-slate-500 dark:text-slate-300">{t('dashboard.statMeetings')}</div>
          </div>
          <div className="card px-3 py-3">
            <div className="text-2xl font-extrabold tracking-tight">{t('insights.hoursShort', { n: (Math.round(week.minutes / 6) / 10).toLocaleString(lang) })}</div>
            <div className="text-xs text-slate-500 dark:text-slate-300">{t('dashboard.statHours')}</div>
          </div>
          <Link
            to="/insights"
            className={`rounded-[1.25rem] border px-3 py-3 ${
              overdue
                ? 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-700 dark:bg-orange-950/50 dark:text-orange-100'
                : 'card border-transparent'
            }`}
          >
            <div className="text-2xl font-extrabold tracking-tight">{overdue ? `⚠ ${overdue}` : (overdue ?? '–')}</div>
            <div className={`text-xs ${overdue ? 'font-semibold' : 'text-slate-500 dark:text-slate-300'}`}>{t('dashboard.statOverdue')}</div>
          </Link>
        </div>
      )}
      {lostRecording && (
        <p className="flex items-center justify-between gap-3 rounded-2xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          <span>{t('draft.dashboardHint')}</span>
          <Link to="/record" className="shrink-0 font-semibold underline">
            {t('draft.open')}
          </Link>
        </p>
      )}
      {pending > 0 && (
        <p className="rounded-2xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          {t(pending > 1 ? 'dashboard.pendingMany' : 'dashboard.pendingOne', { n: pending })}
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {user && meetings?.length === 0 && <Onboarding userId={user.id} />}

      <div className="flex flex-col gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('dashboard.search')}
          aria-label={t('dashboard.search')}
          className="w-full rounded-2xl border border-transparent bg-white px-4 py-3 shadow-sm dark:bg-slate-900"
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
      <ul className="flex flex-col gap-2.5">
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
            <li key={m.id} className="card flex gap-3 p-3.5">
              <div
                aria-hidden="true"
                className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl text-center leading-none ${badgeFor(m.id)}`}
              >
                <span className="text-base font-extrabold">{new Date(m.meeting_date).getDate()}</span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase">
                  {new Date(m.meeting_date).toLocaleDateString(lang, { month: 'short' })}
                </span>
              </div>
              <div className="min-w-0 flex-1">
              <Link to={`/meeting/${m.id}`} className="block text-base font-bold">
                {m.title}
              </Link>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-300">
                <span className={`rounded-full px-2.5 py-1 font-bold ${STATUS_STYLE[status] ?? STATUS_STYLE.uploaded}`}>
                  {t(`status.${status}` as TKey)}
                </span>
                <span>{new Date(m.meeting_date).toLocaleDateString(lang)}</span>
                <span>{t(`lang.${m.language}` as TKey)}</span>
                {m.duration_seconds != null && <span>{formatClock(m.duration_seconds)}</span>}
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
                <button onClick={() => run(m.id)} className="mt-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
                  {m.status === 'failed' ? t('common.retry') : m.status === 'uploaded' ? t('dashboard.generate') : t('dashboard.resume')}
                </button>
              )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
