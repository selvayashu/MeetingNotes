import fs from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
// Paths are relative to this file, so the script runs from any checkout.
const ROOT = path.resolve(import.meta.dirname, '../..')
const FIXTURES = path.join(import.meta.dirname, 'fixtures') + '/'
const vars = Object.fromEntries(fs.readFileSync(ROOT + '/.dev.vars', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]))
const SB = vars.SUPABASE_URL, SVC = vars.SUPABASE_SERVICE_ROLE_KEY
const rest = async (path, { method = 'GET', body, prefer = 'return=minimal', raw } = {}) => {
  const res = await fetch(SB + path, { method, headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': raw ? 'audio/wav' : 'application/json', Prefer: prefer }, body: raw ? body : body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}
const sql = (q) => { const out = execSync(`npx supabase db query --linked "${q.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows }
let fails = 0
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) fails++ }
const tag = Math.random().toString(36).slice(2, 8)
let uid, meetingId, syntheticId, originalCap = '8000'; const objects = []
try {
  originalCap = sql(`select value from public.app_config where key='ai_daily_neuron_cap'`)[0].value
  // 1. cap ON first, so no scheduler tick can slip in before it
  syntheticId = crypto.randomUUID()
  await rest('/rest/v1/ai_usage', { method: 'POST', body: { id: syntheticId, kind: 'notes', neurons: 50 } })
  sql(`insert into public.app_config(key,value) values ('ai_daily_neuron_cap','1') on conflict (key) do update set value = excluded.value`)
  ok('cap is on (day is over it)', sql(`select reached r from public.ai_cap_status()`)[0].r === true)

  // 2. a pending, approved, old-enough meeting that the scheduler WOULD pick if it were allowed
  const c = await rest('/auth/v1/admin/users', { method: 'POST', body: { email: `meetnotes-test-captick-${tag}@example.com`, password: 'Tmp-' + tag + '-5Qw', email_confirm: true } })
  uid = c.json.id
  sql(`update public.profiles set status='approved' where id='${uid}'`)
  meetingId = crypto.randomUUID()
  const path = `${uid}/${meetingId}/000.wav`
  await rest(`/storage/v1/object/recordings/${path}`, { method: 'POST', raw: true, body: fs.readFileSync(FIXTURES + 'speech.wav') })
  objects.push(path)
  await rest('/rest/v1/meetings', { method: 'POST', body: { id: meetingId, user_id: uid, title: 'cap tick test', language: 'en', audio_path: path, audio_parts: [{ path, duration_seconds: 18, mime: 'audio/wav' }], created_at: new Date(Date.now() - 300_000).toISOString() } })
  const eligible = sql(`select count(*)::int n from public.pending_processing_ids(10) where id='${meetingId}'`)[0].n
  ok('the meeting is eligible for the scheduler (so the cap is what stops it)', eligible === 1, `${eligible}`)

  // 3. let at least one REAL scheduler tick happen (it runs every minute)
  const before = sql(`select count(*)::int n from cron.job_run_details where jobid=(select jobid from cron.job where jobname='meetnotes-process-pending')`)[0].n
  console.log('   waiting ~75 s for real scheduler ticks...')
  await new Promise((r) => setTimeout(r, 75_000))
  const after = sql(`select count(*)::int n from cron.job_run_details where jobid=(select jobid from cron.job where jobname='meetnotes-process-pending')`)[0].n
  ok(`the scheduler ran ${after - before} time(s) during the cap`, after - before >= 1, `${before} -> ${after}`)
  const row = sql(`select status, auto_attempts a, coalesce(error_message,'-') e, lock_until is null as unlocked from public.meetings where id='${meetingId}'`)[0]
  ok('...and did NOT touch the meeting (no attempts, still uploaded, no error)', row.a === 0 && row.status === 'uploaded' && row.e === '-' && row.unlocked, JSON.stringify(row))
} catch (e) {
  ok('test ran without an exception', false, e.stack || e.message)
} finally {
  try { sql(`insert into public.app_config(key,value) values ('ai_daily_neuron_cap','${originalCap}') on conflict (key) do update set value = excluded.value`) } catch {}
  if (syntheticId) await rest(`/rest/v1/ai_usage?id=eq.${syntheticId}`, { method: 'DELETE' })
  if (meetingId) await rest(`/rest/v1/ai_usage?meeting_id=eq.${meetingId}`, { method: 'DELETE' })
  if (objects.length) await fetch(`${SB}/storage/v1/object/recordings`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: objects }) })
  if (uid) await rest(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' })
  console.log('cleanup ->', sql(`select 'cap='||(select value from public.app_config where key='ai_daily_neuron_cap')||' reached='||(select reached from public.ai_cap_status())||' users:'||(select count(*) from auth.users)||' test_users_left:'||(select count(*) from auth.users where email like 'meetnotes-test-%')||' meetings:'||(select count(*) from public.meetings) as v`)[0].v)
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
