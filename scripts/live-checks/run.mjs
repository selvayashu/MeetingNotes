// Runs the live end-to-end checks against the deployed site and Supabase project, one script at a time.
//
//   npm run live                      the quick set (about 12 minutes)
//   npm run live -- delete retention  just these
//   npm run live -- all               everything, including the slow background-processing check
//
// Each script creates throw-away users named meetnotes-test-*@example.com and removes them (and their files and usage rows)
// when it finishes. Needs .dev.vars (service key, never commit it) and .env.production, and `npx supabase link` already done.
import { spawn } from 'node:child_process'
import path from 'node:path'

const QUICK = [
  ['approval', 'sign-up approval, admin-only functions'],
  ['password', 'password sign-in and reset rules'],
  ['consent', 'recording-consent audit trail'],
  ['edit', 'transcript editing and regenerating notes'],
  ['template', 'meeting types change the notes'],
  ['usage', 'AI usage metering and the daily cap'],
  ['cap-tick', 'the scheduler leaves meetings alone while capped'],
  ['delete', 'data export reads and account deletion'],
  ['retention', 'audio retention sweep'],
]
const SLOW = [['background', 'a 5-minute meeting finishes with no browser open (about 4 minutes)']]

const args = process.argv.slice(2)
const all = [...QUICK, ...SLOW]
const chosen = args.includes('all') ? all : args.length ? all.filter(([n]) => args.includes(n)) : QUICK
if (args.length && !args.includes('all') && chosen.length !== args.length) {
  console.error('Unknown name. Choose from:', all.map(([n]) => n).join(', '), '(or "all")')
  process.exit(2)
}

const run = (name) =>
  new Promise((resolve) => {
    const out = []
    const p = spawn(process.execPath, [path.join(import.meta.dirname, `${name}.mjs`)], { cwd: path.resolve(import.meta.dirname, '../..') })
    const take = (d) => out.push(...d.toString().split(/\r?\n/))
    p.stdout.on('data', take)
    p.stderr.on('data', take)
    p.on('close', (code) => resolve({ code, lines: out }))
  })

let failed = 0
for (const [name, what] of chosen) {
  process.stdout.write(`${name.padEnd(11)} ${what} ... `)
  const t0 = Date.now()
  const { code, lines } = await run(name)
  const pass = lines.filter((l) => /^PASS\b/.test(l)).length
  const fail = lines.filter((l) => /^FAIL\b|^ERROR\b/.test(l))
  const left = lines.find((l) => /test_users_left:\s*[1-9]/.test(l))
  const bad = fail.length > 0 || code !== 0 || !!left
  if (bad) failed++
  console.log(`${bad ? 'FAILED' : 'ok'} (${pass} passed, ${fail.length} failed, ${Math.round((Date.now() - t0) / 1000)} s)`)
  for (const l of fail) console.log('     ' + l.slice(0, 200))
  if (left) console.log('     test users were left behind: ' + left.trim())
  if (code !== 0 && !fail.length) console.log('     exited with code ' + code + '; last lines:\n     ' + lines.filter(Boolean).slice(-4).join('\n     '))
}
console.log(failed ? `\n${failed} of ${chosen.length} checks FAILED` : `\nAll ${chosen.length} live checks passed`)
process.exitCode = failed ? 1 : 0
