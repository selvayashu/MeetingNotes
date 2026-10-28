import fs from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
// Paths are relative to this file, so the script runs from any checkout.
const ROOT = path.resolve(import.meta.dirname, '../..')
const FIXTURES = path.join(import.meta.dirname, 'fixtures') + '/'

const vars = Object.fromEntries(fs.readFileSync(ROOT + '/.dev.vars', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]))
const prod = Object.fromEntries(fs.readFileSync(ROOT + '/.env.production', 'utf8').split(/\r?\n/).filter((l) => /^VITE_/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]))
const SB = vars.SUPABASE_URL, SVC = vars.SUPABASE_SERVICE_ROLE_KEY, ANON = prod.VITE_SUPABASE_ANON_KEY
const SITE = 'https://meetnotes.pages.dev'
const call = async (path, { method = 'GET', key = ANON, token, body, redirect } = {}) => {
  const res = await fetch(SB + path, { method, redirect, headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json, headers: res.headers }
}
const sql = (q) => execSync(`npx supabase db query --linked "${q.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
let fails = 0
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) fails++ }

const tag = Math.random().toString(36).slice(2, 8)
const P1 = 'Sunrise-' + tag + '9', P2 = 'Moonlight-' + tag + '7', P3 = 'Starfall-' + tag + '5'
const email = `meetnotes-test-user-${tag}@example.com`
const adminEmail = `meetnotes-test-admin-${tag}@example.com`
const created = []
try {
  // ---- sign-up with name + email + password (exactly what the app sends)
  let r = await call('/auth/v1/signup', { method: 'POST', body: { email, password: 'weak', data: { full_name: 'Test Person' } } })
  ok('server rejects a weak password (422 weak_password)', r.status === 422 && r.json.error_code === 'weak_password', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`)
  r = await call('/auth/v1/signup', { method: 'POST', body: { email, password: 'allletterspw', data: { full_name: 'Test Person' } } })
  ok('server rejects letters-only password', r.status === 422, `${r.status}`)

  r = await call('/auth/v1/signup', { method: 'POST', body: { email, password: P1, data: { full_name: 'Test Person' } } })
  ok('sign-up succeeds and returns a session immediately (no e-mail step)', r.status === 200 && !!r.json.access_token, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
  const uid = r.json.user?.id; created.push(uid); const tok1 = r.json.access_token
  ok('account is already confirmed (no confirmation e-mail needed)', !!r.json.user?.email_confirmed_at || !!r.json.user?.confirmed_at, JSON.stringify(r.json.user).slice(0, 200))

  const prof = (await call(`/rest/v1/profiles?id=eq.${uid}&select=status,is_admin,full_name`, { token: tok1 })).json[0]
  ok('profile is pending, not admin, and has the name', prof?.status === 'pending' && prof.is_admin === false && prof.full_name === 'Test Person', JSON.stringify(prof))
  const mt = await call('/rest/v1/meetings', { method: 'POST', token: tok1, body: { user_id: uid, title: 'x' } })
  ok('fresh sign-up cannot use the app yet (RLS blocks writes)', mt.status >= 400, `${mt.status}`)

  r = await call('/auth/v1/signup', { method: 'POST', body: { email, password: P1, data: { full_name: 'Again' } } })
  ok('registering the same e-mail again is refused', r.status >= 400, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`)

  // ---- sign in with email + password
  r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: P1 } })
  ok('sign-in with e-mail + password works', r.status === 200 && !!r.json.access_token)
  r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: 'Wrong-' + tag + '1' } })
  ok('wrong password -> invalid_credentials', r.status === 400 && r.json.error_code === 'invalid_credentials', `${r.status} ${JSON.stringify(r.json).slice(0, 100)}`)
  r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: `nobody-${tag}@example.com`, password: P1 } })
  ok('unknown e-mail gives the same error as a wrong password (no account probing)', r.status === 400 && r.json.error_code === 'invalid_credentials')

  // ---- admin approves; then the user is in
  const ar = await call('/auth/v1/admin/users', { method: 'POST', key: SVC, body: { email: adminEmail, password: P3, email_confirm: true } })
  created.push(ar.json.id); sql(`update public.profiles set is_admin=true, status='approved' where id='${ar.json.id}'`)
  const adminTok = (await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: adminEmail, password: P3 } })).json.access_token
  const list = await call('/rest/v1/rpc/admin_list_users', { method: 'POST', token: adminTok, body: {} })
  const row = list.json.find?.((u) => u.email === email)
  ok('admin sees the new user with name and email', list.status === 200 && row?.full_name === 'Test Person' && row.status === 'pending', JSON.stringify(row))
  await call('/rest/v1/rpc/admin_set_status', { method: 'POST', token: adminTok, body: { target: uid, new_status: 'approved' } })
  const mt2 = await call('/rest/v1/meetings', { method: 'POST', token: tok1, body: { user_id: uid, title: 'works' } })
  ok('after approval the same user can use the app', mt2.status === 201, `${mt2.status} ${JSON.stringify(mt2.json).slice(0, 100)}`)

  // ---- change password while signed in (Settings)
  r = await call('/auth/v1/user', { method: 'PUT', token: tok1, body: { password: 'weak' } })
  ok('change-password enforces the rule', r.status === 422, `${r.status}`)
  r = await call('/auth/v1/user', { method: 'PUT', token: tok1, body: { password: P2 } })
  ok('change-password succeeds', r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`)
  ok('old password no longer works', (await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: P1 } })).status === 400)
  ok('new password works', (await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: P2 } })).status === 200)

  // ---- "forgot password": the recover endpoint must not reveal whether an account exists
  r = await call('/auth/v1/recover', { method: 'POST', body: { email: `nobody-${tag}@example.com` }, })
  ok('recover for an unknown e-mail returns the same 200 (no enumeration, no e-mail sent)', r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 100)}`)

  // ---- reset link: generate it without sending e-mail, then follow it like a browser does
  const gl = await call('/auth/v1/admin/generate_link', { method: 'POST', key: SVC, body: { type: 'recovery', email, redirect_to: SITE } })
  ok('recovery link generated', gl.status === 200 && !!gl.json.action_link, `${gl.status} ${JSON.stringify(gl.json).slice(0, 150)}`)
  const hop = await fetch(gl.json.action_link, { redirect: 'manual' })
  const loc = hop.headers.get('location') || ''
  ok('link redirects back to meetnotes.pages.dev (redirect allow-list is right)', hop.status >= 300 && loc.startsWith(SITE), `${hop.status} ${loc.slice(0, 80)}`)
  ok('redirect carries a recovery session', /type=recovery/.test(loc) && /access_token=/.test(loc), loc.replace(/access_token=[^&]+/, 'access_token=…').slice(0, 160))
  const recTok = new URLSearchParams(loc.split('#')[1] || '').get('access_token')
  r = await call('/auth/v1/user', { method: 'PUT', token: recTok, body: { password: 'weak' } })
  ok('reset enforces the password rule', r.status === 422, `${r.status}`)
  r = await call('/auth/v1/user', { method: 'PUT', token: recTok, body: { password: P3 } })
  ok('reset sets the new password', r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`)
  ok('after reset: new password signs in, previous one does not',
    (await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: P3 } })).status === 200 &&
    (await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: P2 } })).status === 400)
  const reuse = await fetch(gl.json.action_link, { redirect: 'manual' })
  ok('the reset link is single-use', /error|expired/i.test(reuse.headers.get('location') || ''), (reuse.headers.get('location') || '').slice(0, 120))
} catch (e) {
  ok('test harness ran without error', false, e.message)
} finally {
  for (const id of created.filter(Boolean)) await call(`/auth/v1/admin/users/${id}`, { method: 'DELETE', key: SVC })
  const out = execSync(`npx supabase db query --linked "select 'users:'||(select count(*) from auth.users)||' profiles:'||(select count(*) from public.profiles)||' meetings:'||(select count(*) from public.meetings)||' leftover_test_users:'||(select count(*) from auth.users where email like 'meetnotes-test-%') as v"`, { cwd: ROOT, encoding: 'utf8' })
  console.log('cleanup ->', out.match(/"v": "([^"]+)"/)[1])
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
