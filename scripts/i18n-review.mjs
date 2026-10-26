// Native-speaker review of the Hindi and Tamil text.
//
//   npm run i18n:export            writes docs/translation-review/review-hi.csv and review-ta.csv
//   npm run i18n:apply -- hi path/to/filled-in.csv [--dry-run]
//                                  applies the reviewer's corrections to src/i18n/hi.json
import fs from 'node:fs'
import path from 'node:path'
import { GLOSSARY_KEYS, applyChanges, buildRows, readSheet, toCsv } from './i18n-review-lib.mjs'

const root = path.resolve(import.meta.dirname, '..')
const dictPath = (l) => path.join(root, 'src', 'i18n', `${l}.json`)
const read = (l) => JSON.parse(fs.readFileSync(dictPath(l), 'utf8'))
const LANGS = { hi: 'Hindi', ta: 'Tamil' }

const [cmd, lang, file, ...flags] = process.argv.slice(2)

if (cmd === 'export') {
  const en = read('en')
  const outDir = path.join(root, 'docs', 'translation-review')
  fs.mkdirSync(outDir, { recursive: true })
  for (const l of Object.keys(LANGS)) {
    const target = read(l)
    fs.writeFileSync(path.join(outDir, `review-${l}.csv`), toCsv(buildRows(en, target)))
    const terms = GLOSSARY_KEYS.map((k) => `| ${en[k]} | ${target[k]} |`).join('\n')
    fs.writeFileSync(
      path.join(outDir, `terms-${l}.md`),
      `# ${LANGS[l]}: key terms used throughout the app\n\nPlease confirm or correct these first; they appear on many screens.\n\n| English | ${LANGS[l]} (current) |\n|---|---|\n${terms}\n`,
    )
    console.log(`${LANGS[l]}: ${Object.keys(en).length} strings -> docs/translation-review/review-${l}.csv`)
  }
} else if (cmd === 'apply' && LANGS[lang] && file) {
  const en = read('en')
  const target = read(lang)
  const { changes, problems, comments } = readSheet(fs.readFileSync(path.resolve(file), 'utf8'), en, target)
  for (const p of problems) console.log('PROBLEM', p)
  for (const c of changes) console.log(`CHANGE ${c.key}\n   - ${c.from}\n   + ${c.to}`)
  for (const c of comments) console.log(`COMMENT ${c.key}: ${c.note}`)
  console.log(`\n${changes.length} change(s), ${problems.length} problem(s), ${comments.length} comment(s).`)
  if (flags.includes('--dry-run')) console.log('Dry run: nothing was written.')
  else if (changes.length) {
    fs.writeFileSync(dictPath(lang), applyChanges(fs.readFileSync(dictPath(lang), 'utf8'), changes))
    console.log(`Updated src/i18n/${lang}.json. Run "npm test" next.`)
  }
  process.exitCode = problems.length ? 1 : 0
} else {
  console.log('Usage:\n  node scripts/i18n-review.mjs export\n  node scripts/i18n-review.mjs apply <hi|ta> <filled-in.csv> [--dry-run]')
  process.exitCode = 2
}
