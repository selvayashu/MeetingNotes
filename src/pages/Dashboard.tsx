import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
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
}

export default function Dashboard() {
  const { user } = useAuth()
  const [meetings, setMeetings] = useState<MeetingRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('meetings')
      .select('id,title,meeting_date,language,duration_seconds,status')
      .order('meeting_date', { ascending: false })
    if (error) setError(error.message)
    else setMeetings(data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
        {meetings?.map((m) => (
          <li key={m.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="font-medium">{m.title}</div>
            <div className="flex gap-2 text-xs text-slate-500">
              <span>{new Date(m.meeting_date).toLocaleDateString()}</span>
              <span>{m.language}</span>
              {m.duration_seconds != null && <span>{formatClock(m.duration_seconds)}</span>}
              <span className="ml-auto rounded bg-slate-100 px-2 dark:bg-slate-800">{m.status}</span>
            </div>
          </li>
        ))}
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
