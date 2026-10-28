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

const rest = async (path, { method = 'GET', token, body, key } = {}) => {
  const k = key ?? ANON
  const res = await fetch(SB + path, { method, headers: { apikey: k, Authorization: `Bearer ${token ?? k}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}
const sql = (q) => {
  const out = execSync(`npx supabase db query --linked "${q.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows
}
const api = async (token, body) => {
  const r = await fetch(SITE + '/api/process-meeting', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
let fails = 0
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) fails++ }

const tag = Math.random().toString(36).slice(2, 8)
const pw = 'Tmp-' + tag + '-8Qx'
const created = []
const mkUser = async (label) => {
  const email = `meetnotes-test-${label}-${tag}@example.com`
  const c = await rest('/auth/v1/admin/users', { method: 'POST', key: SVC, body: { email, password: pw, email_confirm: true } })
  created.push(c.json.id)
  sql(`update public.profiles set status='approved' where id='${c.json.id}'`)
  const t = await rest('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: pw } })
  return { id: c.json.id, token: t.json.access_token }
}

try {
  const owner = await mkUser('owner'), other = await mkUser('other')

  // A finished meeting whose AUDIO IS ALREADY GONE (audio_parts empty, 1 part was transcribed), notes written an hour ago.
  const mid = crypto.randomUUID()
  await rest('/rest/v1/meetings', { method: 'POST', key: SVC, body: { id: mid, user_id: owner.id, title: 'edit test', language: 'en', notes_language: 'en', status: 'done', audio_parts: [], processed_parts: 1, processing_started_at: new Date().toISOString(), meeting_date: '2026-10-21T10:00:00Z' } })
  const lines = [
    [0, 'Good morning everyone, thanks for joining.'],
    [6000, 'We decided to launch the new website on Fryday.'],
    [12000, 'Prya will prepare the press release by Wednesday.'],
  ]
  const segRes = await rest('/rest/v1/transcript_segments', { method: 'POST', key: SVC, body: lines.map(([ms, text]) => ({ meeting_id: mid, start_ms: ms, end_ms: ms + 5000, text })) })
  const [s0, s1, s2] = segRes.json
  await rest('/rest/v1/meeting_notes', { method: 'POST', key: SVC, body: { meeting_id: mid, summary: 'OLD SUMMARY', decisions: ['OLD DECISION'], generated_at: new Date(Date.now() - 3600_000).toISOString() } })
  await rest('/rest/v1/action_items', { method: 'POST', key: SVC, body: { meeting_id: mid, task: 'OLD ACTION ITEM' } })

  // ---- editing as the owner
  let r = await rest(`/rest/v1/transcript_segments?id=eq.${s1.id}`, { method: 'PATCH', token: owner.token, body: { text: 'We decided to launch the new website on Saturday.' } })
  ok('owner can edit a line', r.status === 200 && r.json[0]?.text.includes('Saturday'), `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`)
  ok('Whisper\'s original is kept automatically', r.json[0]?.original_text === 'We decided to launch the new website on Fryday.' && !!r.json[0]?.edited_at, JSON.stringify(r.json[0]))
  r = await rest(`/rest/v1/transcript_segments?id=eq.${s2.id}`, { method: 'PATCH', token: owner.token, body: { text: 'Priya will prepare the press release by Wednesday.' } })
  ok('a second line can be fixed', r.status === 200)

  // ---- cheating attempts
  r = await rest(`/rest/v1/transcript_segments?id=eq.${s1.id}`, { method: 'PATCH', token: owner.token, body: { original_text: 'forged' } })
  ok('cannot forge original_text', r.status >= 400, `${r.status}`)
  r = await rest(`/rest/v1/transcript_segments?id=eq.${s1.id}`, { method: 'PATCH', token: owner.token, body: { start_ms: 0 } })
  ok('cannot move a line in time', r.status >= 400, `${r.status}`)
  r = await rest(`/rest/v1/transcript_segments?id=eq.${s1.id}`, { method: 'PATCH', token: owner.token, body: { text: '   ' } })
  ok('cannot blank a line', r.status >= 400, `${r.status}`)
  r = await rest(`/rest/v1/transcript_segments?id=eq.${s0.id}`, { method: 'PATCH', token: other.token, body: { text: 'vandalised' } })
  const still = sql(`select text from public.transcript_segments where id='${s0.id}'`)[0].text
  ok("another user cannot edit someone else's transcript", still === lines[0][1], `${r.status} text=${still}`)
  r = await rest(`/rest/v1/meeting_notes?meeting_id=eq.${mid}`, { method: 'PATCH', token: owner.token, body: { generated_at: new Date().toISOString() } })
  ok('cannot fake the notes timestamp (to hide the stale banner)', r.status >= 400, `${r.status}`)

  // ---- restore original works
  r = await rest(`/rest/v1/transcript_segments?id=eq.${s2.id}`, { method: 'PATCH', token: owner.token, body: { text: 'Prya will prepare the press release by Wednesday.' } })
  ok('restoring Whisper\'s text clears the edited state', r.json[0]?.original_text === null && r.json[0]?.edited_at === null, JSON.stringify(r.json[0]))
  await rest(`/rest/v1/transcript_segments?id=eq.${s2.id}`, { method: 'PATCH', token: owner.token, body: { text: 'Priya will prepare the press release by Wednesday.' } })

  // ---- regenerate the notes from the edited transcript (no audio exists)
  r = await api(other.token, { meetingId: mid, regenerate: true })
  ok("another user cannot regenerate someone else's notes", r.status === 404, `${r.status}`)
  let res = await api(owner.token, { meetingId: mid, regenerate: true })
  ok('regenerate accepted for a finished meeting without audio', res.status === 200 || res.status === 202, `${res.status} ${JSON.stringify(res.json)}`)
  for (let i = 0; i < 30 && !res.json.done; i++) { await new Promise((r) => setTimeout(r, 4000)); res = await api(owner.token, { meetingId: mid }) }
  ok('regeneration finished', res.json.done === true, JSON.stringify(res.json))

  const notes = sql(`select summary, decisions::text as decisions, generated_at > now() - interval '5 minutes' as fresh from public.meeting_notes where meeting_id='${mid}'`)[0]
  const items = sql(`select task, owner from public.action_items where meeting_id='${mid}' order by task`)
  console.log('   new summary:', JSON.stringify(notes.summary).slice(0, 220))
  console.log('   decisions  :', notes.decisions, '| action items:', JSON.stringify(items))
  ok('notes were rewritten (old text gone)', !/OLD/.test(notes.summary + notes.decisions) && !items.some((i) => /OLD/.test(i.task)))
  ok('the correction flows into the new notes (Saturday, not Fryday/Friday)', /saturday/i.test(notes.summary + notes.decisions) && !/fryday/i.test(notes.summary + notes.decisions), notes.summary)
  ok('the name fix flows through (Priya)', /priya/i.test(notes.summary + JSON.stringify(items)))
  ok('generated_at was refreshed', notes.fresh === true)
  ok('meeting is done again, and its audio fields are untouched', sql(`select status='done' and audio_parts='[]'::jsonb as ok from public.meetings where id='${mid}'`)[0].ok === true)

  // ---- cooldown
  r = await api(owner.token, { meetingId: mid, regenerate: true })
  ok('an immediate second regenerate is refused (cooldown)', r.status === 429, `${r.status} ${JSON.stringify(r.json)}`)
  // ---- a normal (non-regenerate) call on a done meeting is a harmless no-op
  r = await api(owner.token, { meetingId: mid })
  ok('a plain call on a finished meeting does not regenerate anything', r.status === 200 && r.json.done === true)
} catch (e) {
  ok('test ran without an exception', false, e.stack || e.message)
} finally {
  for (const id of created) await rest(`/auth/v1/admin/users/${id}`, { method: 'DELETE', key: SVC })
  const left = sql(`select 'users:'||(select count(*) from auth.users)||' meetings:'||(select count(*) from public.meetings)||' segments_for_tests:'||(select count(*) from public.transcript_segments where text like '%press release by Wednesday.%' and meeting_id not in (select id from public.meetings))||' test_users_left:'||(select count(*) from auth.users where email like 'meetnotes-test-%') as v`)[0].v
  console.log('cleanup ->', left)
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
