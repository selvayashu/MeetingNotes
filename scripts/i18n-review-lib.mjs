// Helpers for the native-speaker review of the Hindi and Tamil text (see docs/translation-review/README.md).
// Pure functions, tested in tests/i18n-review.test.ts.

/** Which screen a key belongs to, in words a reviewer can picture. */
export const SCREENS = {
  nav: 'Top bar',
  common: 'Shared words and messages',
  login: 'Sign in / create account',
  resetpw: 'Reset password',
  password: 'Password rules',
  approval: 'Waiting for approval',
  landing: 'Landing page (before sign in)',
  sample: 'Sample meeting (example content)',
  onboarding: 'First-run guide',
  dashboard: 'Meeting list',
  status: 'Meeting status labels',
  record: 'Record / upload screen',
  consent: 'Recording consent notice',
  draft: 'Recovering an interrupted recording',
  detail: 'Meeting page',
  tabs: 'Meeting tabs',
  summary: 'Summary tab',
  actions: 'Action items tab',
  transcript: 'Transcript tab',
  tedit: 'Editing the transcript',
  notesStale: 'Notes out of date after editing',
  audio: 'Audio player',
  export: 'Export / copy',
  insights: 'Insights page',
  settings: 'Settings',
  data: 'Settings: download / delete my data',
  admin: 'Admin: approving people',
  usage: 'Admin: AI usage and limit',
  lang: 'Language names',
  theme: 'Theme names',
  update: 'New-version bar',
  err: 'Error messages',
  config: 'Setup problem message',
}

/** Words used the same way everywhere. Reviewers confirm or correct these first. */
export const GLOSSARY_KEYS = [
  'tabs.summary',
  'summary.decisions',
  'tabs.actions',
  'tabs.transcript',
  'nav.insights',
  'nav.settings',
  'actions.owner',
  'actions.due',
  'status.done',
  'status.failed',
]

export const screenOf = (key) => SCREENS[key.split('.')[0]] ?? key.split('.')[0]

export const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

// ---------- CSV (Excel-friendly: UTF-8 with BOM, CRLF, quotes doubled) ----------

const BOM = '﻿'

export function toCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? '')
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return BOM + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** Parses CSV, tolerating Excel's variations: BOM, ; or tab as separator, quoted newlines, CRLF or LF. */
export function parseCsv(text) {
  const t = text.replace(/^﻿/, '')
  const firstLine = t.split(/\r?\n/, 1)[0]
  const sep = [',', ';', '\t'].map((c) => [c, firstLine.split(c).length]).sort((a, b) => b[1] - a[1])[0][0]
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') (cell += '"'), i++
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === sep) (row.push(cell), (cell = ''))
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else cell += c
  }
  if (cell !== '' || row.length) (row.push(cell), rows.push(row))
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

// ---------- export ----------

export const HEADER = ['Key', 'Screen', 'English', 'Current text', 'Corrected text (leave empty if the current text is fine)', 'Comment (optional)']

/** One row per string, grouped by screen so a reviewer works through one screen at a time. */
export function buildRows(en, target) {
  const keys = Object.keys(en)
  const order = [...new Set(keys.map(screenOf))]
  const rows = keys
    .map((k) => [k, screenOf(k), en[k], target[k] ?? '', '', ''])
    .sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]))
  return [HEADER, ...rows]
}

// ---------- apply ----------

/**
 * Validates a filled-in sheet against the dictionaries. Returns { changes, problems, comments }.
 * A change needs a non-empty corrected text that differs from the current one, keeps every {placeholder},
 * and refers to a key that exists. Anything else is a problem and is NOT applied.
 */
export function readSheet(csvText, en, target) {
  const rows = parseCsv(csvText)
  const head = rows[0] ?? []
  const col = (re) => head.findIndex((h) => re.test(h))
  const iKey = col(/^key$/i)
  const iFix = col(/^corrected/i)
  const iNote = col(/^comment/i)
  if (iKey < 0 || iFix < 0) return { changes: [], problems: ['The first row must have the columns "Key" and "Corrected text ...". Was the header edited?'], comments: [] }
  const changes = []
  const problems = []
  const comments = []
  rows.slice(1).forEach((r, n) => {
    const key = (r[iKey] ?? '').trim()
    const fix = (r[iFix] ?? '').replace(/\s+$/g, '').replace(/^\s+/g, '')
    const note = (iNote >= 0 ? r[iNote] : '')?.trim()
    if (!key) return
    if (note) comments.push({ key, note })
    if (!fix) return
    const line = n + 2
    if (!(key in en)) return problems.push(`Row ${line}: unknown key "${key}" (not changed)`)
    if (fix === target[key]) return
    if (placeholders(fix).join() !== placeholders(en[key]).join())
      return problems.push(`Row ${line} (${key}): the {placeholders} must stay exactly as in English: ${placeholders(en[key]).map((p) => `{${p}}`).join(' ') || '(none)'} (not changed)`)
    changes.push({ key, from: target[key], to: fix })
  })
  return { changes, problems, comments }
}

/** Replaces values in the JSON file text one key at a time, so the file's layout, order and blank lines stay as they are. */
export function applyChanges(jsonText, changes) {
  let out = jsonText
  for (const { key, to } of changes) {
    const prefix = `  ${JSON.stringify(key)}:`
    const lines = out.split('\n')
    const at = lines.findIndex((l) => l.startsWith(prefix))
    if (at < 0) throw new Error(`key ${key} not found in file`)
    const comma = lines[at].trimEnd().endsWith(',') ? ',' : ''
    lines[at] = `${prefix} ${JSON.stringify(to)}${comma}`
    out = lines.join('\n')
  }
  JSON.parse(out) // never write a broken file
  return out
}
