import fs from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
// Paths are relative to this file, so the script runs from any checkout.
const ROOT = path.resolve(import.meta.dirname, '../..')
const FIXTURES = path.join(import.meta.dirname, 'fixtures') + '/'

const vars = Object.fromEntries(
  fs.readFileSync(ROOT + '/.dev.vars', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]),
)
const prod = Object.fromEntries(
  fs.readFileSync(ROOT + '/.env.production', 'utf8').split(/\r?\n/).filter((l) => /^VITE_/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]),
)
const URL = vars.SUPABASE_URL, SVC = vars.SUPABASE_SERVICE_ROLE_KEY, ANON = prod.VITE_SUPABASE_ANON_KEY
const api = async (path, { method = 'GET', key = ANON, token, body } = {}) => {
  const res = await fetch(URL + path, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}
const sql = (q) => execSync(`npx supabase db query --linked "${q.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const tag = Math.random().toString(36).slice(2, 8)
const pw = 'Tmp-' + Math.random().toString(36).slice(2) + 'A1!'
const users = {}
const results = []
const ok = (name, cond, extra = '') => { results.push([cond, name, extra]); console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra) }

async function mkUser(label) {
  const email = `meetnotes-test-${label}-${tag}@example.com`
  const c = await api('/auth/v1/admin/users', { method: 'POST', key: SVC, body: { email, password: pw, email_confirm: true } })
  if (c.status >= 300) throw new Error(`create ${label}: ${c.status} ${JSON.stringify(c.json).slice(0, 200)}`)
  const t = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: pw } })
  if (t.status !== 200) throw new Error(`login ${label}: ${t.status} ${JSON.stringify(t.json).slice(0, 200)}`)
  users[label] = { id: c.json.id, email, token: t.json.access_token }
}

try {
  await mkUser('admin'); await mkUser('pending')
  const { admin, pending } = users

  const prof = async (u) => (await api(`/rest/v1/profiles?id=eq.${u.id}&select=status,is_admin`, { token: u.token })).json[0]
  ok('new sign-up starts as pending (not admin)', JSON.stringify(await prof(pending)) === '{"status":"pending","is_admin":false}', JSON.stringify(await prof(pending)))

  // make the second test user an admin (service-side, as the real bootstrap does)
  sql(`update public.profiles set is_admin=true, status='approved' where id='${admin.id}'`)
  ok('test admin is approved admin', JSON.stringify(await prof(admin)) === '{"status":"approved","is_admin":true}')

  // ---- pending user is locked out
  const meetBody = { title: 'should not exist' }
  const ins = await api('/rest/v1/meetings', { method: 'POST', token: pending.token, body: { ...meetBody, user_id: pending.id } })
  ok('pending: cannot create a meeting', ins.status >= 400, `${ins.status}`)
  const sel = await api('/rest/v1/meetings?select=id', { token: pending.token })
  ok('pending: sees no meetings', sel.status === 200 && sel.json.length === 0)
  const self = await api(`/rest/v1/profiles?id=eq.${pending.id}`, { method: 'PATCH', token: pending.token, body: { status: 'approved' } })
  ok('pending: cannot self-approve', self.status >= 400, `${self.status} ${JSON.stringify(self.json).slice(0, 100)}`)
  ok('pending: still pending after the attempt', (await prof(pending)).status === 'pending')
  const adm = await api(`/rest/v1/profiles?id=eq.${pending.id}`, { method: 'PATCH', token: pending.token, body: { is_admin: true } })
  ok('pending: cannot make self admin', adm.status >= 400 && !(await prof(pending)).is_admin)
  const list1 = await api('/rest/v1/rpc/admin_list_users', { method: 'POST', token: pending.token, body: {} })
  ok('pending: cannot list users (admin RPC)', list1.status >= 400, `${list1.status}`)
  const set1 = await api('/rest/v1/rpc/admin_set_status', { method: 'POST', token: pending.token, body: { target: pending.id, new_status: 'approved' } })
  ok('pending: cannot approve via admin RPC', set1.status >= 400 && (await prof(pending)).status === 'pending', `${set1.status}`)
  const up = await fetch(`${URL}/storage/v1/object/recordings/${pending.id}/x.webm`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${pending.token}`, 'Content-Type': 'audio/webm' }, body: new Uint8Array([1, 2, 3]) })
  ok('pending: cannot upload audio', up.status >= 400, `${up.status}`)

  // ---- admin sees and approves them
  const list = await api('/rest/v1/rpc/admin_list_users', { method: 'POST', token: admin.token, body: {} })
  ok('admin: lists users incl. the pending one with email', list.status === 200 && list.json.some((u) => u.email === pending.email && u.status === 'pending'), `${list.status}`)
  ok('admin: list includes the real admin account', list.json.some?.((u) => u.email === 'selvayashu@gmail.com' && u.is_admin))
  const selfSet = await api('/rest/v1/rpc/admin_set_status', { method: 'POST', token: admin.token, body: { target: admin.id, new_status: 'rejected' } })
  ok('admin: cannot change own status', selfSet.status >= 400 && (await prof(admin)).status === 'approved')
  const approve = await api('/rest/v1/rpc/admin_set_status', { method: 'POST', token: admin.token, body: { target: pending.id, new_status: 'approved' } })
  ok('admin: approves the user', approve.status < 300 && (await prof(pending)).status === 'approved', `${approve.status} ${JSON.stringify(approve.json).slice(0, 100)}`)

  // ---- now approved: normal access works
  const ins2 = await api('/rest/v1/meetings', { method: 'POST', token: pending.token, body: { ...meetBody, user_id: pending.id } })
  ok('approved: can create a meeting', ins2.status === 201, `${ins2.status} ${JSON.stringify(ins2.json).slice(0, 120)}`)
  const mine = await api('/rest/v1/meetings?select=id', { token: pending.token })
  ok('approved: sees own meeting', mine.json.length === 1)
  const adminSees = await api('/rest/v1/meetings?select=id', { token: admin.token })
  ok('admin: does not see other users\' meetings (isolation intact)', adminSees.json.length === (await api('/rest/v1/meetings?select=id&user_id=eq.' + admin.id, { token: admin.token })).json.length)

  // ---- revoke removes access again
  await api('/rest/v1/rpc/admin_set_status', { method: 'POST', token: admin.token, body: { target: pending.id, new_status: 'rejected' } })
  const after = await api('/rest/v1/meetings?select=id', { token: pending.token })
  ok('revoked: sees no data again', after.status === 200 && after.json.length === 0)
  const ins3 = await api('/rest/v1/meetings', { method: 'POST', token: pending.token, body: { ...meetBody, user_id: pending.id } })
  ok('revoked: cannot create meetings again', ins3.status >= 400)

  await api('/rest/v1/rpc/admin_set_status', { method: 'POST', token: admin.token, body: { target: pending.id, new_status: 'pending' } })
} catch (e) {
  console.log('ERROR', e.message)
  ok('test harness ran without error', false, e.message)
} finally {
  // remove the throw-away users (their profiles and meetings go with them)
  for (const u of Object.values(users)) await api('/auth/v1/admin/users/' + u.id, { method: 'DELETE', key: SVC })
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} passed`)
