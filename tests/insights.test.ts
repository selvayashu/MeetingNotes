import { describe, expect, it } from 'vitest'
import {
  percentChange,
  periodTotals,
  summariseActions,
  tokenize,
  topTopics,
  weekStart,
  weeklyBuckets,
  workloadByOwner,
  type ActionStat,
  type MeetingStat,
} from '../src/lib/insights'

const D = (s: string) => Date.parse(`${s}T12:00:00Z`)
const NOW = D('2026-10-28') // a Wednesday
const m = (id: string, date: string, minutes: number | null, status = 'done'): MeetingStat => ({ id, meeting_date: `${date}T09:00:00Z`, duration_seconds: minutes == null ? null : minutes * 60, status })
const a = (id: string, task: string, owner: string | null, due: string | null, done = false): ActionStat => ({ id, meeting_id: 'm', task, owner, due_date: due, is_done: done })

describe('weeks', () => {
  it('start on Monday (UTC)', () => {
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
    expect(iso(weekStart(D('2026-10-26')))).toBe('2026-10-26') // Monday itself
    expect(iso(weekStart(D('2026-10-28')))).toBe('2026-10-26') // Wednesday
    expect(iso(weekStart(D('2026-11-01')))).toBe('2026-10-26') // Sunday belongs to the week that began Monday
    expect(iso(weekStart(D('2026-11-02')))).toBe('2026-11-02')
  })

  it('buckets finished meetings per week, oldest first, with empty weeks as zeros', () => {
    const b = weeklyBuckets(
      [m('1', '2026-10-27', 30), m('2', '2026-10-28', 60), m('3', '2026-10-13', 45), m('4', '2026-10-28', 99, 'failed'), m('5', '2026-10-28', null)],
      4,
      NOW,
    )
    expect(b.map((x) => x.weekStart)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(b.map((x) => x.meetings)).toEqual([0, 1, 0, 3]) // the failed one is not counted; the one without a duration still is
    expect(b[3].minutes).toBe(90)
    expect(b[1].minutes).toBe(45)
  })

  it('ignores meetings outside the window and unparseable dates', () => {
    const b = weeklyBuckets([m('1', '2026-01-01', 10), { ...m('2', '2026-10-28', 10), meeting_date: 'not a date' }, m('3', '2026-11-30', 10)], 4, NOW)
    expect(b.every((x) => x.meetings === 0)).toBe(true)
  })
})

describe('period totals and change', () => {
  it('compares the period with the equally long one before it', () => {
    const meetings = [m('1', '2026-10-27', 60), m('2', '2026-10-20', 30), m('3', '2026-10-13', 30), m('4', '2026-10-06', 20)]
    const { current, previous } = periodTotals(meetings, 2, NOW) // weeks of Oct 19 and Oct 26 vs Oct 5 and Oct 12
    expect(current).toEqual({ meetings: 2, minutes: 90, avgMinutes: 45 })
    expect(previous).toEqual({ meetings: 2, minutes: 50, avgMinutes: 25 })
  })
  it('never divides by zero', () => {
    expect(percentChange(5, 0)).toBeNull()
    expect(percentChange(15, 10)).toBe(50)
    expect(percentChange(5, 10)).toBe(-50)
    expect(percentChange(0, 10)).toBe(-100)
    expect(periodTotals([], 4, NOW).current).toEqual({ meetings: 0, minutes: 0, avgMinutes: 0 })
  })
})

describe('action items', () => {
  const items = [
    a('1', 'old', 'Priya', '2026-10-20'),
    a('2', 'due today', 'Priya', '2026-10-28'),
    a('3', 'soon', 'Rahul', '2026-11-04'),
    a('4', 'later', 'Rahul', '2026-11-30'),
    a('5', 'no date', null, null),
    a('6', 'finished', 'Priya', '2026-10-01', true),
    a('7', 'older', 'priya ', '2026-10-10'),
  ]
  it('counts open, overdue (oldest first), due-soon and the completion rate', () => {
    const s = summariseActions(items, '2026-10-28')
    expect(s).toMatchObject({ total: 7, done: 1, open: 6, dueSoon: 2 }) // due today and Nov 4; "later" is beyond 7 days
    expect(s.overdue.map((x) => x.id)).toEqual(['7', '1']) // earliest due first; today is NOT overdue; done items never are
    expect(s.completionRate).toBeCloseTo(1 / 7, 5)
  })
  it('handles an empty list', () => {
    expect(summariseActions([], '2026-10-28')).toMatchObject({ total: 0, open: 0, completionRate: null, overdue: [] })
  })
  it('groups open work by person ignoring case and spaces, worst first', () => {
    const w = workloadByOwner(items, '2026-10-28')
    expect(w[0]).toEqual({ owner: 'Priya', open: 3, overdue: 2 }) // "Priya" + "priya " together; the finished one excluded
    expect(w.find((x) => x.owner === 'Rahul')).toEqual({ owner: 'Rahul', open: 2, overdue: 0 })
    expect(w.at(-1)).toEqual({ owner: null, open: 1, overdue: 0 }) // unassigned last
  })
  it('keeps Hindi and Tamil names intact', () => {
    const w = workloadByOwner([a('1', 't', 'प्रिया', null), a('2', 't', 'பிரியா', null), a('3', 't', ' प्रिया', null)], '2026-10-28')
    expect(w.map((x) => [x.owner, x.open]).sort()).toEqual([['பிரியா', 1], ['प्रिया', 2]].sort())
  })
})

describe('topics', () => {
  it('drops stop words, numbers and short tokens, in three scripts', () => {
    expect(tokenize('The launch of the new website is on Friday, 2026!')).toEqual(['launch', 'website', 'friday'])
    expect(tokenize('वेबसाइट का लॉन्च शुक्रवार को होगा')).toEqual(['वेबसाइट', 'लॉन्च', 'शुक्रवार']) // का, को, होगा are function words
    expect(tokenize('புதிய இணையதளம் வெளியீடு பற்றி')).toEqual(['புதிய', 'இணையதளம்', 'வெளியீடு'])
  })

  it('keeps vowel signs inside words (does not shred Indic text)', () => {
    expect(tokenize('प्रेस रिलीज़ तैयार')).toEqual(['प्रेस', 'रिलीज़', 'तैयार'])
  })

  it('ranks by how many meetings mention a term, not by raw repetition', () => {
    const docs = [
      { meetingId: 'a', text: 'budget budget budget budget budget roadmap' },
      { meetingId: 'b', text: 'roadmap hiring' },
      { meetingId: 'c', text: 'roadmap hiring budget' },
      { meetingId: 'd', text: 'once' },
    ]
    const t = topTopics(docs)
    expect(t.map((x) => x.term)).toEqual(['roadmap', 'budget', 'hiring']) // roadmap in 3 meetings; "once" appears in 1 and is dropped
    expect(t[0]).toMatchObject({ meetings: 3, count: 3 })
    expect(t[1]).toMatchObject({ meetings: 2, count: 6 })
  })

  it('with only one or two meetings, single-meeting terms are still shown', () => {
    expect(topTopics([{ meetingId: 'a', text: 'launch website' }]).map((x) => x.term).sort()).toEqual(['launch', 'website'])
  })

  it('respects the limit and handles no text', () => {
    const docs = Array.from({ length: 3 }, (_, i) => ({ meetingId: `m${i}`, text: Array.from({ length: 30 }, (_, j) => `term${j}x`).join(' ') }))
    expect(topTopics(docs, 5)).toHaveLength(5)
    expect(topTopics([])).toEqual([])
  })
})
