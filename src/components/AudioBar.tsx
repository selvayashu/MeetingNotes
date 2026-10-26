import { useI18n } from '../i18n/context'
import { formatTimestamp } from '../lib/export'
import type { AudioTimeline } from '../hooks/useAudioTimeline'

const RATES = [1, 1.25, 1.5, 2, 0.75]

export default function AudioBar({ player }: { player: AudioTimeline }) {
  const { t } = useI18n()
  const { ready, error, currentMs, durationMs, playing, rate } = player
  const nextRate = RATES[(RATES.indexOf(rate) + 1) % RATES.length]

  return (
    <div className="card fixed inset-x-4 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-xl px-3 py-2 shadow-lg shadow-indigo-900/15">
      <div className="flex items-center gap-3">
        <button
          onClick={player.toggle}
          disabled={!ready}
          aria-label={playing ? t('audio.pause') : t('audio.play')}
          className="h-11 w-11 shrink-0 rounded-full bg-indigo-600 text-white disabled:opacity-50"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(durationMs, 1)}
          step={1000}
          value={Math.min(currentMs, durationMs)}
          disabled={!ready}
          onChange={(e) => player.seekMs(Number(e.target.value), playing)}
          aria-label={t('audio.seek')}
          className="min-w-0 flex-1"
        />
        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {formatTimestamp(currentMs)} / {formatTimestamp(durationMs)}
        </span>
        <button
          onClick={() => player.setRate(nextRate)}
          aria-label={t('audio.speed', { rate })}
          className="w-10 shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-300"
        >
          {rate}x
        </button>
      </div>
      {error && <p role="alert" className="mx-auto max-w-xl pt-1 text-xs text-red-600 dark:text-red-400">{error === 'load' ? t('audio.errLoad') : t('audio.errPlay')}</p>}
    </div>
  )
}
