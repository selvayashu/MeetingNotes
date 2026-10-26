// Experiment 3 (free options): post-processing Whisper output.
//   A. Tamil: drop words in other scripts / mixed scripts (stray-script drift).
//   B. Hindi + Tamil: let the notes LLM fix obvious speech-recognition spelling errors (strictly: no rewording).
import fs from 'node:fs'
import { CACHE, asr, clips, llm, pct, pool, score } from './lib.mjs'

const N = Number(process.argv[2] ?? 12)
const hypFile = (h) => `${CACHE}/whisper-${h}.json`

// ---- A: script filter ----
const TAMIL = /\p{Script=Tamil}/u
const LATIN = /\p{Script=Latin}/u
const LETTER = /\p{L}/u
function dropStray(text, lang, keepLatin) {
  const own = lang === 'ta' ? TAMIL : /\p{Script=Devanagari}/u
  return text
    .split(/\s+/)
    .filter((w) => {
      const letters = [...w].filter((c) => LETTER.test(c))
      if (letters.length === 0) return true // numbers, punctuation
      const ownN = letters.filter((c) => own.test(c)).length
      const latinN = letters.filter((c) => LATIN.test(c)).length
      const otherN = letters.length - ownN - latinN
      if (otherN > 0) return false // Arabic, Cyrillic, CJK, Korean... or the other Indic script: never legitimate here
      if (ownN > 0 && latinN > 0) return false // one word mixing the two scripts is decoding drift
      if (latinN > 0 && !keepLatin) return false
      return true
    })
    .join(' ')
}

// ---- B: LLM correction ----
const SYS = (name) =>
  `You fix speech-recognition errors in ${name} text. The text is raw output from a speech recogniser and contains wrong or misspelled words. ` +
  'Correct ONLY words that are clearly misrecognised or misspelled, using the context. Keep the same words, order, meaning and script otherwise. ' +
  'Do not add, remove or reorder content, do not translate, do not summarise. Reply with the corrected text only, nothing else.'

for (const L of [{ cfg: 'hi_in', hint: 'hi', name: 'Hindi' }, { cfg: 'ta_in', hint: 'ta', name: 'Tamil' }]) {
  const all = await clips(L.cfg, N)
  let hyps
  if (fs.existsSync(hypFile(L.hint))) hyps = JSON.parse(fs.readFileSync(hypFile(L.hint), 'utf8'))
  else {
    hyps = await pool(all, 3, async (c) => (await asr(c.data, { lang: L.hint })).text ?? '')
    fs.writeFileSync(hypFile(L.hint), JSON.stringify(hyps))
  }
  const rows = (f) => all.map((c, i) => ({ ref: c.ref, hyp: f(hyps[i], i) }))
  const show = (name, s) => console.log(`  ${name.padEnd(46)} WER ${pct(s.wer).padStart(6)}  CER ${pct(s.cer).padStart(6)}`)
  console.log(`\n${L.name} (${all.length} clips)`)
  show('whisper turbo, as is', score(rows((h) => h)))
  show('drop foreign / mixed-script words (keep English)', score(rows((h) => dropStray(h, L.hint, true))))
  show('drop foreign / mixed-script AND all Latin words', score(rows((h) => dropStray(h, L.hint, false))))

  const fixed = await pool(hyps, 2, async (h) => {
    const r = await llm([{ role: 'system', content: SYS(L.name) }, { role: 'user', content: h }], undefined, 700)
    return r.ok ? r.text.trim() : h
  })
  show('LLM spelling correction (Llama 3.3 70B)', score(rows((_, i) => fixed[i])))
  show('LLM correction, then drop stray words', score(rows((_, i) => dropStray(fixed[i], L.hint, true))))
  const changed = fixed.filter((f, i) => f !== hyps[i]).length
  console.log(`  (LLM changed ${changed} of ${fixed.length} clips)`)
  const i = hyps.findIndex((h, k) => fixed[k] !== h)
  if (i >= 0) console.log(`  e.g. ref    : ${all[i].ref.slice(0, 110)}\n       whisper: ${hyps[i].slice(0, 110)}\n       llm    : ${fixed[i].slice(0, 110)}`)
}
