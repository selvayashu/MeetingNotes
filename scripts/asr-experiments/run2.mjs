// Experiment 2: Deepgram Nova-3 vs production Whisper on the SAME clips (Hindi, Tamil), with and without a language hint.
import { asr, clips, pct, pool, score } from './lib.mjs'

const N = Number(process.argv[2] ?? 8)
for (const L of [{ cfg: 'hi_in', hint: 'hi', name: 'Hindi' }, { cfg: 'ta_in', hint: 'ta', name: 'Tamil' }]) {
  const all = await clips(L.cfg, N)
  const minutes = all.reduce((s, c) => s + c.data.length, 0) / 32000 / 60
  console.log(`\n${L.name}: ${all.length} clips, ${minutes.toFixed(1)} min (nova-3 costs about ${Math.round(minutes * 473)} neurons per pass)`)
  for (const v of [
    { name: 'whisper turbo, hint', model: '', lang: L.hint },
    { name: 'nova-3, hint', model: '@cf/deepgram/nova-3', lang: L.hint },
  ]) {
    const rows = await pool(all, 2, async (c) => {
      const r = await asr(c.data, { lang: v.lang, model: v.model })
      return { ref: c.ref, hyp: r.text ?? '', err: r.ok === false ? r.error : null }
    })
    const bad = rows.filter((r) => r.err)
    const s = score(rows.filter((r) => !r.err))
    console.log(`  ${v.name.padEnd(24)} WER ${pct(s.wer).padStart(6)}  CER ${pct(s.cer).padStart(6)}${bad.length ? `   ${bad.length} failed: ${String(bad[0].err).slice(0, 160)}` : ''}`)
    if (v.model) console.log(`     sample -> ${rows.find((r) => r.hyp)?.hyp?.slice(0, 120) ?? '(empty)'}\n     ref    -> ${rows[0].ref.slice(0, 120)}`)
  }
}
