import { describe, expect, it, vi } from 'vitest'
import { asUser, fails, migratedDb } from './helpers/migratedDb'

vi.setConfig({ testTimeout: 90_000 })

const A = '00000000-0000-0000-0000-00000000000a'
const M1 = '40000000-0000-0000-0000-000000000001'
const M2 = '40000000-0000-0000-0000-000000000002'
const M3 = '40000000-0000-0000-0000-000000000003'

async function setup() {
  const db = await migratedDb()
  await db.exec(`insert into auth.users values ('${A}','a@x.co','{}')`)
  await db.exec(`update profiles set status='approved' where id='${A}'`)
  return db
}
const row = async (db: Awaited<ReturnType<typeof setup>>, id: string) =>
  (await db.query<{ consent_confirmed: boolean; consent_confirmed_at: string | null; consent_version: string | null }>(
    `select consent_confirmed, consent_confirmed_at, consent_version from meetings where id='${id}'`,
  )).rows[0]

describe('recording consent audit trail', () => {
  it('stamps the time on the server when the user confirms', async () => {
    const db = await setup()
    await asUser(db, A, `insert into meetings(id,user_id,title,consent_confirmed,consent_version) values ('${M1}','${A}','m','t','v1')`)
    const r = await row(db, M1)
    expect(r.consent_confirmed).toBe(true)
    expect(r.consent_version).toBe('v1')
    expect(Math.abs(Date.now() - new Date(r.consent_confirmed_at!).getTime())).toBeLessThan(60_000)
  })

  it('ignores a client-supplied (backdated) time', async () => {
    const db = await setup()
    await asUser(db, A, `insert into meetings(id,user_id,title,consent_confirmed,consent_confirmed_at,consent_version) values ('${M1}','${A}','m',true,'2001-01-01','v1')`)
    expect(new Date((await row(db, M1)).consent_confirmed_at!).getFullYear()).toBeGreaterThan(2001)
  })

  it('a meeting created without confirmation has no time and no version', async () => {
    const db = await setup()
    await asUser(db, A, `insert into meetings(id,user_id,title,consent_confirmed_at,consent_version) values ('${M2}','${A}','m','2001-01-01','v1')`)
    expect(await row(db, M2)).toEqual({ consent_confirmed: false, consent_confirmed_at: null, consent_version: null })
  })

  it('cannot be added, removed or altered later, by the user or by processing', async () => {
    const db = await setup()
    await asUser(db, A, `insert into meetings(id,user_id,title) values ('${M3}','${A}','m')`)
    // users: column grants refuse the write outright
    expect(await fails(db, A, `update meetings set consent_confirmed = true where id='${M3}'`)).toBe(true)
    expect(await fails(db, A, `update meetings set consent_confirmed_at = now() where id='${M3}'`)).toBe(true)
    // even a privileged update (the server's service role) cannot rewrite the audit fields
    await db.exec(`update meetings set consent_confirmed = true, consent_confirmed_at = now(), consent_version = 'x', title = 'renamed' where id='${M3}'`)
    expect(await row(db, M3)).toEqual({ consent_confirmed: false, consent_confirmed_at: null, consent_version: null })
    expect((await db.query<{ title: string }>(`select title from meetings where id='${M3}'`)).rows[0].title).toBe('renamed') // other updates still work

    await asUser(db, A, `insert into meetings(id,user_id,title,consent_confirmed,consent_version) values ('${M1}','${A}','m',true,'v1')`)
    const before = await row(db, M1)
    await db.exec(`update meetings set consent_confirmed = false, consent_confirmed_at = null, consent_version = null where id='${M1}'`)
    expect(await row(db, M1)).toEqual(before)
  })
})
