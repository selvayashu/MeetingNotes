import fs from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
// Paths are relative to this file, so the script runs from any checkout.
const ROOT = path.resolve(import.meta.dirname, '../..')
const FIXTURES = path.join(import.meta.dirname, 'fixtures') + '/'

const vars = Object.fromEntries(fs.readFileSync(ROOT + '/.dev.vars', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]))
// `seconds` of speech made by repeating the sample (16 kHz mono 16-bit WAV).
function longSpeech(seconds) {
  const src = fs.readFileSync(FIXTURES + 'speech.wav')
  const pcm = src.subarray(44)
  const copies = Math.ceil((seconds * 32000) / pcm.length)
  const body = Buffer.concat(Array.from({ length: copies }, () => pcm)).subarray(0, seconds * 32000)
  const h = Buffer.from(src.subarray(0, 44))
  h.writeUInt32LE(36 + body.length, 4)
  h.writeUInt32LE(body.length, 40)
  return Buffer.concat([h, body])
}
const SB = vars.SUPABASE_URL, SVC = vars.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SVC, Authorization: `Bearer ${SVC}` }
const sql = (q) => {
  const out = execSync(`npx supabase db query --linked "${q.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  // The CLI prints a banner line, then one JSON object {"rows":[...], "warning":"..."}.
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows
}

const tag = Math.random().toString(36).slice(2, 8)
let uid = null
const uploaded = []
try {
  // 1. a throwaway approved user (as if they had signed up and been approved earlier)
  const email = `meetnotes-test-bg-${tag}@example.com`
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Tmp-' + tag + '-9Zq', email_confirm: true }) })).json()
  uid = u.id
  sql(`update public.profiles set status='approved' where id='${uid}'`)
  console.log('created approved test user')

  // 2. upload 3 x 5 min of speech as the user's audio parts (as the app would), then insert the meeting
  const meetingId = crypto.randomUUID()
  const wav = longSpeech(300)
  const parts = []
  for (let i = 0; i < 3; i++) {
    const path = `${uid}/${meetingId}/00${i}.wav`
    const r = await fetch(`${SB}/storage/v1/object/recordings/${path}`, { method: 'POST', headers: { ...H, 'Content-Type': 'audio/wav' }, body: wav })
    if (!r.ok) throw new Error('upload failed ' + r.status + ' ' + (await r.text()).slice(0, 100))
    uploaded.push(path)
    parts.push({ path, duration_seconds: 300, mime: 'audio/wav' })
  }
  const ins = await fetch(`${SB}/rest/v1/meetings`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id: meetingId, user_id: uid, title: 'background test', language: 'en', notes_language: 'en', audio_path: parts[0].path, audio_parts: parts, duration_seconds: 900 }) })
  if (!ins.ok) throw new Error('insert failed ' + ins.status + ' ' + (await ins.text()).slice(0, 200))
  const t0 = Date.now()
  console.log('uploaded 3 parts and created the meeting. From here nothing calls the API: only the scheduler can finish it.\n')

  // 3. watch
  let last = ''
  let finalRow
  for (let i = 0; i < 40; i++) {
    const row = sql(`select status, processed_parts, auto_attempts, coalesce(error_message,'-') as err, (select count(*) from public.transcript_segments where meeting_id='${meetingId}') as segs, lock_until is not null as locked from public.meetings where id='${meetingId}'`)[0]
    const line = `${row.status.padEnd(12)} parts ${row.processed_parts}/3  scheduler attempts ${row.auto_attempts}  segments ${row.segs}${row.locked ? '  (working)' : ''}${row.err !== '-' ? '  ERROR: ' + row.err : ''}`
    if (line !== last) { console.log(`t+${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s  ${line}`); last = line }
    finalRow = row
    if (row.status === 'done' || row.status === 'failed') break
    await new Promise((r) => setTimeout(r, 15000))
  }

  // 4. result
  const notes = sql(`select length(summary) as summary_chars, jsonb_array_length(decisions) as decisions, (select count(*) from public.action_items where meeting_id='${meetingId}') as actions, left(summary, 160) as head from public.meeting_notes where meeting_id='${meetingId}'`)[0]
  console.log('\nresult:', finalRow.status === 'done' ? 'DONE without any client' : 'NOT DONE (' + finalRow.status + ')')
  console.log('notes:', JSON.stringify(notes))
  console.log('total time:', Math.round((Date.now() - t0) / 1000), 's')
  if (finalRow.status !== 'done') process.exitCode = 1
} catch (e) {
  console.log('ERROR', e.message)
  process.exitCode = 1
} finally {
  // 5. cleanup: audio objects, then the user (cascades profile, meetings, segments, notes, action items)
  if (uploaded.length) await fetch(`${SB}/storage/v1/object/recordings`, { method: 'DELETE', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: uploaded }) })
  if (uid) await fetch(`${SB}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H })
  const left = sql(`select 'users:'||(select count(*) from auth.users)||' meetings:'||(select count(*) from public.meetings)||' test_users_left:'||(select count(*) from auth.users where email like 'meetnotes-test-%')||' test_audio_left:'||(select count(*) from storage.objects where bucket_id='recordings' and name like '${uid}/%') as v`)[0].v
  console.log('cleanup ->', left)
}
