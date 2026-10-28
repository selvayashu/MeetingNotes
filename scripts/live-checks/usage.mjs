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
const rest = async (path, { method = 'GET', token, body, key, prefer, raw } = {}) => {
  const k = key ?? ANON
  const res = await fetch(SB + path, { method, headers: { apikey: k, Authorization: `Bearer ${token ?? k}`, ...(raw ? {} : { 'Content-Type': 'application/json' }), Prefer: prefer ?? 'return=representation', ...(raw ? { 'Content-Type': 'audio/wav' } : {}) }, body: raw ? body : body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}
const sql = (q) => { const out = execSync(`npx supabase db query --linked "${q.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows }
const api = async (token, body) => { const r = await fetch(SITE + '/api/process-meeting', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) } }
let fails = 0
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) fails++ }

const tag = Math.random().toString(36).slice(2, 8), pw = 'Tmp-' + tag + '-6Zr'
const users = []; const objects = []; let meetingId, syntheticId, originalCap = '8000'
const mk = async (label, admin) => {
  const email = `meetnotes-test-${label}-${tag}@example.com`
  const c = await rest('/auth/v1/admin/users', { method: 'POST', key: SVC, body: { email, password: pw, email_confirm: true } })
  users.push(c.json.id)
  sql(`update public.profiles set status='approved', is_admin=${admin ? 'true' : 'false'} where id='${c.json.id}'`)
  const t = await rest('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: pw } })
  return { id: c.json.id, email, token: t.json.access_token }
}

try {
  originalCap = sql(`select value from public.app_config where key='ai_daily_neuron_cap'`)[0].value
  const admin = await mk('admin', true), user = await mk('user', false)
  meetingId = crypto.randomUUID()
  const path = `${user.id}/${meetingId}/000.wav`
  const up = await rest(`/storage/v1/object/recordings/${path}`, { method: 'POST', key: SVC, raw: true, body: fs.readFileSync(FIXTURES + 'speech.wav'), prefer: 'return=minimal' })
  ok('test audio uploaded', up.status < 300, `${up.status}`)
  objects.push(path)
  await rest('/rest/v1/meetings', { method: 'POST', key: SVC, prefer: 'return=minimal', body: { id: meetingId, user_id: user.id, title: 'usage test', language: 'en', notes_language: 'en', audio_path: path, audio_parts: [{ path, duration_seconds: 18, mime: 'audio/wav' }], duration_seconds: 18, created_at: new Date(Date.now() - 120_000).toISOString() } })

  // ---- the cap pauses everything: scheduler and manual starts alike, without failing the meeting
  syntheticId = crypto.randomUUID()
  await rest('/rest/v1/ai_usage', { method: 'POST', key: SVC, prefer: 'return=minimal', body: { id: syntheticId, kind: 'notes', neurons: 50 } }) // stand-in usage so the cap is exceeded
  let r = await rest('/rest/v1/rpc/admin_set_ai_cap', { method: 'POST', token: admin.token, body: { new_cap: 1 } })
  ok('admin sets the cap to 1', r.status < 300, `${r.status} ${JSON.stringify(r.json)}`)
  const capped = sql(`select used::float u, cap::float c, reached from public.ai_cap_status()`)[0]
  ok('the day is now over the cap', capped.reached === true, JSON.stringify(capped))
  ok('scheduler starts nothing while capped', sql(`select public.kick_processing() as v`)[0].v === 0)
  ok('...and the pending meeting was left alone', sql(`select auto_attempts a from public.meetings where id='${meetingId}'`)[0].a === 0)
  r = await api(user.token, { meetingId })
  ok('a manual start is refused with a clear message (503)', r.status === 503 && /limit has been reached/i.test(r.json.error), `${r.status} ${JSON.stringify(r.json)}`)
  const st = sql(`select status, error_message from public.meetings where id='${meetingId}'`)[0]
  ok('the meeting is NOT marked failed; it simply waits', st.status === 'uploaded' && !st.error_message, JSON.stringify(st))

  // ---- lift the cap: the scheduler picks the meeting up and finishes it with nobody asking
  await rest('/rest/v1/rpc/admin_set_ai_cap', { method: 'POST', token: admin.token, body: { new_cap: Number(originalCap) } })
  await rest(`/rest/v1/ai_usage?id=eq.${syntheticId}`, { method: 'DELETE', key: SVC })
  ok('cap restored and stand-in usage removed', sql(`select reached r from public.ai_cap_status()`)[0].r === false)
  ok('scheduler now starts the waiting meeting', sql(`select public.kick_processing() as v`)[0].v === 1)
  let row
  for (let i = 0; i < 16; i++) {
    row = sql(`select status, processed_parts p, auto_attempts a, coalesce(error_message,'-') e from public.meetings where id='${meetingId}'`)[0]
    if (row.status === 'done' || row.status === 'failed') break
    await new Promise((r) => setTimeout(r, 10000))
  }
  console.log('   final:', JSON.stringify(row))
  ok('the meeting finished by itself', row.status === 'done', JSON.stringify(row))

  // ---- usage was recorded
  const rows = sql(`select kind, calls, round(audio_seconds,1)::float as secs, tokens_in, tokens_out, round(neurons,2)::float as neurons, estimated, model from public.ai_usage where meeting_id='${meetingId}' order by kind`)
  console.log('   ai_usage rows:', JSON.stringify(rows))
  const tr = rows.find((x) => x.kind === 'transcribe'), nt = rows.find((x) => x.kind === 'notes')
  ok('speech usage recorded with the audio length', !!tr && tr.secs > 10 && tr.neurons > 0, JSON.stringify(tr))
  ok('notes usage recorded with token counts', !!nt && nt.tokens_in > 0 && nt.tokens_out > 0 && nt.neurons > 0, JSON.stringify(nt))
  ok('usage is attributed to the user and the meeting', sql(`select count(*)::int c from public.ai_usage where meeting_id='${meetingId}' and user_id='${user.id}'`)[0].c === rows.length)
  const total = rows.reduce((s, x) => s + x.neurons, 0)

  // ---- the admin views
  r = await rest('/rest/v1/rpc/admin_ai_overview', { method: 'POST', token: admin.token, body: {} })
  ok('admin overview shows today\'s usage', r.status === 200 && Number(r.json[0].used) >= total - 0.01, JSON.stringify(r.json))
  r = await rest('/rest/v1/rpc/admin_usage_daily', { method: 'POST', token: admin.token, body: { days: 7 } })
  ok('daily view has 7 days, today first, including this run', r.status === 200 && r.json.length === 7 && Number(r.json[0].neurons) >= total - 0.01, `${r.status} ${JSON.stringify(r.json[0])}`)
  r = await rest('/rest/v1/rpc/admin_usage_by_user', { method: 'POST', token: admin.token, body: { days: 7 } })
  ok('per-user view lists the test user with their usage', r.status === 200 && r.json.some((u) => u.email === user.email && Number(u.neurons) > 0), JSON.stringify(r.json?.slice?.(0, 2)))
  r = await rest('/rest/v1/rpc/admin_ai_overview', { method: 'POST', token: user.token, body: {} })
  ok('an ordinary user cannot read usage', r.status >= 400, `${r.status}`)
  r = await rest('/rest/v1/ai_usage?select=*', { token: user.token })
  ok('...nor query the usage table directly', r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0), `${r.status} ${JSON.stringify(r.json).slice(0, 80)}`)
} catch (e) {
  ok('test ran without an exception', false, e.stack || e.message)
} finally {
  // ALWAYS lift the cap and remove test data, even after a failure.
  try { sql(`insert into public.app_config(key,value) values ('ai_daily_neuron_cap','${originalCap}') on conflict (key) do update set value = excluded.value`) } catch {}
  if (syntheticId) await rest(`/rest/v1/ai_usage?id=eq.${syntheticId}`, { method: 'DELETE', key: SVC })
  if (meetingId) await rest(`/rest/v1/ai_usage?meeting_id=eq.${meetingId}`, { method: 'DELETE', key: SVC })
  if (objects.length) await fetch(`${SB}/storage/v1/object/recordings`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: objects }) })
  for (const id of users) await rest(`/auth/v1/admin/users/${id}`, { method: 'DELETE', key: SVC })
  console.log('cleanup ->', sql(`select 'cap='||(select value from public.app_config where key='ai_daily_neuron_cap')||' reached='||(select reached from public.ai_cap_status())||' users:'||(select count(*) from auth.users)||' test_users_left:'||(select count(*) from auth.users where email like 'meetnotes-test-%')||' test_usage_rows_left:'||(select count(*) from public.ai_usage where meeting_id='${meetingId ?? '00000000-0000-0000-0000-000000000000'}' or id='${syntheticId ?? '00000000-0000-0000-0000-000000000000'}') as v`)[0].v)
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
