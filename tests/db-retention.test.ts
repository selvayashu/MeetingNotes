import { describe, expect, it, vi } from 'vitest'
import { asUser, fails, migratedDb } from './helpers/migratedDb'

vi.setConfig({ testTimeout: 90_000 })

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const parts = `'[{"path":"x/y/000.wav","duration_seconds":10}]'::jsonb`

async function setup() {
  const db = await migratedDb()
  for (const u of [A, B]) {
    await db.exec(`insert into auth.users values ('${u}','${u}@x.co','{}')`)
    await db.exec(`update profiles set status='approved' where id='${u}'`)
  }
  return db
}
const meeting = (db: Awaited<ReturnType<typeof setup>>, id: string, user: string, daysOld: number, status = 'done', audio = parts) =>
  db.exec(`insert into meetings(id,user_id,title,status,audio_parts,created_at) values ('${id}','${user}','m','${status}',${audio}, now() - interval '${daysOld} days')`)
const expired = async (db: Awaited<ReturnType<typeof setup>>) =>
  (await db.query<{ id: string }>(`select id from audio_expired(100)`)).rows.map((r) => r.id.slice(-2)).sort()

const id = (n: number) => `60000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`

describe('audio_expired', () => {
  it('lists nothing while nobody has chosen a retention period', async () => {
    const db = await setup()
    await meeting(db, id(1), A, 400)
    expect(await expired(db)).toEqual([])
  })

  it('lists finished meetings older than their owner\'s period, and only theirs', async () => {
    const db = await setup()
    await db.exec(`update profiles set audio_retention_days = 30 where id='${A}'`) // B keeps audio forever
    await meeting(db, id(1), A, 31) // expired
    await meeting(db, id(2), A, 29) // not yet
    await meeting(db, id(3), B, 400) // other person has no limit
    expect(await expired(db)).toEqual(['01'])
  })

  it('never touches meetings that still need their audio, or that have none left', async () => {
    const db = await setup()
    await db.exec(`update profiles set audio_retention_days = 7 where id='${A}'`)
    for (const [n, s] of [[1, 'uploaded'], [2, 'transcribing'], [3, 'summarising'], [4, 'failed']] as const) await meeting(db, id(n), A, 100, s)
    await meeting(db, id(5), A, 100, 'done', `'[]'::jsonb`)
    await meeting(db, id(6), A, 100, 'done')
    expect(await expired(db)).toEqual(['06'])
  })

  it('applies each person\'s own period', async () => {
    const db = await setup()
    await db.exec(`update profiles set audio_retention_days = 7 where id='${A}'; update profiles set audio_retention_days = 90 where id='${B}'`)
    await meeting(db, id(1), A, 10)
    await meeting(db, id(2), B, 10)
    await meeting(db, id(3), B, 100)
    expect(await expired(db)).toEqual(['01', '03'])
  })
})

describe('the setting itself', () => {
  it('accepts only 7, 30, 90 days or none', async () => {
    const db = await setup()
    for (const v of ['7', '30', '90', 'null']) await asUser(db, A, `update profiles set audio_retention_days = ${v} where id='${A}'`)
    for (const v of ['0', '1', '365', '-5']) expect(await fails(db, A, `update profiles set audio_retention_days = ${v} where id='${A}'`)).toBe(true)
  })

  it('is changed by its owner only, and the sweep list is not readable by users', async () => {
    const db = await setup()
    await asUser(db, B, `update profiles set audio_retention_days = 7 where id='${A}'`) // RLS: no row matches
    expect((await db.query<{ audio_retention_days: number | null }>(`select audio_retention_days from profiles where id='${A}'`)).rows[0].audio_retention_days).toBeNull()
    expect(await fails(db, A, `select * from audio_expired(10)`)).toBe(true)
  })
})
