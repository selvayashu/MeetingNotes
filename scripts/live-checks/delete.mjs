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
const APP = 'https://meetnotes.pages.dev'
const rest = async (path, { method = 'GET', body, raw, key = SVC, bearer = SVC, prefer = 'return=minimal' } = {}) => {
  const res = await fetch(SB + path, { method, headers: { apikey: key, Authorization: `Bearer ${bearer}`, 'Content-Type': raw ? 'audio/wav' : 'application/json', Prefer: prefer }, body: raw ? body : body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}
const sql = (q) => { const out = execSync(`npx supabase db query --linked "${q.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows }
let fails = 0
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) fails++ }
const tag = Math.random().toString(36).slice(2, 8)
const email = `meetnotes-test-del-${tag}@example.com`, password = 'Tmp-' + tag + '-5Qw'
let uid
try {
  const c = await rest('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } })
  uid = c.json.id
  sql(`update public.profiles set status='approved' where id='${uid}'`)
  const mid = crypto.randomUUID()
  const wav = fs.readFileSync(FIXTURES + 'speech.wav')
  const part = `${uid}/${mid}/000.wav`, orphan = `${uid}/orphan.wav`
  for (const p of [part, orphan]) await rest(`/storage/v1/object/recordings/${p}`, { method: 'POST', raw: true, body: wav })
  await rest('/rest/v1/meetings', { method: 'POST', body: { id: mid, user_id: uid, title: 'del test', language: 'en', audio_path: part, audio_parts: [{ path: part, duration_seconds: 18, mime: 'audio/wav' }], status: 'done' } })
  await rest('/rest/v1/meeting_notes', { method: 'POST', body: { meeting_id: mid, summary: 's', decisions: ['d'] } })
  await rest('/rest/v1/transcript_segments', { method: 'POST', body: { meeting_id: mid, start_ms: 0, end_ms: 1000, text: 'hi' } })
  await rest('/rest/v1/action_items', { method: 'POST', body: { meeting_id: mid, task: 't' } })
  const usageId = crypto.randomUUID()
  await rest('/rest/v1/ai_usage', { method: 'POST', body: { id: usageId, user_id: uid, meeting_id: mid, kind: 'notes', neurons: 1 } })

  // the browser export reads these exact columns as the user
  const tok = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token
  ok('signed in as the test user', !!tok)
  const as = (path) => rest(path, { key: PUB, bearer: tok })
  const m = await as('/rest/v1/meetings?select=*'); ok('export can read meetings (select *)', m.status === 200 && m.json.length === 1, JSON.stringify(m.json).slice(0, 200))
  const n = await as('/rest/v1/meeting_notes?select=meeting_id,summary,decisions,generated_at'); ok('export can read notes columns', n.status === 200 && n.json.length === 1, JSON.stringify(n.json))
  const s = await as('/rest/v1/transcript_segments?select=id,meeting_id,start_ms,end_ms,text,original_text,edited_at'); ok('export can read transcript columns', s.status === 200 && s.json.length === 1, JSON.stringify(s.json))
  const a = await as('/rest/v1/action_items?select=id,meeting_id,task,owner,due_date,is_done'); ok('export can read action items', a.status === 200 && a.json.length === 1, JSON.stringify(a.json))
  const p = await as(`/rest/v1/profiles?select=full_name,preferred_language,delete_audio_after_notes,created_at&id=eq.${uid}`); ok('export can read the profile', p.status === 200 && p.json.length === 1, JSON.stringify(p.json))
  const dl = await fetch(`${SB}/storage/v1/object/authenticated/recordings/${part}`, { headers: { apikey: PUB, Authorization: `Bearer ${tok}` } }); ok('export can download own audio', dl.status === 200)

  const call = (b, t = tok) => fetch(APP + '/api/delete-account', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) })
  ok('no token -> 401', (await call({ email }, null)).status === 401)
  ok('wrong e-mail -> 400', (await call({ email: 'other@example.com' })).status === 400)
  ok('...and nothing was deleted', sql(`select count(*)::int n from auth.users where id='${uid}'`)[0].n === 1 && sql(`select count(*)::int n from storage.objects where bucket_id='recordings' and name like '${uid}/%'`)[0].n === 2)
  const r = await call({ email: email.toUpperCase() })
  const body = await r.json()
  ok('correct e-mail (any case) -> 200 with 2 recordings removed', r.status === 200 && body.deletedRecordings === 2, JSON.stringify(body))
  const left = sql(`select (select count(*) from auth.users where id='${uid}')::int u, (select count(*) from public.profiles where id='${uid}')::int p, (select count(*) from public.meetings where id='${mid}')::int m, (select count(*) from public.meeting_notes where meeting_id='${mid}')::int n, (select count(*) from public.transcript_segments where meeting_id='${mid}')::int s, (select count(*) from public.action_items where meeting_id='${mid}')::int a, (select count(*) from storage.objects where bucket_id='recordings' and name like '${uid}/%')::int o`)[0]
  ok('user, profile, meeting, notes, transcript, actions and audio are all gone', Object.values(left).every((v) => v === 0), JSON.stringify(left))
  const kept = sql(`select user_id from public.ai_usage where id='${usageId}'`)
  ok('anonymous usage row kept with no user', kept.length === 1 && kept[0].user_id === null, JSON.stringify(kept))
  await rest(`/rest/v1/ai_usage?id=eq.${usageId}`, { method: 'DELETE' })
  const again = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  ok('cannot sign in again', again.status === 400)
  uid = null
} catch (e) {
  ok('test ran without an exception', false, e.stack || e.message)
} finally {
  if (uid) {
    const objs = sql(`select name from storage.objects where bucket_id='recordings' and name like '${uid}/%'`).map((o) => o.name)
    if (objs.length) await fetch(`${SB}/storage/v1/object/recordings`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: objs }) })
    await rest(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' })
  }
  console.log('cleanup ->', sql(`select 'users:'||(select count(*) from auth.users)||' test_users_left:'||(select count(*) from auth.users where email like 'meetnotes-test-%')||' test_usage_left:'||(select count(*) from public.ai_usage where neurons=1 and kind='notes' and user_id is null) as v`)[0].v)
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
