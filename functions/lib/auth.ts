import type { Env } from './env'

/** Verify a Supabase JWT with the Auth server. null = missing or not valid. */
export async function getUser(request: Request, env: Env): Promise<{ id: string; email: string | null } | null> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const user = (await res.json()) as { id?: string; email?: string }
  return user.id ? { id: user.id, email: user.email ?? null } : null
}
