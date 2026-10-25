import { describe, expect, it, vi } from 'vitest'
import { migratedDb } from './helpers/migratedDb'

// Starting an in-process Postgres and applying every migration takes several seconds, longer on a busy machine.
vi.setConfig({ testTimeout: 90_000 })

const U = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`
const M = (n: number) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`
const PART = `'[{"path":"x/0.webm","duration_seconds":60}]'::jsonb`

describe('background processing: which meetings does the scheduler pick?', () => {
  it('picks only unfinished, unlocked, approved-owner meetings, oldest first, and respects limits', async () => {
    const db = await migratedDb()
    // users: 1 approved, 2 pending (never processed in the background), 3 approved
    await db.exec(`insert into auth.users values ('${U(1)}','a@x.co','{}'),('${U(2)}','b@x.co','{}'),('${U(3)}','c@x.co','{}')`)
    await db.exec(`update profiles set status='approved' where id in ('${U(1)}','${U(3)}')`)

    const old = `now() - interval '5 minutes'`
    const mk = (n: number, user: number, extra: string, createdAt = old) =>
      db.exec(`insert into meetings(id,user_id,title,audio_parts,created_at) values ('${M(n)}','${U(user)}','m${n}',${PART},${createdAt})`)
        .then(() => (extra ? db.exec(`update meetings set ${extra} where id='${M(n)}'`) : undefined))

    await mk(1, 1, `status='transcribing'`, `now() - interval '40 minutes'`)           // picked (oldest)
    await mk(2, 1, `status='summarising'`)                                              // picked
    await mk(3, 1, `status='uploaded'`)                                                 // picked: older than 45 s
    await mk(4, 1, `status='uploaded'`, `now() - interval '10 seconds'`)                // too fresh: the open tab goes first
    await mk(5, 1, `status='done'`)                                                     // finished
    await mk(6, 1, `status='failed'`)                                                   // waits for a manual Retry
    await mk(7, 1, `status='transcribing', lock_until = now() + interval '1 minute'`)   // being worked on right now
    await mk(8, 1, `status='transcribing', lock_until = now() - interval '1 minute'`)   // lock expired (worker died): picked
    await mk(9, 1, `status='transcribing', auto_attempts = 40`)                         // gave up
    await mk(10, 1, `status='transcribing'`, `now() - interval '8 days'`)               // too old
    await mk(11, 2, `status='transcribing'`)                                            // owner is not approved
    await mk(12, 3, `status='transcribing', audio_parts = '[]'::jsonb`)                 // no audio (e.g. deleted)

    const ids = async (n?: number) =>
      (await db.query<{ id: string }>(n !== undefined ? `select id from pending_processing_ids(${n})` : `select id from pending_processing_ids()`)).rows.map((r) => r.id)

    expect(await ids(10)).toEqual([M(1), M(2), M(3), M(8)])
    expect(await ids()).toEqual([M(1), M(2), M(3)]) // default batch of 3, oldest first
    expect(await ids(1)).toEqual([M(1)])
    expect(await ids(0)).toHaveLength(1) // never an empty/negative limit
  })

  it('is not callable by signed-in users, and the private config is invisible to them', async () => {
    const db = await migratedDb()
    await db.exec(`insert into app_config values ('process_url','https://example.test/api/process-meeting')`)
    await db.exec(`set role authenticated`)
    await expect(db.query(`select * from pending_processing_ids()`)).rejects.toThrow()
    await expect(db.query(`select * from app_config`)).rejects.toThrow()
    await db.exec(`reset role`)
    await db.exec(`set role anon`)
    await expect(db.query(`select * from pending_processing_ids()`)).rejects.toThrow()
    await db.exec(`reset role`)
  })

  it('processing counters cannot be changed by users', async () => {
    const db = await migratedDb()
    await db.exec(`insert into auth.users values ('${U(1)}','a@x.co','{}')`)
    await db.exec(`update profiles set status='approved' where id='${U(1)}'`)
    await db.exec(`insert into meetings(id,user_id,title) values ('${M(1)}','${U(1)}','m')`)
    await db.exec(`select set_config('request.jwt.claim.sub','${U(1)}',false); set role authenticated`)
    await expect(db.query(`update meetings set auto_attempts = 0 where id='${M(1)}'`)).rejects.toThrow()
    await expect(db.query(`update meetings set status = 'done' where id='${M(1)}'`)).rejects.toThrow()
    await db.exec(`reset role`)
  })
})
