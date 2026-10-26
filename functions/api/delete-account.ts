import { createClient } from '@supabase/supabase-js'
import { getUser } from '../lib/auth'
import { DeleteError, deleteAccount } from '../lib/deleteAccount'
import type { Env } from '../lib/env'

/** POST /api/delete-account  { email }: permanently deletes the signed-in user's account and recordings. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUser(request, env)
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { email?: unknown }
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    return Response.json({ ok: true, ...(await deleteAccount(db, user, body.email)) })
  } catch (e) {
    if (e instanceof DeleteError) return Response.json({ error: e.message }, { status: e.status })
    console.error('delete-account failed', (e as Error).message)
    return Response.json({ error: 'Could not delete the account. Nothing was lost; try again.' }, { status: 500 })
  }
}
