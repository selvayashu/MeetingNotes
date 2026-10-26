import { describe, expect, it, vi } from 'vitest'
import { asUser, fails, migratedDb } from './helpers/migratedDb'

vi.setConfig({ testTimeout: 90_000 })

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const M1 = '50000000-0000-0000-0000-000000000001'

async function setup() {
  const db = await migratedDb()
  for (const u of [A, B]) {
    await db.exec(`insert into auth.users values ('${u}','${u}@x.co','{}')`)
    await db.exec(`update profiles set status='approved' where id='${u}'`)
  }
  await asUser(db, A, `insert into meetings(id,user_id,title) values ('${M1}','${A}','m')`)
  await db.exec(`insert into meeting_notes(meeting_id, summary) values ('${M1}', 's')`)
  return db
}
const template = async (db: Awaited<ReturnType<typeof setup>>) =>
  (await db.query<{ template: string }>(`select template from meetings where id='${M1}'`)).rows[0].template

describe('meeting type column', () => {
  it('defaults to general, so existing and new meetings work unchanged', async () => {
    expect(await template(await setup())).toBe('general')
  })

  it('accepts every real type and rejects anything else', async () => {
    const db = await setup()
    for (const t of ['standup', 'one_on_one', 'client_call', 'interview', 'brainstorm', 'general']) {
      await asUser(db, A, `update meetings set template='${t}' where id='${M1}'`)
      expect(await template(db)).toBe(t)
    }
    expect(await fails(db, A, `update meetings set template='made_up' where id='${M1}'`)).toBe(true)
    expect(await fails(db, A, `insert into meetings(user_id,title,template) values ('${A}','x','made_up')`)).toBe(true)
  })

  it('only the owner can change it', async () => {
    const db = await setup()
    await asUser(db, B, `update meetings set template='standup' where id='${M1}'`) // RLS: matches no row
    expect(await template(db)).toBe('general')
  })

  it('can be chosen when the meeting is created', async () => {
    const db = await setup()
    await asUser(db, A, `insert into meetings(id,user_id,title,template) values ('50000000-0000-0000-0000-000000000002','${A}','x','interview')`)
    expect((await db.query<{ template: string }>(`select template from meetings where id='50000000-0000-0000-0000-000000000002'`)).rows[0].template).toBe('interview')
  })
})

describe('which type the notes were written with', () => {
  it('is readable by the owner but only the server can write it', async () => {
    const db = await setup()
    expect(await fails(db, A, `update meeting_notes set notes_template='standup' where meeting_id='${M1}'`)).toBe(true)
    await db.exec(`update meeting_notes set notes_template='standup' where meeting_id='${M1}'`) // service role
    const r = await asUser<{ notes_template: string }>(db, A, `select notes_template from meeting_notes where meeting_id='${M1}'`)
    expect(r.rows[0].notes_template).toBe('standup')
    const other = await asUser(db, B, `select notes_template from meeting_notes where meeting_id='${M1}'`)
    expect(other.rows).toHaveLength(0)
  })
})
