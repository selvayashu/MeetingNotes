import { useId, useState, type ReactNode } from 'react'
import { compact, labelIndexes, niceMax } from '../lib/chartScale'

export interface Bar {
  key: string
  label: string
  value: number
  /** Extra line for the tooltip, e.g. "3 meetings · 12 min". */
  detail?: string
}

interface Props {
  bars: Bar[]
  title: string
  /** Spoken/printed name of the value, e.g. "AI units". */
  unit: string
  /** A reference line such as a limit. Drawn solid and labelled, never dashed. */
  limit?: { value: number; label: string }
  /** The accessible twin of the chart; shown when the reader switches to table view. */
  table: ReactNode
  labels: { viewTable: string; viewChart: string; empty: string }
  format?: (n: number) => string
  height?: number
}

const PLOT_BAND = 24 // px reserved under the plot for the x labels, so the card never needs a nested scrollbar

/**
 * Column chart for one series. One colour (the series has no second meaning), thin columns with a rounded top and a
 * square base, a 2px gap between neighbours, hairline solid gridlines, one label on the newest bar, and a tooltip per
 * column that is also reachable by keyboard. Everything shown is also in the table view.
 */
export default function BarChart({ bars, title, unit, limit, table, labels, format = (n) => n.toLocaleString(), height = 160 }: Props) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [active, setActive] = useState<number | null>(null)
  const id = useId()

  const dataMax = Math.max(0, ...bars.map((b) => b.value), limit?.value ?? 0)
  const max = niceMax(dataMax)
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`
  const px = (v: number) => (Math.min(v, max) / max) * height // exact pixels, for things positioned from the column's bottom
  const showLabel = labelIndexes(bars.length)
  const hasData = bars.some((b) => b.value > 0)
  const last = bars.length - 1

  return (
    <figure className="flex flex-col gap-2" aria-labelledby={`${id}-t`}>
      <div className="flex items-baseline justify-between gap-3">
        <figcaption id={`${id}-t`} className="font-semibold">
          {title}
        </figcaption>
        <button
          type="button"
          onClick={() => setView((v) => (v === 'chart' ? 'table' : 'chart'))}
          className="shrink-0 py-1 text-sm text-indigo-600 underline dark:text-indigo-400"
        >
          {view === 'chart' ? labels.viewTable : labels.viewChart}
        </button>
      </div>

      {view === 'table' ? (
        <div className="overflow-x-auto">{table}</div>
      ) : (
        <div className="mt-3 flex gap-2" style={{ height: height + PLOT_BAND }}>
          {/* y axis: round numbers, compact from 1,000 */}
          <div className="relative w-9 shrink-0 text-right text-[11px] tabular-nums text-slate-500 dark:text-slate-400" style={{ height }} aria-hidden>
            {[0, 0.5, 1].map((f) => (
              <span key={f} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${f * 100}%` }}>
                {compact(max * f)}
              </span>
            ))}
          </div>

          <div className="relative min-w-0 flex-1">
            {/* hairline solid grid */}
            <div className="absolute inset-x-0 top-0" style={{ height }} aria-hidden>
              {[0, 0.5, 1].map((f) => (
                <div key={f} className="absolute inset-x-0 border-t border-slate-200 dark:border-slate-800" style={{ bottom: `${f * 100}%` }} />
              ))}
            </div>

            {limit && (
              <div className="absolute inset-x-0" style={{ bottom: PLOT_BAND + px(limit.value), height: 0 }} aria-hidden>
                <div className="absolute inset-x-0 border-t-2 border-slate-500 dark:border-slate-400" />
                <span className="absolute left-0 -translate-y-full pb-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-200">{limit.label}</span>
              </div>
            )}

            <div role="list" aria-label={title} className="absolute inset-x-0 top-0 flex items-end gap-[2px]" style={{ height: height + PLOT_BAND }}>
              {bars.map((b, i) => (
                <div
                  key={b.key}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${b.label}: ${format(b.value)} ${unit}${b.detail ? `, ${b.detail}` : ''}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((a) => (a === i ? null : a))}
                  className="group relative flex h-full min-w-0 flex-1 flex-col justify-end outline-none"
                >
                  {/* the whole column band is the hover/focus target, not just the painted bar */}
                  <div className="relative flex items-end justify-center" style={{ height }}>
                    {b.value > 0 && (
                      <div
                        className="w-full max-w-6 rounded-t-[4px] bg-indigo-600 transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110 dark:bg-[#6d74f2]"
                        style={{ height: pct(b.value), minHeight: 2 }}
                      />
                    )}
                    {i === last && b.value > 0 && (
                      <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold tabular-nums" style={{ bottom: `calc(${pct(b.value)} + 3px)` }}>
                        {format(b.value)}
                      </span>
                    )}
                  </div>
                  <div className="h-6 pt-1 text-center text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                    {showLabel.has(i) && <span className="whitespace-nowrap">{b.label}</span>}
                  </div>

                  {active === i && (
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-slate-700 dark:bg-slate-900"
                      style={{ left: i < 2 ? '60%' : i > bars.length - 3 ? '40%' : '50%', bottom: PLOT_BAND + px(b.value) + 10 }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span aria-hidden className="inline-block h-0.5 w-3 bg-indigo-600 dark:bg-[#6d74f2]" />
                        <span className="text-sm font-semibold tabular-nums">{format(b.value)}</span>
                        <span className="text-slate-500 dark:text-slate-400">{unit}</span>
                      </div>
                      <div className="text-slate-500 dark:text-slate-400">{b.label}</div>
                      {b.detail && <div className="text-slate-500 dark:text-slate-400">{b.detail}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!hasData && (
              <p className="absolute inset-x-0 text-center text-sm text-slate-500 dark:text-slate-400" style={{ top: height / 2 - 10 }}>
                {labels.empty}
              </p>
            )}
          </div>
        </div>
      )}
    </figure>
  )
}
