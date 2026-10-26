// Experiment 4: which model should do the spelling correction (quality, cost), and does it leave correct text alone?
import fs from 'node:fs'
import { CACHE, clips, llm, pct, pool, score } from './lib.mjs'

const N = 12
const MODELS = [
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', inN: 0.026668, outN: 0.204805 },
  { id: '@cf/google/gemma-3-12b-it', inN: 0.031371, outN: 0.050505 },
  { id: '@cf/meta/llama-3.1-8b-instruct-fp8', inN: 0.004119, outN: 0.034868 },
]
const SYS = (name) =>
  `You fix speech-recognition errors in ${name} text. The text is raw output from a speech recogniser and contains wrong or misspelled words. ` +
  'Correct ONLY words that are clearly misrecognised or misspelled, using the context. Keep the same words, order, meaning and script otherwise. ' +
  'Keep names, numbers and English words as they are. Do not add, remove or reorder content, do not translate, do not summarise. Reply with the corrected text only, nothing else.'

const results = {}
for (const L of [{ cfg: 'hi_in', hint: 'hi', name: 'Hindi' }, { cfg: 'ta_in', hint: 'ta', name: 'Tamil' }]) {
  const all = await clips(L.cfg, N)
  const hyps = JSON.parse(fs.readFileSync(`${CACHE}/whisper-${L.hint}.json`, 'utf8'))
  console.log(`\n${L.name}`)
  console.log(`  ${'whisper as is'.padEnd(44)} ${(() => { const s = score(all.map((c, i) => ({ ref: c.ref, hyp: hyps[i] }))); return `WER ${pct(s.wer)}  CER ${pct(s.cer)}` })()}`)
  for (const m of MODELS) {
    let tin = 0, tout = 0, fails = 0
    const call = async (text) => {
      const r = await llm([{ role: 'system', content: SYS(L.name) }, { role: 'user', content: text }], m.id, 800)
      if (!r.ok) { fails++; return text }
      tin += r.usage?.prompt_tokens ?? 0
      tout += r.usage?.completion_tokens ?? 0
      return r.text.trim() || text
    }
    const fixed = await pool(hyps, 2, call)
    const s = score(all.map((c, i) => ({ ref: c.ref, hyp: fixed[i] })))
    // fidelity: give it the CORRECT text; a careful corrector changes (almost) nothing
    const before = { tin, tout }
    const refs = await pool(all, 2, (c) => call(c.ref))
    const drift = score(all.map((c, i) => ({ ref: c.ref, hyp: refs[i] })))
    const neurons = (before.tin * m.inN + before.tout * m.outN) / all.length
    results[`${L.hint}:${m.id}`] = { wer: s.wer, cer: s.cer, drift: drift.wer }
    console.log(`  ${m.id.replace('@cf/', '').padEnd(44)} WER ${pct(s.wer).padStart(6)}  CER ${pct(s.cer).padStart(6)}   changes correct text by ${pct(drift.wer)}   ~${neurons.toFixed(0)} neurons per clip${fails ? `   (${fails} failed calls)` : ''}`)
  }
}
fs.writeFileSync(CACHE + '/run4.json', JSON.stringify(results, null, 1))
