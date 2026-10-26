import { useState } from 'react'
import { useI18n } from '../i18n/context'
import { supabase } from '../lib/supabase'
import type { MeetingNotes } from '../lib/types'

interface Props {
  meetingId: string
  notes: MeetingNotes | null
  onSaved: (summary: string) => void
}

export default function SummaryTab({ meetingId, notes, onSaved }: Props) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!notes) return <p className="text-slate-500 dark:text-slate-400">{t('summary.none')}</p>

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
          <h3 className="font-semibold">{t('summary.title')}</h3>
          {!editing && (
            <button
              onClick={() => {
                setDraft(notes.summary)
                setEditing(true)
              }}
              className="py-1 text-sm text-indigo-600 underline dark:text-indigo-400"
            >
              {t('common.edit')}
            </button>
          )}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              aria-label={t('summary.title')}
              className="w-full rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            />
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={busy || !draft.trim()}
                className="rounded-full bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                {busy ? t('common.saving') : t('common.save')}
              </button>
              <button onClick={() => setEditing(false)} className="rounded-2xl border border-slate-200 px-4 py-2 dark:border-slate-700">
                {t('common.cancel')}
              </button>
            </div>
            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
        ) : (
          <p className="whitespace-pre-wrap leading-relaxed">{notes.summary}</p>
        )}
      </section>

      {notes.decisions.length > 0 && (
        <section>
          <h3 className="mb-1 font-semibold">{t('summary.decisions')}</h3>
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
