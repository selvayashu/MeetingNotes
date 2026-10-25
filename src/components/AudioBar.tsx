import { formatTimestamp } from '../lib/export'
import type { AudioTimeline } from '../hooks/useAudioTimeline'

const RATES = [1, 1.25, 1.5, 2, 0.75]

export default function AudioBar({ player }: { player: AudioTimeline }) {
  const { ready, error, currentMs, durationMs, playing, rate } = player
  const nextRate = RATES[(RATES.indexOf(rate) + 1) % RATES.length]

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto flex max-w-xl items-center gap-3">
        <button
          onClick={player.toggle}
          disabled={!ready}
          aria-label={playing ? 'Pause' : 'Play'}
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
          aria-label="Seek"
          className="min-w-0 flex-1"
        />
        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-500">
          {formatTimestamp(currentMs)} / {formatTimestamp(durationMs)}
        </span>
        <button
          onClick={() => player.setRate(nextRate)}
          aria-label={`Playback speed ${rate}x`}
          className="w-10 shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-300"
        >
          {rate}x
        </button>
      </div>
      {error && <p role="alert" className="mx-auto max-w-xl pt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
