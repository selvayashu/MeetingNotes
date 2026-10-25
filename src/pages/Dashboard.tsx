import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { processMeeting } from '../lib/api'
import { formatClock } from '../lib/audio'
import { useAuth } from '../hooks/useAuth'
import { useQueueSync } from '../hooks/useQueueSync'

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

export default function Dashboard() {
  const { user } = useAuth()
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

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Meetings</h2>
      {pending > 0 && (
        <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900">
          {pending} recording{pending > 1 ? 's' : ''} waiting to upload.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {meetings?.length === 0 && <p className="text-slate-500">No meetings yet. Tap Record to start.</p>}
      <ul className="flex flex-col gap-2">
        {meetings?.map((m) => {
          const prog = running[m.id]
          const total = prog?.total || m.audio_parts.length
          const processed = prog?.processed ?? m.processed_parts
          const canStart =
            !prog &&
            (m.status === 'uploaded' ||
              m.status === 'failed' ||
              m.status === 'transcribing' ||
              m.status === 'summarising')
          return (
            <li key={m.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="font-medium">{m.title}</div>
              <div className="flex gap-2 text-xs text-slate-500">
                <span>{new Date(m.meeting_date).toLocaleDateString()}</span>
                <span>{m.language}</span>
                {m.duration_seconds != null && <span>{formatClock(m.duration_seconds)}</span>}
                <span className="ml-auto rounded bg-slate-100 px-2 dark:bg-slate-800">{prog ? (prog.stage ?? 'transcribing') : m.status}</span>
              </div>
              {prog && total > 0 && (
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
                  <div className="h-full bg-indigo-600" style={{ width: `${(processed / total) * 100}%` }} />
                </div>
              )}
              {m.status === 'failed' && !prog && m.error_message && (
                <p className="mt-2 text-xs text-red-600">{m.error_message}</p>
              )}
              {canStart && (
                <button onClick={() => run(m.id)} className="mt-2 rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white">
                  {m.status === 'failed' ? 'Retry' : m.status === 'uploaded' ? 'Generate notes' : 'Resume'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <Link
        to="/record"
        className="fixed bottom-6 right-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg"
        aria-label="New recording"
      >
        ●
      </Link>
    </div>
  )
}
