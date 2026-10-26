import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'
import { formatTimestamp } from '../lib/export'
import { supabase } from '../lib/supabase'
import { activeSegmentIndex } from '../lib/timeline'
import { escapeRegExp, planReplace } from '../lib/transcriptEdit'
import type { Segment } from '../lib/types'

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
  /** Called with the full, updated list after an edit has been saved. */
  onChange: (segments: Segment[]) => void
}

const SAVED_COLUMNS = 'id,text,original_text,edited_at'
type Saved = Pick<Segment, 'id' | 'text' | 'original_text' | 'edited_at'>

export default function TranscriptTab({ segments, currentMs, playing, canSeek, onSeek, onChange }: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const q = query.trim()
  const activeRef = useRef<HTMLLIElement>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replacement, setReplacement] = useState('')
  const [replaceMsg, setReplaceMsg] = useState<string | null>(null)

  const visible = useMemo(() => {
    if (!q) return segments
    const needle = q.toLocaleLowerCase()
    return segments.filter((s) => s.text.toLocaleLowerCase().includes(needle))
  }, [segments, q])

  const active = canSeek ? activeSegmentIndex(segments, currentMs) : -1
  const activeId = active >= 0 ? segments[active].id : null

  // Keep the spoken line in view while playing (not while searching or editing).
  useEffect(() => {
    if (playing && !q && !editingId) activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeId, playing, q, editingId])

  const merge = (saved: Saved[]) => {
    const byId = new Map(saved.map((s) => [s.id, s]))
    onChange(segments.map((s) => (byId.has(s.id) ? { ...s, ...byId.get(s.id)! } : s)))
  }

  /** Save new text for one line. The database decides original_text/edited_at, so we take them from its answer. */
  async function saveLine(id: string, text: string) {
    const { data, error } = await supabase.from('transcript_segments').update({ text }).eq('id', id).select(SAVED_COLUMNS).single()
    if (error || !data) throw error ?? new Error('no data')
    merge([data as Saved])
  }

  function startEdit(s: Segment) {
    setEditingId(s.id)
    setDraft(s.text)
    setError(null)
  }

  async function submit(s: Segment, text: string) {
    const trimmed = text.trim()
    if (!trimmed) return setError(t('tedit.empty'))
    if (trimmed === s.text) return setEditingId(null)
    setBusy(true)
    setError(null)
    try {
      await saveLine(s.id, trimmed)
      setEditingId(null)
    } catch {
      setError(t('tedit.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const plan = useMemo(() => planReplace(visible, q, replacement), [visible, q, replacement])

  async function replaceAll() {
    if (plan.edits.length === 0) return
    if (!window.confirm(t('tedit.confirmReplace', { find: q, to: replacement, n: plan.edits.length }))) return
    setBusy(true)
    setReplaceMsg(null)
    const saved: Saved[] = []
    let failed = plan.skipped
    for (let i = 0; i < plan.edits.length; i += 8) {
      const results = await Promise.all(
        plan.edits.slice(i, i + 8).map(({ id, text }) =>
          supabase.from('transcript_segments').update({ text }).eq('id', id).select(SAVED_COLUMNS).single(),
        ),
      )
      for (const r of results) r.error || !r.data ? failed++ : saved.push(r.data as Saved)
    }
    if (saved.length) merge(saved)
    setBusy(false)
    setReplaceMsg(
      t('tedit.replacedN', { n: saved.length }) + (failed ? ' ' + t('tedit.replaceFailed', { n: failed }) : ''),
    )
    if (saved.length) setQuery('')
  }

  if (segments.length === 0) return <p className="text-slate-500 dark:text-slate-400">{t('transcript.none')}</p>

  const small = 'rounded-2xl px-3 py-2 text-sm font-semibold disabled:opacity-60'
  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setReplaceMsg(null)
        }}
        placeholder={t('transcript.search')}
        aria-label={t('transcript.search')}
        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
      />
      {q && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
            {visible.length === 1 ? t('transcript.matchOne') : t('transcript.matchMany', { n: visible.length })}
          </p>
          {visible.length > 0 && (
            <div className="flex gap-2">
              <input
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder={t('tedit.replaceWith')}
                aria-label={t('tedit.replaceWith')}
                className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
              <button
                onClick={replaceAll}
                disabled={busy || plan.edits.length === 0}
                className={`${small} shrink-0 border border-indigo-300 text-indigo-700 dark:border-indigo-700 dark:text-indigo-300`}
              >
                {t('tedit.replaceAll', { n: plan.edits.length })}
              </button>
            </div>
          )}
        </div>
      )}
      {replaceMsg && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {replaceMsg}
        </p>
      )}

      <ul className="flex flex-col gap-1">
        {visible.map((s) => {
          const isActive = s.id === activeId
          const editing = s.id === editingId
          return (
            <li key={s.id} ref={isActive ? activeRef : undefined}>
              {editing ? (
                <div className="flex flex-col gap-2 rounded-2xl border border-indigo-300 p-2 dark:border-indigo-700">
                  <span className="text-xs tabular-nums text-indigo-600 dark:text-indigo-400">{formatTimestamp(s.start_ms)}</span>
                  <textarea
                    autoFocus
                    value={draft}
                    rows={Math.min(8, Math.max(2, Math.ceil(draft.length / 40)))}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditingId(null)
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(s, draft)
                    }}
                    aria-label={t('tedit.edit')}
                    className="w-full rounded-2xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900"
                  />
                  {s.original_text && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t('tedit.original', { text: s.original_text })}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => submit(s, draft)} disabled={busy} className={`${small} bg-indigo-600 text-white`}>
                      {busy ? t('common.saving') : t('common.save')}
                    </button>
                    <button onClick={() => setEditingId(null)} className={`${small} border border-slate-300 dark:border-slate-700`}>
                      {t('common.cancel')}
                    </button>
                    {s.original_text && (
                      <button
                        onClick={() => submit(s, s.original_text!)}
                        disabled={busy}
                        className={`${small} border border-slate-300 dark:border-slate-700`}
                      >
                        {t('tedit.revert')}
                      </button>
                    )}
                    <span className="text-xs text-slate-500 dark:text-slate-400">{t('tedit.hint')}</span>
                  </div>
                  {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                </div>
              ) : (
                <div className={`flex items-start rounded-2xl ${isActive ? 'bg-indigo-50 dark:bg-indigo-950' : ''}`}>
                  <button
                    onClick={() => onSeek(s.start_ms)}
                    disabled={!canSeek}
                    className={`flex min-w-0 flex-1 gap-3 rounded-2xl px-2 py-2 text-left disabled:cursor-default ${
                      !isActive && canSeek ? 'hover:bg-slate-100 dark:hover:bg-slate-900' : ''
                    }`}
                  >
                    <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-indigo-600 dark:text-indigo-400">
                      {formatTimestamp(s.start_ms)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <Highlight text={s.text} query={q} />
                      {s.edited_at && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400" title={s.original_text ?? undefined}>
                          {t('tedit.edited')}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    onClick={() => startEdit(s)}
                    aria-label={`${t('tedit.edit')} ${formatTimestamp(s.start_ms)}`}
                    className="shrink-0 px-3 py-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    ✎
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
