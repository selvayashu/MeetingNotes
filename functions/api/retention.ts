import { createClient } from '@supabase/supabase-js'
import { isCronCaller } from '../lib/cron'
import type { Env } from '../lib/env'
import { sweepExpiredAudio } from '../lib/retention'

/** POST /api/retention (scheduler only, header x-cron-secret): deletes audio past its owner's retention period. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await isCronCaller(request.headers.get('x-cron-secret'), env.CRON_SECRET))) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  try {
    return Response.json({ ok: true, ...(await sweepExpiredAudio(db)) })
  } catch (e) {
    console.error('retention failed', (e as Error).message)
    return Response.json({ error: 'Retention sweep failed' }, { status: 500 })
  }
}
