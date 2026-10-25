import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRecorder } from '../hooks/useRecorder'
import { ACCEPTED_AUDIO, MAX_RECORDING_SECONDS, formatClock, readDuration } from '../lib/audio'
import { submitRecording } from '../lib/upload'

type Lang = 'en' | 'hi' | 'ta' | 'auto'

const fieldCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base dark:border-slate-700 dark:bg-slate-900'

export default function Record() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const rec = useRecorder()
  const fileInput = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState<Lang>('auto')
  const [notesLanguage, setNotesLanguage] = useState<Lang>('en')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const previewUrl = useMemo(() => (rec.result ? URL.createObjectURL(rec.result.blob) : null), [rec.result])
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const active = rec.state === 'recording' || rec.state === 'paused'
  const hasAudio = Boolean(rec.result || file)

  async function save() {
    if (!user) return
    const blob = rec.result?.blob ?? file
    if (!blob) return
    setBusy(true)
    setError(null)
    try {
      const duration = rec.result ? rec.result.durationSeconds : await readDuration(blob)
      if (duration && duration > MAX_RECORDING_SECONDS) {
        throw new Error(`Recording is longer than the ${MAX_RECORDING_SECONDS / 60}-minute limit.`)
      }
      const res = await submitRecording({
        userId: user.id,
        blob,
        fileName: file?.name,
        title: title.trim() || file?.name.replace(/\.[^.]+$/, '') || 'Untitled meeting',
        language,
        notesLanguage,
        durationSeconds: duration,
      })
      if (res.queued) {
        setNotice("You're offline. The recording is saved on this device and will upload automatically.")
        rec.reset()
        setFile(null)
      } else {
        navigate('/')
      }
    } catch (e) {
      setError((e as Error).message ?? 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold">New meeting</h2>

      <input
        className={fieldCls}
        placeholder="Meeting title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Spoken language
          <select className={fieldCls} value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
            <option value="auto">Auto-detect</option>
            <option value="en">English</option>
            <option value="hi">हिन्दी (Hindi)</option>
            <option value="ta">தமிழ் (Tamil)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Notes language
          <select
            className={fieldCls}
            value={notesLanguage}
            onChange={(e) => setNotesLanguage(e.target.value as Lang)}
          >
            <option value="en">English</option>
            <option value="auto">Same as meeting</option>
          </select>
        </label>
      </div>

      <section className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 p-6 dark:border-slate-800">
        <div className="font-mono text-4xl tabular-nums" aria-live="off">
          {formatClock(rec.state === 'stopped' ? (rec.result?.durationSeconds ?? 0) : rec.elapsed)}
        </div>

        <div
          className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
          role="meter"
          aria-label="Microphone level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(rec.level * 100)}
        >
          <div className="h-full bg-emerald-500 transition-[width] duration-75" style={{ width: `${rec.level * 100}%` }} />
        </div>

        {!active && !hasAudio && (
          <button
            onClick={rec.start}
            aria-label="Start recording"
            className="h-24 w-24 rounded-full bg-red-600 text-white shadow-lg active:scale-95"
          >
            ● Rec
          </button>
        )}

        {active && (
          <div className="flex items-center gap-4">
            <button
              onClick={rec.state === 'paused' ? rec.resume : rec.pause}
              className="h-16 rounded-full border border-slate-300 px-6 font-semibold dark:border-slate-700"
            >
              {rec.state === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button onClick={rec.stop} className="h-20 w-20 rounded-full bg-red-600 font-semibold text-white">
              Stop
            </button>
          </div>
        )}

        {previewUrl && <audio controls className="w-full" src={previewUrl} />}

        {!active && !rec.result && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_AUDIO}
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button onClick={() => fileInput.current?.click()} className="text-sm text-indigo-600 underline">
              {file ? `Selected: ${file.name}` : 'or upload an audio file (mp3, m4a, wav, webm)'}
            </button>
          </>
        )}
      </section>

      {hasAudio && !active && (
        <div className="flex gap-3">
          <button
            onClick={() => {
              rec.reset()
              setFile(null)
            }}
            className="rounded-lg border border-slate-300 px-4 py-3 dark:border-slate-700"
          >
            Discard
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save meeting'}
          </button>
        </div>
      )}

      {(error || rec.error) && (
        <p role="alert" className="text-sm text-red-600">
          {error ?? rec.error}
        </p>
      )}
      {notice && <p className="text-sm text-amber-600">{notice}</p>}
    </div>
  )
}
