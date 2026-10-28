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
const rest = async (path, { method = 'GET', token, body, key, prefer } = {}) => {
  const k = key ?? ANON
  const res = await fetch(SB + path, { method, headers: { apikey: k, Authorization: `Bearer ${token ?? k}`, 'Content-Type': 'application/json', Prefer: prefer ?? 'return=representation' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}
const sql = (q) => { const out = execSync(`npx supabase db query --linked "${q.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows }
let fails = 0
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) fails++ }
const tag = Math.random().toString(36).slice(2, 8), pw = 'Tmp-' + tag + '-7Kd'
let uid
try {
  const email = `meetnotes-test-consent-${tag}@example.com`
  uid = (await rest('/auth/v1/admin/users', { method: 'POST', key: SVC, body: { email, password: pw, email_confirm: true } })).json.id
  sql(`update public.profiles set status='approved' where id='${uid}'`)
  const token = (await rest('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: pw } })).json.access_token

  // exactly what the app's upload does (upsert that ignores duplicates)
  const m1 = crypto.randomUUID(), m2 = crypto.randomUUID()
  const app = (id, extra) => rest('/rest/v1/meetings?on_conflict=id', { method: 'POST', token, prefer: 'resolution=ignore-duplicates,return=representation', body: { id, user_id: uid, title: 't', language: 'en', notes_language: 'en', audio_parts: [], ...extra } })
  let r = await app(m1, { consent_confirmed: true, consent_version: 'v1', consent_confirmed_at: '2001-01-01T00:00:00Z' /* a backdating attempt */ })
  ok('the app\'s insert with consent is accepted', r.status === 201, `${r.status} ${JSON.stringify(r.json).slice(0, 150)}`)
  const row = sql(`select consent_confirmed, consent_version, consent_confirmed_at > now() - interval '2 minutes' as fresh, extract(year from consent_confirmed_at) as yr from public.meetings where id='${m1}'`)[0]
  ok('confirmation recorded with version v1', row.consent_confirmed === true && row.consent_version === 'v1')
  ok('the time was stamped by the database (the backdated 2001 value was ignored)', row.fresh === true && Number(row.yr) > 2001, JSON.stringify(row))

  r = await app(m2, { consent_version: 'v1', consent_confirmed_at: '2001-01-01T00:00:00Z' })
  const row2 = sql(`select consent_confirmed, consent_version, consent_confirmed_at from public.meetings where id='${m2}'`)[0]
  ok('a meeting saved without confirmation has none (and no leftover version/time)', row2.consent_confirmed === false && row2.consent_version === null && row2.consent_confirmed_at === null, JSON.stringify(row2))

  r = await rest(`/rest/v1/meetings?id=eq.${m2}`, { method: 'PATCH', token, body: { consent_confirmed: true } })
  ok('a user cannot add a confirmation afterwards', r.status >= 400, `${r.status}`)
  r = await rest(`/rest/v1/meetings?id=eq.${m1}`, { method: 'PATCH', token, body: { consent_confirmed: false } })
  ok('a user cannot remove it either', r.status >= 400 && sql(`select consent_confirmed as c from public.meetings where id='${m1}'`)[0].c === true, `${r.status}`)
  r = await rest(`/rest/v1/meetings?id=eq.${m1}`, { method: 'PATCH', token, body: { title: 'renamed' } })
  ok('normal edits (rename) still work', r.status === 200 && r.json[0]?.title === 'renamed', `${r.status}`)
  ok('...and a rename leaves the confirmation untouched', sql(`select consent_confirmed and consent_version='v1' as c from public.meetings where id='${m1}'`)[0].c === true)

  // the server's own updates (processing) must not disturb the audit fields either
  await rest(`/rest/v1/meetings?id=eq.${m1}`, { method: 'PATCH', key: SVC, body: { status: 'failed', consent_confirmed: false, consent_version: 'zzz' } })
  const after = sql(`select status, consent_confirmed, consent_version from public.meetings where id='${m1}'`)[0]
  ok('even a service-role update cannot rewrite the audit fields', after.status === 'failed' && after.consent_confirmed === true && after.consent_version === 'v1', JSON.stringify(after))
} catch (e) {
  ok('test ran without exception', false, e.stack || e.message)
} finally {
  if (uid) await rest(`/auth/v1/admin/users/${uid}`, { method: 'DELETE', key: SVC })
  console.log('cleanup ->', sql(`select 'users:'||(select count(*) from auth.users)||' meetings:'||(select count(*) from public.meetings)||' test_users_left:'||(select count(*) from auth.users where email like 'meetnotes-test-%') as v`)[0].v)
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
