import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BarChart, { type Bar } from '../components/BarChart'
import { useI18n } from '../i18n/context'
import {
  percentChange,
  periodTotals,
  summariseActions,
  topTopics,
  weeklyBuckets,
  workloadByOwner,
  type ActionStat,
  type MeetingStat,
} from '../lib/insights'
import { supabase } from '../lib/supabase'

interface ActionRow extends ActionStat {
  meetings: { title: string } | null
}
interface NoteRow {
  meeting_id: string
  summary: string
  decisions: string[] | null
}

const PRESETS = [4, 12, 26]
const DAY = 86_400_000

export default function Insights() {
  const { t, lang } = useI18n()
  const [weeks, setWeeks] = useState(12)
  const [meetings, setMeetings] = useState<MeetingStat[] | null>(null)
  const [actions, setActions] = useState<ActionRow[] | null>(null)
  const [notes, setNotes] = useState<NoteRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      // Two periods back, so "vs previous" has something to compare with.
      const since = new Date(Date.now() - weeks * 2 * 7 * DAY - 7 * DAY).toISOString()
      const [m, a, n] = await Promise.all([
        supabase.from('meetings').select('id,meeting_date,duration_seconds,status').eq('status', 'done').gte('meeting_date', since).order('meeting_date', { ascending: false }).limit(1000),
        supabase.from('action_items').select('id,meeting_id,task,owner,due_date,is_done,meetings(title)').limit(2000),
        supabase.from('meeting_notes').select('meeting_id,summary,decisions').order('created_at', { ascending: false }).limit(400),
      ])
      if (cancelled) return
      if (m.error || a.error || n.error) {
        setError(true)
      } else {
        setError(false)
        setMeetings(m.data as MeetingStat[])
        setActions(a.data as unknown as ActionRow[])
        setNotes(n.data as NoteRow[])
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [weeks])

  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)

  const view = useMemo(() => {
    if (!meetings || !actions || !notes) return null
    const { current, previous } = periodTotals(meetings, weeks, now)
    const buckets = weeklyBuckets(meetings, weeks, now)
    const inPeriod = new Set(meetings.filter((x) => Date.parse(x.meeting_date) >= Date.parse(buckets[0].weekStart)).map((x) => x.id))
    const periodItems = actions.filter((x) => inPeriod.has(x.meeting_id))
    const docs = notes
      .filter((x) => inPeriod.has(x.meeting_id))
      .map((x) => ({
        meetingId: x.meeting_id,
        text: [x.summary, ...(x.decisions ?? []), ...actions.filter((i) => i.meeting_id === x.meeting_id).map((i) => i.task)].join('\n'),
      }))
    return {
      current,
      previous,
      buckets,
      all: summariseActions(actions, today),
      period: summariseActions(periodItems, today),
      load: workloadByOwner(actions, today).slice(0, 8),
      topics: topTopics(docs, 12),
      hasAnything: current.meetings > 0 || previous.meetings > 0 || actions.length > 0,
    }
    // `now` changes every render but results only depend on the day, so recompute when data or period change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, actions, notes, weeks, today])

  const fmt = (v: number) => v.toLocaleString(lang)
  const date = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const dur = (minutes: number) => (minutes >= 90 ? t('insights.hoursShort', { n: fmt(Math.round(minutes / 6) / 10) }) : t('insights.minutesShort', { n: fmt(Math.round(minutes)) }))
  const delta = (cur: number, prev: number) => {
    const p = percentChange(cur, prev)
    return p == null ? null : t('insights.vsPrev', { delta: `${p > 0 ? '+' : ''}${p}%`, n: weeks })
  }

  const bars: Bar[] = (view?.buckets ?? []).map((b) => ({
    key: b.weekStart,
    label: date(b.weekStart),
    value: b.meetings,
    detail: `${t('insights.weekOf', { date: date(b.weekStart) })} · ${dur(b.minutes)}`,
  }))

  const th = 'px-2 py-1.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-300'
  const td = 'px-2 py-1.5 tabular-nums'
  const muted = 'text-slate-500 dark:text-slate-400'

  if (error && !view) return <p role="alert" className="text-red-600 dark:text-red-400">{t('insights.loadFailed')}</p>
  if (!view) return <p className={muted}>{t('common.loading')}</p>

  const tile = (label: string, value: string, sub: string | null) => (
    <div className="flex flex-col gap-0.5 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <p className={`text-xs ${muted}`}>{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className={`text-[11px] leading-snug ${muted}`}>{sub}</p>}
    </div>
  )

  const weeklyTable = (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('insights.chartTitle')}</caption>
      <thead>
        <tr className="border-b border-slate-200 dark:border-slate-800">
          <th className={th}>{t('insights.colWeek')}</th>
          <th className={th}>{t('insights.meetings')}</th>
          <th className={th}>{t('insights.colHours')}</th>
        </tr>
      </thead>
      <tbody>
        {[...view.buckets].reverse().map((b) => (
          <tr key={b.weekStart} className="border-b border-slate-100 dark:border-slate-900">
            <td className={td}>{date(b.weekStart)}</td>
            <td className={td}>{fmt(b.meetings)}</td>
            <td className={td}>{fmt(Math.round(b.minutes / 6) / 10)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  const maxTopic = Math.max(1, ...view.topics.map((x) => x.meetings))

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">{t('insights.title')}</h2>

      {!view.hasAnything ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className={muted}>{t('insights.empty')}</p>
          <Link to="/record" className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white">
            {t('insights.recordCta')}
          </Link>
        </div>
      ) : (
        <>
          {/* One filter row above everything it scopes. */}
          <div role="group" aria-label={t('insights.period')} className="flex flex-wrap items-center gap-2 text-sm">
            <span className={muted}>{t('insights.period')}</span>
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setWeeks(p)}
                aria-pressed={weeks === p}
                className={`rounded-full border px-3 py-1.5 ${weeks === p ? 'border-indigo-600 bg-indigo-50 font-semibold text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-300' : 'border-slate-300 dark:border-slate-700'}`}
              >
                {t('insights.weeks', { n: p })}
              </button>
            ))}
          </div>

          <div className={`flex flex-col gap-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            <div className="grid grid-cols-3 gap-2">
              {tile(t('insights.meetings'), fmt(view.current.meetings), delta(view.current.meetings, view.previous.meetings))}
              {tile(t('insights.hours'), fmt(Math.round(view.current.minutes / 6) / 10), delta(view.current.minutes, view.previous.minutes))}
              {tile(t('insights.avg'), dur(view.current.avgMinutes), delta(view.current.avgMinutes, view.previous.avgMinutes))}
            </div>

            <BarChart
              bars={bars}
              title={t('insights.chartTitle')}
              unit={t('insights.unit')}
              table={weeklyTable}
              integer
              labels={{ viewTable: t('usage.viewTable'), viewChart: t('usage.viewChart'), empty: t('usage.empty') }}
              format={fmt}
            />

            <section aria-label={t('insights.actions')} className="flex flex-col gap-3">
              <h3 className="font-semibold">{t('insights.actions')}</h3>
              <div className="grid grid-cols-3 gap-2">
                {tile(t('insights.open'), fmt(view.all.open), null)}
                {tile(
                  t('insights.overdue'),
                  `${view.all.overdue.length ? '⚠ ' : ''}${fmt(view.all.overdue.length)}`,
                  null,
                )}
                {tile(t('insights.dueSoon'), fmt(view.all.dueSoon), null)}
              </div>
              {view.period.completionRate != null && (
                <div className="flex flex-col gap-1">
                  <p className="text-sm">
                    {t('insights.completed')}: <b>{Math.round(view.period.completionRate * 100)}%</b>{' '}
                    <span className={muted}>({t('insights.completedOf', { done: view.period.done, total: view.period.total })})</span>
                  </p>
                  <div
                    role="progressbar"
                    aria-label={t('insights.completed')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(view.period.completionRate * 100)}
                    className="h-2 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-950"
                  >
                    <div className="h-full bg-indigo-600 dark:bg-[#6d74f2]" style={{ width: `${view.period.completionRate * 100}%` }} />
                  </div>
                </div>
              )}

              <h4 className="mt-1 text-sm font-semibold">{t('insights.overdue')}</h4>
              {view.all.overdue.length === 0 ? (
                <p className={`text-sm ${muted}`}>{t('insights.noOverdue')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {(view.all.overdue as ActionRow[]).slice(0, 8).map((a) => (
                    <li key={a.id} className="rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-800">
                      <p className="font-medium">{a.task}</p>
                      <p className={`text-xs ${muted}`}>
                        {a.owner ? `${a.owner} · ` : ''}
                        <span className="text-red-700 dark:text-red-300">{t('insights.dueOn', { date: date(a.due_date!) })}</span>
                        {a.meetings?.title && (
                          <>
                            {' · '}
                            <Link to={`/meeting/${a.meeting_id}`} className="underline">
                              {a.meetings.title}
                            </Link>
                          </>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {view.load.length > 0 && (
              <section aria-label={t('insights.workload')}>
                <h3 className="mb-2 font-semibold">{t('insights.workload')}</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800">
                      <th className={th}>{t('insights.colOwner')}</th>
                      <th className={th}>{t('insights.colOpen')}</th>
                      <th className={th}>{t('insights.colOverdue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.load.map((o) => (
                      <tr key={o.owner ?? '∅'} className="border-b border-slate-100 dark:border-slate-900">
                        <td className="px-2 py-1.5">{o.owner ?? t('insights.unassigned')}</td>
                        <td className={td}>{fmt(o.open)}</td>
                        <td className={`${td} ${o.overdue ? 'font-semibold text-red-700 dark:text-red-300' : ''}`}>
                          {o.overdue ? `⚠ ${fmt(o.overdue)}` : fmt(0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <section aria-label={t('insights.topics')}>
              <h3 className="font-semibold">{t('insights.topics')}</h3>
              <p className={`mb-2 text-xs ${muted}`}>{t('insights.topicsHelp')}</p>
              {view.topics.length === 0 ? (
                <p className={`text-sm ${muted}`}>{t('insights.noTopics')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {view.topics.map((x) => (
                    <li key={x.term} className="flex items-center gap-3 text-sm">
                      <span className="w-28 shrink-0 truncate" lang={lang}>{x.term}</span>
                      <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-950">
                        <span className="block h-full rounded-full bg-indigo-600 dark:bg-[#6d74f2]" style={{ width: `${(x.meetings / maxTopic) * 100}%` }} />
                      </span>
                      <span className={`w-24 shrink-0 text-right text-xs tabular-nums ${muted}`}>{t('insights.inMeetings', { n: x.meetings })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
