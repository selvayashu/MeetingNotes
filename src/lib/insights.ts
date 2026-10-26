/**
 * Numbers behind the Insights page. Everything here is a pure function of the user's own meetings, notes and action
 * items, so it is easy to test. Dates are handled as UTC calendar days (weeks start on Monday) to stay deterministic.
 */

export interface MeetingStat {
  id: string
  meeting_date: string
  duration_seconds: number | null
  status: string
}
export interface ActionStat {
  id: string
  meeting_id: string
  task: string
  owner: string | null
  due_date: string | null // YYYY-MM-DD
  is_done: boolean
}

const DAY = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const startOfUtcDay = (ms: number) => Math.floor(ms / DAY) * DAY

/** Monday (UTC) of the week containing `ms`. */
export function weekStart(ms: number): number {
  const day = startOfUtcDay(ms)
  const dow = (new Date(day).getUTCDay() + 6) % 7 // Monday = 0
  return day - dow * DAY
}

/** Finished meetings only: a failed or half-processed meeting is not a real data point. */
const counted = (m: MeetingStat) => m.status === 'done'

export interface WeekBucket {
  weekStart: string // YYYY-MM-DD (Monday)
  meetings: number
  minutes: number
}

/** The last `weeks` weeks ending with the current one, oldest first, with empty weeks included as zeros. */
export function weeklyBuckets(meetings: MeetingStat[], weeks: number, now: number): WeekBucket[] {
  const first = weekStart(now) - (weeks - 1) * 7 * DAY
  const buckets = Array.from({ length: weeks }, (_, i) => ({ weekStart: isoDay(first + i * 7 * DAY), meetings: 0, minutes: 0 }))
  for (const m of meetings) {
    if (!counted(m)) continue
    const t = Date.parse(m.meeting_date)
    if (Number.isNaN(t) || t < first || t >= first + weeks * 7 * DAY) continue
    const b = buckets[Math.floor((weekStart(t) - first) / (7 * DAY))]
    b.meetings += 1
    b.minutes += (m.duration_seconds ?? 0) / 60
  }
  return buckets
}

export interface PeriodTotals {
  meetings: number
  minutes: number
  avgMinutes: number
}

export function totalsFor(meetings: MeetingStat[], from: number, to: number): PeriodTotals {
  let n = 0
  let minutes = 0
  for (const m of meetings) {
    const t = Date.parse(m.meeting_date)
    if (!counted(m) || Number.isNaN(t) || t < from || t >= to) continue
    n++
    minutes += (m.duration_seconds ?? 0) / 60
  }
  return { meetings: n, minutes, avgMinutes: n ? minutes / n : 0 }
}

/** The `weeks` ending now, and the same-length stretch just before it (for "vs previous"). */
export function periodTotals(meetings: MeetingStat[], weeks: number, now: number) {
  const end = weekStart(now) + 7 * DAY
  const start = end - weeks * 7 * DAY
  return { current: totalsFor(meetings, start, end), previous: totalsFor(meetings, start - weeks * 7 * DAY, start) }
}

/** Signed relative change, or null when there is nothing to compare against (never divide by zero). */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null
  return Math.round(((current - previous) / previous) * 100)
}

// ---------- action items ----------

export interface ActionSummary {
  total: number
  done: number
  open: number
  overdue: ActionStat[]
  dueSoon: number // open, due within the next 7 days (today included), not overdue
  completionRate: number | null // done / total, null if there are none
}

/** `today` is a YYYY-MM-DD string. Something due today is not overdue yet. */
export function summariseActions(items: ActionStat[], today: string): ActionSummary {
  const open = items.filter((a) => !a.is_done)
  const overdue = open
    .filter((a) => a.due_date != null && a.due_date < today)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
  const weekAhead = isoDay(Date.parse(`${today}T00:00:00Z`) + 7 * DAY)
  const dueSoon = open.filter((a) => a.due_date != null && a.due_date >= today && a.due_date <= weekAhead).length
  const done = items.length - open.length
  return { total: items.length, done, open: open.length, overdue, dueSoon, completionRate: items.length ? done / items.length : null }
}

export interface OwnerLoad {
  owner: string | null // null = unassigned
  open: number
  overdue: number
}

/** Open work per person. Owners are matched ignoring case and surrounding spaces; the first spelling seen is shown. */
export function workloadByOwner(items: ActionStat[], today: string): OwnerLoad[] {
  const byKey = new Map<string, { owner: string | null; open: number; overdue: number }>()
  for (const a of items) {
    if (a.is_done) continue
    const name = a.owner?.trim() || null
    const key = name ? name.toLocaleLowerCase() : ''
    const row = byKey.get(key) ?? { owner: name, open: 0, overdue: 0 }
    row.open++
    if (a.due_date != null && a.due_date < today) row.overdue++
    byKey.set(key, row)
  }
  return [...byKey.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open || (a.owner ?? '￿').localeCompare(b.owner ?? '￿'))
}

// ---------- topics ----------

const STOP_EN = new Set(
  `a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours will meeting discussed discussion team also said says new one two three first next last will shall`.split(/\s+/),
)
// A few of the commonest function words in Hindi and Tamil; enough to stop them from topping the list.
const STOP_HI = new Set('का की के को से में पर और या तो है हैं था थे थी हो होगा होगी होंगे कि जो यह वह इस उस एक भी नहीं ही लिए साथ बाद करना करने किया गया गई गए रहा रहे रही कुछ सभी अपने उनके उनकी इसके मीटिंग बैठक'.split(/\s+/))
const STOP_TA = new Set('ஒரு இந்த அந்த மற்றும் என்று என்ற ஆக இது அது இல்லை உள்ள உள்ளது ஆகும் போது பின்னர் மீண்டும் அவர் அவர்கள் நாம் கூட்டம் கூட்டத்தில் பற்றி மூலம் ஆனால் என'.split(/\s+/))

export function tokenize(text: string): string[] {
  return text
    .normalize('NFC')
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u) // keeps Devanagari/Tamil vowel signs (marks) inside their words
    .filter((w) => w.length >= 3 && !/^\p{N}+$/u.test(w) && !STOP_EN.has(w) && !STOP_HI.has(w) && !STOP_TA.has(w))
}

export interface Topic {
  term: string
  meetings: number // how many meetings mention it
  count: number // total mentions
}

/**
 * Terms ranked by how many *different meetings* mention them (so one long note can't dominate), then by total mentions.
 * Terms that appear in only one meeting are dropped when there are several meetings, as they are not "recurring".
 */
export function topTopics(docs: { meetingId: string; text: string }[], max = 12): Topic[] {
  const stats = new Map<string, { meetings: Set<string>; count: number }>()
  for (const d of docs) {
    for (const term of tokenize(d.text)) {
      const s = stats.get(term) ?? { meetings: new Set<string>(), count: 0 }
      s.meetings.add(d.meetingId)
      s.count++
      stats.set(term, s)
    }
  }
  const distinctMeetings = new Set(docs.map((d) => d.meetingId)).size
  const minMeetings = distinctMeetings >= 3 ? 2 : 1
  return [...stats.entries()]
    .map(([term, s]) => ({ term, meetings: s.meetings.size, count: s.count }))
    .filter((t) => t.meetings >= minMeetings)
    .sort((a, b) => b.meetings - a.meetings || b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, max)
}
