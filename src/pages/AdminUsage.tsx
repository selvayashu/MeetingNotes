import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import BarChart, { type Bar } from '../components/BarChart'
import { useI18n } from '../i18n/context'
import { supabase } from '../lib/supabase'

interface Overview {
  used: number
  cap: number
  reached: boolean
  free_allowance: number
  day_start: string
}
interface DayRow {
  day: string
  neurons: number
  audio_minutes: number
  meetings: number
  calls: number
}
interface UserRow {
  user_id: string
  email: string | null
  full_name: string | null
  neurons: number
  audio_minutes: number
  meetings: number
}

const PRESETS = [7, 14, 30]
const USD_PER_1000_NEURONS = 0.011 // Cloudflare Workers AI list price beyond the free allowance
const n = (v: unknown) => Number(v) || 0

export default function AdminUsage() {
  const { t, lang } = useI18n()
  const [days, setDays] = useState(14)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [daily, setDaily] = useState<DayRow[] | null>(null)
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [capInput, setCapInput] = useState('')
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [o, d, u] = await Promise.all([
      supabase.rpc('admin_ai_overview'),
      supabase.rpc('admin_usage_daily', { days }),
      supabase.rpc('admin_usage_by_user', { days }),
    ])
    const failure = o.error ?? d.error ?? u.error
    if (failure) {
      setError(failure.message)
    } else {
      setError(null)
      const ov = (o.data as Record<string, unknown>[])[0]
      setOverview({ used: n(ov.used), cap: n(ov.cap), reached: ov.reached === true, free_allowance: n(ov.free_allowance), day_start: String(ov.day_start) })
      setCapInput(String(n(ov.cap)))
      setDaily((d.data as Record<string, unknown>[]).map((r) => ({ day: String(r.day), neurons: n(r.neurons), audio_minutes: n(r.audio_minutes), meetings: n(r.meetings), calls: n(r.calls) })))
      setUsers((u.data as Record<string, unknown>[]).map((r) => ({ user_id: String(r.user_id), email: (r.email as string) ?? null, full_name: (r.full_name as string) ?? null, neurons: n(r.neurons), audio_minutes: n(r.audio_minutes), meetings: n(r.meetings) })))
    }
    setLoading(false)
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  async function saveCap(e: FormEvent) {
    e.preventDefault()
    const value = Math.floor(Number(capInput))
    if (!Number.isFinite(value) || value < 0) return
    if (value === 0 && !window.confirm(t('usage.confirmOff'))) return
    const { error } = await supabase.rpc('admin_set_ai_cap', { new_cap: value })
    setMsg(error ? { text: t('usage.saveFailed'), error: true } : { text: t('usage.saved'), error: false })
    if (!error) void load()
  }

  const fmt = (v: number) => v.toLocaleString(lang)
  const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang, { month: 'short', day: 'numeric', timeZone: 'UTC' })

  const bars: Bar[] = useMemo(
    () =>
      [...(daily ?? [])].reverse().map((r) => ({
        key: r.day,
        label: dayLabel(r.day),
        value: r.neurons,
        detail: `${r.meetings} ${t('usage.colMeetings').toLowerCase()} · ${r.audio_minutes} ${t('usage.colMinutes').toLowerCase()}`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [daily, lang],
  )

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-red-600 dark:text-red-400">{t('usage.loadFailed')} ({error})</p>
        <Link to="/admin" className="text-sm text-indigo-600 underline dark:text-indigo-400">{t('usage.backToAdmin')}</Link>
      </div>
    )
  }
  if (!overview || !daily || !users) return <p className="text-slate-500 dark:text-slate-400">{t('common.loading')}</p>

  const capped = overview.cap > 0
  const ratio = capped ? overview.used / overview.cap : 0
  const state = overview.reached ? 'paused' : ratio >= 0.7 ? 'warn' : 'ok'
  const fill = state === 'paused' ? 'bg-red-600' : state === 'warn' ? 'bg-amber-500' : 'bg-indigo-600 dark:bg-[#6d74f2]'
  const stateIcon = state === 'paused' ? '⏸' : state === 'warn' ? '▲' : '●'
  const stateColor = state === 'paused' ? 'text-red-700 dark:text-red-300' : state === 'warn' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
  const resetsAt = new Date(Date.parse(overview.day_start) + 86_400_000).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
  const over = Math.max(0, overview.used - overview.free_allowance)
  const cost = (over * USD_PER_1000_NEURONS) / 1000

  const th = 'px-2 py-1.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-300'
  const td = 'px-2 py-1.5 tabular-nums'
  const dailyTable = (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('usage.chartTitle')}</caption>
      <thead>
        <tr className="border-b border-slate-200 dark:border-slate-800">
          <th className={th}>{t('usage.colDay')}</th>
          <th className={th}>{t('usage.colUnits')}</th>
          <th className={th}>{t('usage.colMinutes')}</th>
          <th className={th}>{t('usage.colMeetings')}</th>
          <th className={th}>{t('usage.colCalls')}</th>
        </tr>
      </thead>
      <tbody>
        {daily.map((r) => (
          <tr key={r.day} className="border-b border-slate-100 dark:border-slate-900">
            <td className={td}>{dayLabel(r.day)}</td>
            <td className={td}>{fmt(r.neurons)}</td>
            <td className={td}>{fmt(r.audio_minutes)}</td>
            <td className={td}>{fmt(r.meetings)}</td>
            <td className={td}>{fmt(r.calls)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t('usage.title')}</h2>
        <Link to="/admin" className="text-sm text-indigo-600 underline dark:text-indigo-400">{t('usage.backToAdmin')}</Link>
      </div>
      <p className="-mt-3 text-sm text-slate-500 dark:text-slate-400">{t('usage.explain')}</p>

      {/* One filter row above everything it scopes. */}
      <div role="group" aria-label={t('usage.range')} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500 dark:text-slate-400">{t('usage.range')}</span>
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setDays(p)}
            aria-pressed={days === p}
            className={`rounded-full border px-3 py-1.5 ${days === p ? 'border-indigo-600 bg-indigo-50 font-semibold text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-300' : 'border-slate-300 dark:border-slate-700'}`}
          >
            {t('usage.days', { n: p })}
          </button>
        ))}
      </div>

      <div className={`flex flex-col gap-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        <section aria-label={t('usage.today')} className="flex flex-col gap-2 card p-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('usage.today')}</p>
          <p className="text-4xl font-bold">
            {capped ? t('usage.usedOf', { used: fmt(Math.round(overview.used)), cap: fmt(overview.cap) }) : t('usage.noCap', { used: fmt(Math.round(overview.used)) })}
          </p>
          {capped && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={overview.cap}
              aria-valuenow={Math.min(overview.used, overview.cap)}
              className="h-2 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-950"
            >
              <div className={`h-full ${fill}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
            </div>
          )}
          <p className={`text-sm font-semibold ${stateColor}`}>
            <span aria-hidden>{stateIcon}</span> {t(`usage.state.${state}`)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('usage.resets', { time: resetsAt })}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('usage.free', { n: fmt(overview.free_allowance) })}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {over > 0 ? t('usage.cost', { amount: cost.toLocaleString(lang, { style: 'currency', currency: 'USD' }) }) : t('usage.costFree')}
          </p>
        </section>

        <BarChart
          bars={bars}
          title={t('usage.chartTitle')}
          unit={t('usage.unit')}
          limit={capped ? { value: overview.cap, label: t('usage.limit', { n: fmt(overview.cap) }) } : undefined}
          table={dailyTable}
          labels={{ viewTable: t('usage.viewTable'), viewChart: t('usage.viewChart'), empty: t('usage.empty') }}
          format={fmt}
        />

        <section aria-label={t('usage.byUser')} className="card p-4">
          <h3 className="mb-2 font-semibold">{t('usage.byUser')}</h3>
          {users.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('usage.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className={th}>{t('usage.colUser')}</th>
                    <th className={th}>{t('usage.colUnits')}</th>
                    <th className={th}>{t('usage.colMinutes')}</th>
                    <th className={th}>{t('usage.colMeetings')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.user_id} className="border-b border-slate-100 dark:border-slate-900">
                      <td className="max-w-[12rem] truncate px-2 py-1.5">{u.full_name ? `${u.full_name} · ${u.email ?? ''}` : (u.email ?? '—')}</td>
                      <td className={td}>{fmt(Math.round(u.neurons))}</td>
                      <td className={td}>{fmt(u.audio_minutes)}</td>
                      <td className={td}>{fmt(u.meetings)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <form onSubmit={saveCap} className="flex flex-col gap-2 card p-4">
          <label htmlFor="ai-cap" className="font-semibold">{t('usage.setCap')}</label>
          <div className="flex gap-2">
            <input
              id="ai-cap"
              type="number"
              min={0}
              max={1000000}
              step={100}
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
              className="w-40 rounded-2xl border border-slate-200 bg-white px-3 py-2 tabular-nums dark:border-slate-700 dark:bg-slate-900"
            />
            <button className="rounded-full bg-indigo-600 px-4 py-2 font-semibold text-white">{t('common.save')}</button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('usage.capHelp')}</p>
          {msg && (
            <p role={msg.error ? 'alert' : 'status'} className={`text-sm ${msg.error ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
              {msg.text}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
