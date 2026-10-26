import type { SupabaseClient } from '@supabase/supabase-js'

export class DeleteError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

const BUCKET = 'recordings'

/** Every object path under `<userId>/`, including recordings that were never attached to a meeting. */
export async function listUserObjects(db: SupabaseClient, userId: string): Promise<string[]> {
  const bucket = db.storage.from(BUCKET)
  const paths: string[] = []
  const walk = async (prefix: string, depth: number): Promise<void> => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket.list(prefix, { limit: 1000, offset })
      if (error) throw new DeleteError(500, `Could not list recordings: ${error.message}`)
      for (const o of data ?? []) {
        const full = `${prefix}/${o.name}`
        if (o.id === null && depth < 3) await walk(full, depth + 1) // a folder
        else if (o.id !== null) paths.push(full)
      }
      if (!data || data.length < 1000) return
    }
  }
  await walk(userId, 0)
  return paths
}

/**
 * Permanently delete a user: their recordings first, then the account itself (the database removes their meetings,
 * transcripts, notes and action items with it). If anything fails before the account is deleted nothing else is
 * touched, so the user can simply try again. `confirmEmail` must match the account's e-mail.
 */
export async function deleteAccount(db: SupabaseClient, user: { id: string; email: string | null }, confirmEmail: unknown) {
  if (typeof confirmEmail !== 'string' || !user.email || confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw new DeleteError(400, 'The e-mail you typed does not match this account.')
  }

  // Never leave the app without an administrator.
  const { data: me, error: meErr } = await db.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (meErr) throw new DeleteError(500, meErr.message)
  if (me?.is_admin) {
    const { count, error } = await db
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_admin', true)
      .eq('status', 'approved')
      .neq('id', user.id)
    if (error) throw new DeleteError(500, error.message)
    if (!count) throw new DeleteError(409, 'You are the only administrator. Make someone else an administrator before deleting this account.')
  }

  const objects = await listUserObjects(db, user.id)
  for (let i = 0; i < objects.length; i += 100) {
    const { error } = await db.storage.from(BUCKET).remove(objects.slice(i, i + 100))
    if (error) throw new DeleteError(500, `Could not delete recordings: ${error.message}`)
  }

  const { error } = await db.auth.admin.deleteUser(user.id)
  if (error) throw new DeleteError(500, `Could not delete the account: ${error.message}`)
  return { deletedRecordings: objects.length }
}
