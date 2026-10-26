// Experiment 1: which speech models are better for Hindi and Tamil? Same 12 clips per language, with a language hint.
import fs from 'node:fs'
import { CACHE, asr, clips, pct, pool, score } from './lib.mjs'

const N = Number(process.argv[2] ?? 12)
const only = process.argv[3] ?? 'hi,ta'
const variants = [
  { name: 'turbo (production)', model: '' },
  { name: 'turbo (production) again', model: '' },
  { name: 'whisper (older, auto-detect only)', model: '@cf/openai/whisper', noLang: true },
  { name: 'deepgram nova-3', model: '@cf/deepgram/nova-3', n: 6 },
]
const out = {}
for (const L of [{ cfg: 'hi_in', hint: 'hi', name: 'Hindi' }, { cfg: 'ta_in', hint: 'ta', name: 'Tamil' }].filter((l) => only.split(',').includes(l.hint))) {
  const all = await clips(L.cfg, N)
  const minutes = all.reduce((s, c) => s + c.data.length, 0) / 32000 / 60
  console.log(`\n${L.name}: ${all.length} clips, ${minutes.toFixed(1)} min`)
  for (const v of variants) {
    const use = all.slice(0, v.n ?? all.length)
    const rows = await pool(use, 3, async (c) => {
      const r = await asr(c.data, { lang: v.noLang ? '' : L.hint, model: v.model })
      return { ref: c.ref, hyp: r.text ?? '', err: r.ok === false ? r.error : null, lang: r.info?.language }
    })
    const errs = rows.filter((r) => r.err)
    const s = score(rows.filter((r) => !r.err))
    console.log(`  ${v.name.padEnd(38)} WER ${pct(s.wer).padStart(6)}  CER ${pct(s.cer).padStart(6)}  (${use.length} clips${errs.length ? `, ${errs.length} failed: ${String(errs[0].err).slice(0, 140)}` : ''})`)
    out[`${L.hint}:${v.name}`] = { wer: s.wer, cer: s.cer, n: use.length, sample: rows[0] }
  }
}
fs.writeFileSync(CACHE + '/run1.json', JSON.stringify(out, null, 1))
