// Live check of the deployed Hindi clean-up with real Hindi (and Tamil) speech from FLEURS.
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { clips, concatWav, pct, score } from './lib.mjs'

const vars = Object.fromEntries(fs.readFileSync('D:/Meeting Notes/.dev.vars', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]))
const pub = Object.fromEntries(fs.readFileSync('D:/Meeting Notes/.env.production', 'utf8').split(/\r?\n/).filter((l) => /^VITE_/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]))
const SB = vars.SUPABASE_URL, SVC = vars.SUPABASE_SERVICE_ROLE_KEY
const PUB = Object.values(pub).find((v) => v.startsWith('sb_publishable_') || v.startsWith('eyJ'))
const rest = async (path, { method = 'GET', body, raw } = {}) => {
  const res = await fetch(SB + path, { method, headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': raw ? 'audio/wav' : 'application/json', Prefer: 'return=minimal' }, body: raw ? body : body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}
const sql = (q) => { const out = execSync(`npx supabase db query --linked "${q.replace(/"/g, '\\"')}"`, { cwd: 'D:/Meeting Notes', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows }
let fails = 0
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) fails++ }
const tag = Math.random().toString(36).slice(2, 8)
const email = `meetnotes-test-hi-${tag}@example.com`, password = 'Tmp-' + tag + '-5Qw'
let uid
const objs = []
try {
  uid = (await rest('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } })).json.id
  sql(`update public.profiles set status='approved' where id='${uid}'`)
  const tok = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token

  async function run(label, cfg, meetingLang, n) {
    const c = await clips(cfg, n)
    const wav = concatWav(c.map((x) => x.data))
    const mid = crypto.randomUUID()
    const path = `${uid}/${mid}/000.wav`
    await rest(`/storage/v1/object/recordings/${path}`, { method: 'POST', raw: true, body: wav })
    objs.push(path)
    await rest('/rest/v1/meetings', { method: 'POST', body: { id: mid, user_id: uid, title: label, language: meetingLang, audio_path: path, audio_parts: [{ path, duration_seconds: Math.round(wav.length / 32000), mime: 'audio/wav' }] } })
    for (let i = 0; i < 12; i++) {
      const r = await fetch('https://meetnotes.pages.dev/api/process-meeting', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ meetingId: mid }) })
      const b = await r.json().catch(() => ({}))
      if (!r.ok && r.status !== 202) throw new Error(`${label}: ${r.status} ${JSON.stringify(b)}`)
      if (b.done) break
      await new Promise((x) => setTimeout(x, 2000))
    }
    const segs = sql(`select text, asr_text from public.transcript_segments where meeting_id='${mid}' order by start_ms`)
    const ref = c.map((x) => x.ref).join(' ')
    return { segs, ref, mid, n: c.length, seconds: wav.length / 32000 }
  }

  const hi = await run('hindi, language chosen', 'hi_in', 'hi', 5)
  const raw = hi.segs.map((s) => s.asr_text ?? s.text).join(' ')
  const fixed = hi.segs.map((s) => s.text).join(' ')
  const sRaw = score([{ ref: hi.ref, hyp: raw }]), sFix = score([{ ref: hi.ref, hyp: fixed }])
  console.log(`   Hindi (${hi.n} clips, ${hi.seconds.toFixed(0)} s): Whisper WER ${pct(sRaw.wer)} CER ${pct(sRaw.cer)}  ->  after clean-up WER ${pct(sFix.wer)} CER ${pct(sFix.cer)}   (${hi.segs.filter((s) => s.asr_text).length} of ${hi.segs.length} lines changed)`)
  ok('some lines were corrected and Whisper\'s original kept for them', hi.segs.some((s) => s.asr_text && s.asr_text !== s.text))
  ok('the clean-up did not make Hindi worse (word errors not higher)', sFix.wer <= sRaw.wer + 0.01, `${pct(sRaw.wer)} -> ${pct(sFix.wer)}`)
  const usage = sql(`select kind, model, round(sum(neurons)::numeric,1) n, bool_or(estimated) est from public.ai_usage where meeting_id='${hi.mid}' group by kind, model`)
  console.log('   usage:', JSON.stringify(usage))
  ok('the extra AI use is recorded (speech + text rows)', usage.some((u) => u.kind === 'transcribe') && usage.some((u) => u.kind === 'notes'))

  const auto = await run('hindi, auto-detect', 'hi_in', 'auto', 3)
  ok('auto-detected Hindi is cleaned up too', auto.segs.some((s) => s.asr_text), `${auto.segs.length} lines, none changed`)

  const ta = await run('tamil', 'ta_in', 'ta', 3)
  ok('Tamil is left exactly as Whisper wrote it', ta.segs.length > 0 && ta.segs.every((s) => s.asr_text === null))

  const note = sql(`select count(*)::int n from public.meeting_notes where meeting_id='${hi.mid}'`)[0].n
  ok('notes were still produced for the Hindi meeting', note === 1)
} catch (e) {
  ok('test ran without an exception', false, e.stack || e.message)
} finally {
  if (objs.length) await fetch(`${SB}/storage/v1/object/recordings`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: objs }) })
  if (uid) {
    await rest(`/rest/v1/ai_usage?user_id=eq.${uid}`, { method: 'DELETE' })
    await rest(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' })
  }
  console.log('cleanup ->', sql(`select 'test_users_left:'||(select count(*) from auth.users where email like 'meetnotes-test-%')||' stray_usage:'||(select count(*) from public.ai_usage where user_id is null and meeting_id is not null and created_at > now() - interval '1 hour') as v`)[0].v)
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
