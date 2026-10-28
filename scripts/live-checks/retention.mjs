import fs from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
// Paths are relative to this file, so the script runs from any checkout.
const ROOT = path.resolve(import.meta.dirname, '../..')
const FIXTURES = path.join(import.meta.dirname, 'fixtures') + '/'
const vars = Object.fromEntries(fs.readFileSync(ROOT + '/.dev.vars', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]))
const pub = Object.fromEntries(fs.readFileSync(ROOT + '/.env.production', 'utf8').split(/\r?\n/).filter((l) => /^VITE_/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]))
const SB = vars.SUPABASE_URL, SVC = vars.SUPABASE_SERVICE_ROLE_KEY
const PUB = Object.values(pub).find((v) => v.startsWith('sb_publishable_') || v.startsWith('eyJ'))
const rest = async (path, { method = 'GET', body, raw, key = SVC, bearer = SVC } = {}) => {
  const res = await fetch(SB + path, { method, headers: { apikey: key, Authorization: `Bearer ${bearer}`, 'Content-Type': raw ? 'audio/wav' : 'application/json', Prefer: 'return=minimal' }, body: raw ? body : body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}
const sql = (q) => { const out = execSync(`npx supabase db query --linked "${q.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows }
let fails = 0
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) fails++ }
const tag = Math.random().toString(36).slice(2, 8)
const users = []
const wav = fs.readFileSync(FIXTURES + 'speech.wav')
const exists = async (p) => (await fetch(`${SB}/storage/v1/object/authenticated/recordings/${p}`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } })).status === 200
const mk = async (n, patch = '') => {
  const email = `meetnotes-test-ret-${n}-${tag}@example.com`, password = 'Tmp-' + tag + '-5Qw'
  const c = await rest('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } })
  users.push(c.json.id)
  sql(`update public.profiles set status='approved' ${patch} where id='${c.json.id}'`)
  return { id: c.json.id, email, password }
}
const addMeeting = async (u, label, daysOld, { status = 'done', pathOwner = u.id } = {}) => {
  const mid = crypto.randomUUID()
  const path = `${pathOwner}/${mid}/000.wav`
  await rest(`/storage/v1/object/recordings/${path}`, { method: 'POST', raw: true, body: wav })
  await rest('/rest/v1/meetings', { method: 'POST', body: { id: mid, user_id: u.id, title: label, language: 'en', status, audio_path: path, audio_parts: [{ path, duration_seconds: 18, mime: 'audio/wav' }], created_at: new Date(Date.now() - daysOld * 86400000).toISOString() } })
  return { mid, path }
}
try {
  const A = await mk('a')             // will pick 7 days through the normal user path
  const B = await mk('b')             // never picks a period
  // a normal signed-in user can set their own period, and only valid values
  const tok = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: A.email, password: A.password }) })).json()).access_token
  const set = await rest(`/rest/v1/profiles?id=eq.${A.id}`, { method: 'PATCH', key: PUB, bearer: tok, body: { audio_retention_days: 7 } })
  ok('a user can set 7 days on their own profile', set.status < 300, JSON.stringify(set))
  const bad = await rest(`/rest/v1/profiles?id=eq.${A.id}`, { method: 'PATCH', key: PUB, bearer: tok, body: { audio_retention_days: 3 } })
  ok('3 days is refused', bad.status >= 400)
  const sweep = await fetch(`${SB}/rest/v1/rpc/audio_expired`, { method: 'POST', headers: { apikey: PUB, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: '{}' })
  ok('a user cannot call the sweep list', sweep.status >= 400)

  const old = await addMeeting(A, 'old', 10)
  const fresh = await addMeeting(A, 'fresh', 2)
  const running = await addMeeting(A, 'running', 10, { status: 'transcribing' })
  const bOld = await addMeeting(B, 'b-old', 400)              // B chose "until I delete them"
  const victim = await addMeeting(B, 'victim-source', 1)      // a real file belonging to B ...
  // ... that A tampers into their own old meeting's audio_parts
  const evil = crypto.randomUUID()
  await rest('/rest/v1/meetings', { method: 'POST', body: { id: evil, user_id: A.id, title: 'tampered', language: 'en', status: 'done', audio_parts: [{ path: victim.path, duration_seconds: 1 }], created_at: new Date(Date.now() - 20 * 86400000).toISOString() } })

  const before = [await exists(old.path), await exists(fresh.path), await exists(running.path), await exists(bOld.path), await exists(victim.path)]
  ok('setup: all five files exist', before.every(Boolean), JSON.stringify(before))

  console.log('   running the real scheduler function (kick_retention) ...')
  sql('select public.kick_retention()')
  await new Promise((r) => setTimeout(r, 20000))

  ok('the expired meeting\'s audio file was deleted', !(await exists(old.path)))
  const row = sql(`select jsonb_array_length(audio_parts) n, audio_path from public.meetings where id='${old.mid}'`)[0]
  ok('...and its meeting row says there is no audio, but the meeting remains', row.n === 0 && row.audio_path === null)
  ok('a recent meeting keeps its audio', await exists(fresh.path))
  ok('a meeting still being processed keeps its audio, however old', await exists(running.path))
  ok('someone who never set a period keeps their audio', await exists(bOld.path))
  ok('A cannot make the sweep delete B\'s file by tampering with audio_parts', await exists(victim.path))
  const evilRow = sql(`select jsonb_array_length(audio_parts) n from public.meetings where id='${evil}'`)[0]
  ok('...the tampered row itself was cleaned up', evilRow.n === 0)
} catch (e) {
  ok('test ran without an exception', false, e.stack || e.message)
} finally {
  for (const id of users) {
    const objs = sql(`select name from storage.objects where bucket_id='recordings' and name like '${id}/%'`).map((o) => o.name)
    if (objs.length) await fetch(`${SB}/storage/v1/object/recordings`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: objs }) })
    await rest(`/auth/v1/admin/users/${id}`, { method: 'DELETE' })
  }
  console.log('cleanup ->', sql(`select 'test_users_left:'||(select count(*) from auth.users where email like 'meetnotes-test-%')||' test_objects_left:'||(select count(*) from storage.objects where bucket_id='recordings' and name ~ '^[0-9a-f-]{36}/' and owner is null and false) as v`)[0].v)
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
