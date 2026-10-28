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
const rest = async (path, { method = 'GET', body, key = SVC, bearer = SVC } = {}) => {
  const res = await fetch(SB + path, { method, headers: { apikey: key, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}
const sql = (q) => { const out = execSync(`npx supabase db query --linked "${q.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows }
let fails = 0
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) fails++ }
const tag = Math.random().toString(36).slice(2, 8)
const email = `meetnotes-test-tpl-${tag}@example.com`, password = 'Tmp-' + tag + '-5Qw'
const lines = [
  'Okay, quick round. Priya, you first.',
  'Yesterday I finished the login page fixes. Today I will start on the password reset emails. No blockers.',
  'Rahul, your turn.',
  'I was working on the invoice export. I am blocked because I still do not have the sample data from the finance team. I will ask them again this afternoon.',
  'Meera here. I reviewed two pull requests yesterday and today I will pair with Rahul on the export. No blockers either.',
  'Great, so Rahul chases finance today and we all meet again tomorrow at the same time.',
]
let uid, mid
try {
  const c = await rest('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } })
  uid = c.json.id
  sql(`update public.profiles set status='approved' where id='${uid}'`)
  mid = crypto.randomUUID()
  const old = new Date(Date.now() - 600_000).toISOString()
  await rest('/rest/v1/meetings', { method: 'POST', body: { id: mid, user_id: uid, title: 'tpl test', language: 'en', status: 'done', processed_parts: 1, audio_parts: [], template: 'general' } })
  await rest('/rest/v1/transcript_segments', { method: 'POST', body: lines.map((text, i) => ({ meeting_id: mid, start_ms: i * 10000, end_ms: i * 10000 + 9000, text })) })
  await rest('/rest/v1/meeting_notes', { method: 'POST', body: { meeting_id: mid, summary: 'old', decisions: [], generated_at: old } })
  const tok = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token

  // the owner can switch the type through the same path the app uses
  const sw = await rest(`/rest/v1/meetings?id=eq.${mid}`, { method: 'PATCH', key: PUB, bearer: tok, body: { template: 'standup' } })
  ok('owner can change the type as a normal user', sw.status === 204 || sw.status === 200, JSON.stringify(sw))
  const bad = await rest(`/rest/v1/meetings?id=eq.${mid}`, { method: 'PATCH', key: PUB, bearer: tok, body: { template: 'nonsense' } })
  ok('an invalid type is rejected', bad.status >= 400)

  const regen = async () => {
    for (let i = 0; i < 8; i++) {
      const r = await fetch(APP + '/api/process-meeting', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ meetingId: mid, regenerate: true }) })
      const b = await r.json().catch(() => ({}))
      if (r.status === 429) { await new Promise((x) => setTimeout(x, 31000)); continue }
      if (!r.ok && r.status !== 202) throw new Error(`regenerate ${r.status}: ${JSON.stringify(b)}`)
      if (b.done) return b
    }
    throw new Error('did not finish')
  }
  const notes = () => sql(`select summary, notes_template, decisions, (select string_agg(task||' ['||coalesce(owner,'-')||']', ' | ') from public.action_items where meeting_id='${mid}') as items from public.meeting_notes where meeting_id='${mid}'`)[0]

  await regen()
  let n = notes()
  console.log('\n--- STAND-UP ---\n', n.summary, '\nitems:', n.items, '\n')
  ok('notes record that they were written as a stand-up', n.notes_template === 'standup', n.notes_template)
  ok('the stand-up summary names the people', /Priya/.test(n.summary) && /Rahul/.test(n.summary) && /Meera/.test(n.summary))
  ok('the blocker is mentioned', /financ|sample data|block/i.test(n.summary + n.items))

  await rest(`/rest/v1/meetings?id=eq.${mid}`, { method: 'PATCH', key: PUB, bearer: tok, body: { template: 'general' } })
  await new Promise((x) => setTimeout(x, 31000))
  await regen()
  n = notes()
  console.log('--- GENERAL ---\n', n.summary, '\nitems:', n.items, '\n')
  ok('and as general after switching back', n.notes_template === 'general', n.notes_template)
} catch (e) {
  ok('test ran without an exception', false, e.stack || e.message)
} finally {
  if (uid) await rest(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' })
  if (mid) await rest(`/rest/v1/ai_usage?meeting_id=eq.${mid}`, { method: 'DELETE' })
  console.log('cleanup ->', sql(`select 'test_users_left:'||(select count(*) from auth.users where email like 'meetnotes-test-%')||' meetings:'||(select count(*) from public.meetings) as v`)[0].v)
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
