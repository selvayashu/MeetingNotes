import { describe, expect, it, vi } from 'vitest'
import { asUser, fails, migratedDb } from './helpers/migratedDb'

vi.setConfig({ testTimeout: 90_000 })

const ADMIN = '00000000-0000-0000-0000-0000000000ad'
const U1 = '00000000-0000-0000-0000-000000000001'
const U2 = '00000000-0000-0000-0000-000000000002'
const M1 = '50000000-0000-0000-0000-000000000001'
const M2 = '50000000-0000-0000-0000-000000000002'

async function setup() {
  const db = await migratedDb()
  await db.exec(`insert into auth.users values ('${ADMIN}','boss@x.co','{}'),('${U1}','one@x.co','{}'),('${U2}','two@x.co','{}')`)
  await db.exec(`update profiles set status='approved', is_admin = (id = '${ADMIN}')`)
  return db
}
const use = (db: Awaited<ReturnType<typeof setup>>, user: string, meeting: string, kind: string, neurons: number, seconds = 0, ago = '0 days') =>
  db.exec(`insert into ai_usage(user_id, meeting_id, kind, neurons, audio_seconds, created_at)
           values ('${user}','${meeting}','${kind}',${neurons},${seconds}, now() - interval '${ago}')`)
const cap = async (db: Awaited<ReturnType<typeof setup>>) =>
  (await db.query<{ used: string; cap: string; reached: boolean }>(`select * from ai_cap_status()`)).rows[0]

describe('AI daily cap', () => {
  it('starts with the default cap and nothing used', async () => {
    const db = await setup()
    expect(await cap(db)).toEqual({ used: '0', cap: '8000', reached: false })
  })

  it('counts only today (UTC), and reports reached at or above the cap', async () => {
    const db = await setup()
    await use(db, U1, M1, 'transcribe', 5000, 600, '3 days') // old: does not count
    await use(db, U1, M1, 'transcribe', 7000, 600)
    expect(await cap(db)).toMatchObject({ used: '7000', reached: false })
    await use(db, U2, M2, 'notes', 1000)
    expect(await cap(db)).toMatchObject({ used: '8000', reached: true }) // exactly at the cap counts as reached
  })

  it('a cap of 0 turns the limit off, and a changed cap takes effect immediately', async () => {
    const db = await setup()
    await use(db, U1, M1, 'transcribe', 9000)
    expect((await cap(db)).reached).toBe(true)
    await db.exec(`update app_config set value='0' where key='ai_daily_neuron_cap'`)
    expect((await cap(db)).reached).toBe(false)
    await db.exec(`update app_config set value='9000' where key='ai_daily_neuron_cap'`)
    expect((await cap(db)).reached).toBe(true)
  })

  it('is not callable by signed-in users, and the usage table is invisible to them', async () => {
    const db = await setup()
    expect(await fails(db, U1, `select * from ai_cap_status()`)).toBe(true)
    expect(await fails(db, ADMIN, `select * from ai_usage`)).toBe(true) // even admins go through the RPCs
    expect(await fails(db, U1, `select * from app_config`)).toBe(true)
  })
})

describe('admin usage views', () => {
  it('only admins can use them', async () => {
    const db = await setup()
    for (const q of [`select * from admin_ai_overview()`, `select * from admin_usage_daily(7)`, `select * from admin_usage_by_user(7)`, `select admin_set_ai_cap(1)`]) {
      expect(await fails(db, U1, q), q).toBe(true)
    }
  })

  it('daily totals include empty days and sum correctly', async () => {
    const db = await setup()
    await use(db, U1, M1, 'transcribe', 100, 120) // today
    await use(db, U1, M1, 'notes', 50) // today, same meeting
    await use(db, U2, M2, 'transcribe', 200, 60, '2 days')
    const rows = (await asUser(db, ADMIN, `select to_char(day,'YYYY-MM-DD') d, neurons::float, audio_minutes::float, meetings::int, calls::int from admin_usage_daily(4)`)).rows as { d: string; neurons: number; audio_minutes: number; meetings: number; calls: number }[]
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ neurons: 150, audio_minutes: 2, meetings: 1, calls: 2 }) // newest first
    expect(rows[1].neurons).toBe(0) // yesterday: present but empty
    expect(rows[2]).toMatchObject({ neurons: 200, audio_minutes: 1, meetings: 1 })
  })

  it('per-user totals are ranked by usage and show who used it', async () => {
    const db = await setup()
    await use(db, U1, M1, 'transcribe', 100, 60)
    await use(db, U2, M2, 'transcribe', 900, 300)
    const rows = (await asUser(db, ADMIN, `select email, neurons::float n, audio_minutes::float m from admin_usage_by_user(7)`)).rows as { email: string; n: number; m: number }[]
    expect(rows.map((r) => r.email)).toEqual(['two@x.co', 'one@x.co'])
    expect(rows[0]).toMatchObject({ n: 900, m: 5 })
  })

  it('an admin can change the cap within sane limits', async () => {
    const db = await setup()
    await asUser(db, ADMIN, `select admin_set_ai_cap(5000)`)
    expect((await cap(db)).cap).toBe('5000')
    expect(await fails(db, ADMIN, `select admin_set_ai_cap(-1)`)).toBe(true)
    expect(await fails(db, ADMIN, `select admin_set_ai_cap(5000000)`)).toBe(true)
    await asUser(db, ADMIN, `select admin_set_ai_cap(0)`)
    expect((await cap(db)).reached).toBe(false)
  })

  it('totals survive deleting a user', async () => {
    const db = await setup()
    await use(db, U2, M2, 'transcribe', 300, 60)
    await db.exec(`delete from auth.users where id='${U2}'`)
    expect((await cap(db)).used).toBe('300')
  })
})
