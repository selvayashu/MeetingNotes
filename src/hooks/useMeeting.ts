import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ActionItem, Meeting, MeetingNotes, Segment } from '../lib/types'

export interface MeetingData {
  meeting: Meeting
  notes: MeetingNotes | null
  items: ActionItem[]
  segments: Segment[]
}

async function loadSegments(meetingId: string): Promise<Segment[]> {
  const all: Segment[] = []
  // PostgREST returns at most 1000 rows per request.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('transcript_segments')
      .select('id,start_ms,end_ms,text,original_text,edited_at')
      .eq('meeting_id', meetingId)
      .order('start_ms', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    all.push(...(data as Segment[]))
    if (data.length < 1000) break
  }
  return all
}

export function useMeeting(id: string | undefined) {
  const [data, setData] = useState<MeetingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!id) return
    try {
      const [m, n, a, segments] = await Promise.all([
        supabase.from('meetings').select('*').eq('id', id).maybeSingle(),
        supabase.from('meeting_notes').select('summary,decisions,generated_at,notes_template').eq('meeting_id', id).maybeSingle(),
        supabase
          .from('action_items')
          .select('id,task,owner,due_date,is_done')
          .eq('meeting_id', id)
          .order('is_done')
          .order('due_date', { nullsFirst: false })
          .order('task'),
        loadSegments(id),
      ])
      if (m.error) throw m.error
      if (!m.data) throw new Error('Meeting not found')
      if (n.error) throw n.error
      if (a.error) throw a.error
      setData({
        meeting: m.data as Meeting,
        notes: n.data
          ? { summary: n.data.summary, decisions: (n.data.decisions as string[]) ?? [], generated_at: n.data.generated_at, notes_template: n.data.notes_template }
          : null,
        items: a.data as ActionItem[],
        segments,
      })
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Apply a local change after the server accepted it. */
  const patch = useCallback((fn: (d: MeetingData) => MeetingData) => {
    setData((d) => (d ? fn(d) : d))
  }, [])

  return { data, loading, error, reload, patch }
}
