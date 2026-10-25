import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'
import { formatTimestamp } from '../lib/export'
import { activeSegmentIndex } from '../lib/timeline'
import type { Segment } from '../lib/types'

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'giu'))
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-700 dark:text-white">{p}</mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}

interface Props {
  segments: Segment[]
  currentMs: number
  playing: boolean
  canSeek: boolean
  onSeek: (ms: number) => void
}

export default function TranscriptTab({ segments, currentMs, playing, canSeek, onSeek }: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const q = query.trim()
  const activeRef = useRef<HTMLLIElement>(null)

  const visible = useMemo(() => {
    if (!q) return segments
    const needle = q.toLocaleLowerCase()
    return segments.filter((s) => s.text.toLocaleLowerCase().includes(needle))
  }, [segments, q])

  const active = canSeek ? activeSegmentIndex(segments, currentMs) : -1
  const activeId = active >= 0 ? segments[active].id : null

  // Keep the spoken line in view while playing (not while the user is searching).
  useEffect(() => {
    if (playing && !q) activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeId, playing, q])

  if (segments.length === 0) return <p className="text-slate-500 dark:text-slate-400">{t('transcript.none')}</p>

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('transcript.search')}
        aria-label={t('transcript.search')}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
      />
      {q && (
        <p className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
          {visible.length === 1 ? t('transcript.matchOne') : t('transcript.matchMany', { n: visible.length })}
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {visible.map((s) => {
          const isActive = s.id === activeId
          return (
            <li key={s.id} ref={isActive ? activeRef : undefined}>
              <button
                onClick={() => onSeek(s.start_ms)}
                disabled={!canSeek}
                className={`flex w-full gap-3 rounded-lg px-2 py-2 text-left disabled:cursor-default ${
                  isActive ? 'bg-indigo-50 dark:bg-indigo-950' : canSeek ? 'hover:bg-slate-100 dark:hover:bg-slate-900' : ''
                }`}
              >
                <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-indigo-600 dark:text-indigo-400">
                  {formatTimestamp(s.start_ms)}
                </span>
                <span className="min-w-0 flex-1">
                  <Highlight text={s.text} query={q} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
