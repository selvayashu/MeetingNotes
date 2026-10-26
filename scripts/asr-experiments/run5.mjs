// Experiment 5: does the spelling correction generalise to text the model cannot have memorised?
// Meeting-style Hindi sentences written for this test (including English words mixed in, as real meetings have),
// damaged with typical Whisper-style spelling errors, then corrected. Also checks it leaves clean text alone.
import { llm, pct, pool, score } from './lib.mjs'

const CLEAN = [
  'आज की बैठक में हमने नई वेबसाइट को शुक्रवार को लॉन्च करने का फ़ैसला किया।',
  'प्रिया प्रेस विज्ञप्ति बुधवार तक तैयार करेंगी।',
  'राहुल, कृपया सोमवार तक फ़ाइनेंस टीम से बजट की पुष्टि कर लें।',
  'ग्राहक ने बताया कि उन्हें डिलीवरी में देरी की शिकायत है।',
  'हमें अगले सप्ताह तक सभी बग ठीक करने होंगे ताकि रिलीज़ समय पर हो सके।',
  'मीरा ने सुझाव दिया कि हम पहले छोटे समूह के साथ परीक्षण करें।',
  'सपोर्ट टीम के लिए नई भर्ती अगले महीने शुरू होगी।',
  'क्या हम इस प्रस्ताव को मंज़ूरी देने के लिए तैयार हैं?',
  'मार्केटिंग का बजट पिछली तिमाही से बीस प्रतिशत अधिक है।',
  'यह प्रोजेक्ट डेडलाइन तक पूरा हो जाना चाहिए, वरना client नाराज़ हो जाएगा।',
  'मैं कल सुबह दस बजे Zoom पर सबको इनवाइट भेज दूँगा।',
  'सर्वर की लागत कम करने के लिए हमें क्लाउड प्लान बदलना पड़ेगा।',
  'टीम ने तय किया कि हर शुक्रवार को stand-up मीटिंग होगी।',
  'अभी तक तीन सौ पचास ग्राहकों ने साइन अप किया है।',
  'डिज़ाइन का पहला ड्राफ़्ट अगले मंगलवार को शेयर किया जाएगा।',
  'धन्यवाद सभी का, बैठक यहीं समाप्त होती है।',
]

// small seeded generator so every model sees the same damage
let seed = 7
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const SWAPS = { 'ि': 'ी', 'ी': 'ि', 'ु': 'ू', 'ू': 'ु', 'ट': 'त', 'ड': 'द', 'ण': 'न', 'श': 'स', 'ं': '', '़': '', 'ृ': 'ि', 'ै': 'े' }
const damage = (s) =>
  [...s]
    .map((c) => (c in SWAPS && rnd() < 0.3 ? SWAPS[c] : c))
    .join('')
    .replace(/ /g, () => (rnd() < 0.04 ? '' : ' '))
const NOISY = CLEAN.map(damage)

const SYS =
  'You fix speech-recognition errors in Hindi text. The text is raw output from a speech recogniser and contains wrong or misspelled words. ' +
  'Correct ONLY words that are clearly misrecognised or misspelled, using the context. Keep the same words, order, meaning and script otherwise. ' +
  'Keep names, numbers and English words as they are. Do not add, remove or reorder content, do not translate, do not summarise. Reply with the corrected text only, nothing else.'

const strip = (s) => s.replace(/[।?,]/g, ' ')
const rows = (hyps) => CLEAN.map((c, i) => ({ ref: strip(c), hyp: strip(hyps[i]) }))
const base = score(rows(NOISY))
console.log(`damaged text vs original: WER ${pct(base.wer)}  CER ${pct(base.cer)}   (${CLEAN.length} sentences)`)
for (const id of ['@cf/meta/llama-3.1-8b-instruct-fp8', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']) {
  const fix = (t) => llm([{ role: 'system', content: SYS }, { role: 'user', content: t }], id, 400).then((r) => (r.ok ? r.text.trim() : t))
  const fixed = await pool(NOISY, 2, fix)
  const clean = await pool(CLEAN, 2, fix)
  const s = score(rows(fixed)), d = score(rows(clean))
  console.log(`${id.replace('@cf/', '').padEnd(42)} repaired -> WER ${pct(s.wer)} CER ${pct(s.cer)}    clean text changed by ${pct(d.wer)}`)
  const hl = [9, 10, 12].map((i) => `    ${CLEAN[i]}\n    damaged: ${NOISY[i]}\n    fixed:   ${fixed[i]}`).join('\n')
  console.log(hl)
}
