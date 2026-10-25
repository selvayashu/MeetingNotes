import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { MeetingNotes } from '../lib/types'

interface Props {
  meetingId: string
  notes: MeetingNotes | null
  onSaved: (summary: string) => void
}

export default function SummaryTab({ meetingId, notes, onSaved }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!notes) return <p className="text-slate-500">No notes yet.</p>

  async function save() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('meeting_notes').update({ summary: draft.trim() }).eq('meeting_id', meetingId)
    setBusy(false)
    if (error) return setError(error.message)
    onSaved(draft.trim())
    setEditing(false)
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-semibold">Summary</h3>
          {!editing && (
            <button
              onClick={() => {
                setDraft(notes.summary)
                setEditing(true)
              }}
              className="text-sm text-indigo-600 underline"
            >
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              aria-label="Summary"
              className="w-full rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            />
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={busy || !draft.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} className="rounded-lg border border-slate-300 px-4 py-2 dark:border-slate-700">
                Cancel
              </button>
            </div>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          </div>
        ) : (
          <p className="whitespace-pre-wrap leading-relaxed">{notes.summary}</p>
        )}
      </section>

      {notes.decisions.length > 0 && (
        <section>
          <h3 className="mb-1 font-semibold">Decisions</h3>
          <ul className="list-disc space-y-1 pl-5">
            {notes.decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
