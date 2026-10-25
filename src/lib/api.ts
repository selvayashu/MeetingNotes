import { supabase } from './supabase'

export interface ProcessProgress {
  done: boolean
  status: string
  processed: number
  total: number
}

async function callProcess(meetingId: string): Promise<ProcessProgress & { busy?: boolean }> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  const res = await fetch('/api/process-meeting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ meetingId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok && res.status !== 202) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body
}

/**
 * Drive processing to completion. The server handles a time-boxed batch per call, so we
 * keep calling until it reports done. Safe to call again after an error: it resumes.
 */
export async function processMeeting(
  meetingId: string,
  onProgress: (p: ProcessProgress) => void,
): Promise<ProcessProgress> {
  let networkFailures = 0
  for (;;) {
    try {
      const p = await callProcess(meetingId)
      networkFailures = 0
      onProgress(p)
      if (p.done) return p
      // 202 busy: another tab/device holds the lock; wait before asking again.
      if (p.busy) await new Promise((r) => setTimeout(r, 4000))
    } catch (err) {
      // Tolerate brief connection drops; real errors (4xx/5xx with a message) bubble up.
      const offline = err instanceof TypeError
      if (!offline || ++networkFailures > 5) throw err
      await new Promise((r) => setTimeout(r, 2000 * networkFailures))
    }
  }
}
