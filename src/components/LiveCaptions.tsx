import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n/context'
import type { TKey } from '../i18n/translate'
import type { CaptionProblem } from '../lib/liveCaptions'

interface Props {
  supported: boolean
  enabled: boolean
  onToggle: (on: boolean) => void
  /** Recording is running (the caption box only shows then). */
  recording: boolean
  lines: string[]
  interim: string
  problem: CaptionProblem | null
}

const PROBLEM_KEY: Record<CaptionProblem, TKey> = {
  denied: 'captions.denied',
  network: 'captions.network',
  language: 'captions.language',
  unavailable: 'captions.unavailable',
}

/** The switch (with its privacy note) and, while recording, the scrolling caption box. */
export default function LiveCaptions({ supported, enabled, onToggle, recording, lines, interim, problem }: Props) {
  const { t } = useI18n()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, interim])

  if (!supported) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">{t('captions.unsupported')}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span>
          <span className="block font-medium">{t('captions.toggle')}</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">{t('captions.privacy')}</span>
        </span>
      </label>

      {enabled && recording && (
        <section aria-label={t('captions.title')} className="flex flex-col gap-1 card p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('captions.title')}</h3>
          {/* aria-live is off on purpose: speech would flood a screen reader. */}
          <div ref={box} role="log" aria-live="off" aria-label={t('captions.title')} className="max-h-40 overflow-y-auto text-base leading-relaxed">
            {lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
            {interim && <p className="text-slate-500 dark:text-slate-400">{interim}</p>}
            {!lines.length && !interim && !problem && (
              <p className="text-slate-500 dark:text-slate-400">{t('captions.listening')}</p>
            )}
          </div>
          {problem && (
            <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
              {t(PROBLEM_KEY[problem])}
            </p>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('captions.note')}</p>
        </section>
      )}
    </div>
  )
}
