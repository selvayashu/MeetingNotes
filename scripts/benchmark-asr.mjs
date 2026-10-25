#!/usr/bin/env node
// Measures Whisper accuracy on real speech: Google FLEURS (CC-BY 4.0) test clips for Hindi, Tamil and English.
//
//   cd scripts/asr-bench && npx wrangler dev --remote --port 8799      (terminal 1; uses your Workers AI allowance)
//   node scripts/benchmark-asr.mjs [--clips 20] [--megabytes 12] [--write docs/accuracy.md]   (terminal 2)
//
// Only the first few MB of each archive are downloaded (HTTP Range). FLEURS is read speech from native speakers,
// so real meetings (crosstalk, noise, code-switching) will score worse than these numbers.
import zlib from 'node:zlib'
import fs from 'node:fs'

const arg = (name, d) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : d }
const CLIPS = Number(arg('clips', 20))
const MB = Number(arg('megabytes', 12))
const ENDPOINT = arg('endpoint', 'http://127.0.0.1:8799')
const WRITE = arg('write', '')
// Experiments: --opts '{"vad_filter":false}' adds Whisper options; --langs hi,ta limits languages; --quick skips auto-detect and silence.
const OPTS = arg('opts', '')
const ONLY = arg('langs', '')
const QUICK = process.argv.includes('--quick')
const BASE = 'https://huggingface.co/datasets/google/fleurs/resolve/main/data'
const LANGS = [
  { cfg: 'hi_in', hint: 'hi', name: 'Hindi' },
  { cfg: 'ta_in', hint: 'ta', name: 'Tamil' },
  { cfg: 'en_us', hint: 'en', name: 'English' },
]

// ---------- text metrics ----------
// Same normalisation for reference and hypothesis: NFKC, lower-case, punctuation/symbols (incl. the Hindi danda) -> space.
export const normalize = (s) =>
  s.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/g, ' ').trim()

export function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}
const words = (s) => (s ? s.split(' ') : [])
const chars = (s) => Array.from(s.replace(/ /g, ''))

// ---------- data ----------
async function getTsv(cfg) {
  const text = await (await fetch(`${BASE}/${cfg}/test.tsv`)).text()
  const map = new Map()
  for (const line of text.split('\n')) {
    const c = line.split('\t')
    if (c.length >= 4) map.set(c[1], { raw: c[2], ref: c[3] }) // file name -> raw / normalised transcript
  }
  return map
}

function untar(buf, max) {
  const out = []
  let off = 0
  while (off + 512 <= buf.length && out.length < max) {
    const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/, '')
    if (!name) break
    const size = parseInt(buf.toString('ascii', off + 124, off + 136).replace(/\0.*$/, '').trim() || '0', 8)
    const start = off + 512
    if (start + size > buf.length) break // truncated by the Range request: ignore the partial last file
    if (buf[off + 156] === 0x30 || buf[off + 156] === 0) out.push({ name: name.split('/').pop(), data: buf.subarray(start, start + size) })
    off = start + Math.ceil(size / 512) * 512
  }
  return out
}

async function getClips(cfg, tsv) {
  const res = await fetch(`${BASE}/${cfg}/audio/test.tar.gz`, { headers: { Range: `bytes=0-${MB * 1024 * 1024 - 1}` } })
  const gz = Buffer.from(await res.arrayBuffer())
  // Z_SYNC_FLUSH lets zlib return what it decoded from a truncated stream instead of throwing.
  const tar = zlib.gunzipSync(gz, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
  return untar(tar, CLIPS * 3)
    .filter((f) => f.name.endsWith('.wav') && tsv.has(f.name))
    .slice(0, CLIPS)
    .map((f) => ({ ...f, ...tsv.get(f.name) }))
}

// ---------- Whisper via the local worker ----------
async function transcribe(wav, lang) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${ENDPOINT}/${lang ? `?lang=${lang}` : ''}`, { method: 'POST', body: wav, headers: OPTS ? { 'x-opts': encodeURIComponent(OPTS) } : {} })
      const j = await r.json()
      if (j.ok) return j
      if (String(j.error).includes('3030')) return j
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
  }
  return { ok: false, text: '', info: null }
}

async function pool(items, n, fn) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i) } }))
  return results
}

function silenceWav(seconds, noise = 0) {
  const n = 16000 * seconds
  const pcm = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round((Math.random() * 2 - 1) * noise), i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

const pct = (x) => (x * 100).toFixed(1) + '%'
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN }

function score(rows, key) {
  let we = 0, wn = 0, ce = 0, cn = 0
  const perClip = []
  for (const r of rows) {
    const ref = normalize(r.ref), hyp = normalize(r[key])
    const w = editDistance(words(ref), words(hyp)), c = editDistance(chars(ref), chars(hyp))
    we += w; wn += words(ref).length; ce += c; cn += chars(ref).length
    perClip.push(w / Math.max(1, words(ref).length))
  }
  return { wer: we / wn, cer: ce / cn, medianWer: median(perClip), perClip }
}

// ---------- run ----------
const report = { generated: new Date().toISOString(), clips: CLIPS, langs: [], silence: [] }
console.log(`Whisper accuracy on FLEURS test clips (${CLIPS} per language) via ${ENDPOINT}\n`)

for (const L of LANGS.filter((l) => !ONLY || ONLY.split(',').includes(l.hint))) {
  process.stdout.write(`${L.name}: fetching clips… `)
  const tsv = await getTsv(L.cfg)
  const clips = await getClips(L.cfg, tsv)
  console.log(`${clips.length} clips (${(clips.reduce((s, c) => s + c.data.length, 0) / 32000 / 60).toFixed(1)} min of audio)`)
  if (clips.length === 0) { console.log('  no clips extracted; try --megabytes 20'); continue }

  const hinted = await pool(clips, 3, async (c) => ({ ...c, hyp: (await transcribe(c.data, L.hint)).text ?? '' }))
  const auto = QUICK ? [] : await pool(clips, 3, async (c) => { const r = await transcribe(c.data, ''); return { ...c, hyp: r.text ?? '', detected: r.info?.language ?? '?', prob: r.info?.language_probability ?? 0 } })

  const sH = score(hinted, 'hyp'), sA = QUICK ? { wer: NaN, cer: NaN, medianWer: NaN, perClip: [] } : score(auto, 'hyp')
  const detectedOk = QUICK ? NaN : auto.filter((r) => r.detected === L.hint).length / auto.length
  const worst = hinted.map((r, i) => ({ r, w: sH.perClip[i] })).sort((a, b) => b.w - a.w).slice(0, 2)
  report.langs.push({ ...L, n: clips.length, minutes: clips.reduce((s, c) => s + c.data.length, 0) / 32000 / 60, hinted: sH, auto: sA, detectedOk, worst: worst.map(({ r, w }) => ({ wer: w, ref: r.raw, hyp: r.hyp })) })
  console.log(`  with language hint : WER ${pct(sH.wer)}  CER ${pct(sH.cer)}  median clip WER ${pct(sH.medianWer)}`)
  if (!QUICK) console.log(`  auto-detect        : WER ${pct(sA.wer)}  CER ${pct(sA.cer)}  language detected correctly ${pct(detectedOk)}`)
}

// Hallucination check: silence and faint noise should produce no text, even when the language is forced.
for (const [label, wav] of QUICK ? [] : [['10 s of silence', silenceWav(10)], ['10 s of faint noise', silenceWav(10, 300)]]) {
  for (const hint of ['hi', 'ta', '']) {
    const r = await transcribe(wav, hint)
    const text = (r.text ?? '').trim()
    report.silence.push({ label, hint: hint || 'auto', text })
    console.log(`  ${label} (${hint || 'auto'}): ${text ? 'TEXT -> ' + JSON.stringify(text.slice(0, 80)) : 'empty (good)'}`)
  }
}

if (WRITE) {
  const rows = report.langs.map((l) => `| ${l.name} | ${l.n} (${l.minutes.toFixed(1)} min) | ${pct(l.hinted.wer)} | ${pct(l.hinted.cer)} | ${pct(l.hinted.medianWer)} | ${pct(l.auto.wer)} | ${pct(l.detectedOk)} |`).join('\n')
  const hall = report.silence.map((s) => `| ${s.label} | ${s.hint} | ${s.text ? '`' + s.text.slice(0, 60).replace(/\|/g, '/') + '`' : 'empty'} |`).join('\n')
  const ex = report.langs.map((l) => l.worst.map((w) => `- **${l.name}** (clip WER ${pct(w.wer)})\n  - reference: ${w.ref}\n  - Whisper:   ${w.hyp}`).join('\n')).join('\n')
  fs.writeFileSync(WRITE, `# Speech-to-text accuracy (measured ${report.generated.slice(0, 10)})

Model \`@cf/openai/whisper-large-v3-turbo\` with the production options (\`vad_filter: true\`, \`condition_on_previous_text: false\`),
on ${CLIPS} test clips per language from [Google FLEURS](https://huggingface.co/datasets/google/fleurs) (CC-BY 4.0).
Reproduce: \`scripts/benchmark-asr.mjs\`.

| Language | Clips | WER (hint) | CER (hint) | Median clip WER | WER (auto-detect) | Language auto-detected |
|---|---|---|---|---|---|---|
${rows}

WER = word error rate, CER = character error rate (lower is better). Both texts are lower-cased and stripped of punctuation first.
"hint" is what the app does when you pick a spoken language; "auto-detect" is the default **Auto-detect** option.

## Hallucination check (no speech in the audio)

| Audio | Language setting | Output |
|---|---|---|
${hall}

## Worst clips with a language hint

${ex}

## How to read this
- FLEURS is clean read speech by native speakers. **Real meetings (several voices, noise, interruptions, Hindi-English or Tamil-English mixing) will be worse**; treat these numbers as a best case.
- Tamil is agglutinative, so word error rate looks harsher than character error rate; judge it by CER.
- Code-switched (Hinglish/Tanglish) speech is **not** measured here. Test it with a few real recordings before promising it.
`)
  console.log('\nwrote ' + WRITE)
}
