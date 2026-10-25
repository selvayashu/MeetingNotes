import { describe, expect, it, vi } from 'vitest'
import { asUser, fails, migratedDb } from './helpers/migratedDb'

vi.setConfig({ testTimeout: 90_000 })

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const PENDING = '00000000-0000-0000-0000-00000000000c'
const MEETING = '20000000-0000-0000-0000-000000000001'
const SEG = '30000000-0000-0000-0000-000000000001'
const SEG2 = '30000000-0000-0000-0000-000000000002'

async function setup() {
  const db = await migratedDb()
  await db.exec(`insert into auth.users values ('${A}','a@x.co','{}'),('${B}','b@x.co','{}'),('${PENDING}','c@x.co','{}')`)
  await db.exec(`update profiles set status='approved' where id in ('${A}','${B}')`)
  await db.exec(`insert into meetings(id,user_id,title) values ('${MEETING}','${A}','m')`)
  await db.exec(`insert into transcript_segments(id,meeting_id,start_ms,end_ms,text) values
    ('${SEG}','${MEETING}',1000,4000,'Prya will send the report'),
    ('${SEG2}','${MEETING}',5000,8000,'Prya agreed')`)
  return db
}
const row = async (db: Awaited<ReturnType<typeof setup>>, id = SEG) =>
  (await db.query<{ text: string; original_text: string | null; edited_at: string | null; start_ms: number; end_ms: number }>(
    `select text, original_text, edited_at, start_ms, end_ms from transcript_segments where id='${id}'`,
  )).rows[0]

describe('transcript editing (database rules)', () => {
  it('keeps Whisper\'s original on the first edit and does not overwrite it on later ones', async () => {
    const db = await setup()
    await asUser(db, A, `update transcript_segments set text = 'Priya will send the report' where id='${SEG}'`)
    let r = await row(db)
    expect(r.text).toBe('Priya will send the report')
    expect(r.original_text).toBe('Prya will send the report')
    expect(r.edited_at).not.toBeNull()

    await asUser(db, A, `update transcript_segments set text = 'Priya will send the Q3 report' where id='${SEG}'`)
    r = await row(db)
    expect(r.original_text).toBe('Prya will send the report') // still Whisper's text, not the first edit
  })

  it('restoring the original clears the "edited" state', async () => {
    const db = await setup()
    await asUser(db, A, `update transcript_segments set text = 'changed' where id='${SEG}'`)
    await asUser(db, A, `update transcript_segments set text = 'Prya will send the report' where id='${SEG}'`)
    const r = await row(db)
    expect(r.original_text).toBeNull()
    expect(r.edited_at).toBeNull()
  })

  it('ignores attempts to forge the audit fields or move the line in time', async () => {
    const db = await setup()
    // column grants stop the direct write...
    expect(await fails(db, A, `update transcript_segments set original_text = 'forged' where id='${SEG}'`)).toBe(true)
    expect(await fails(db, A, `update transcript_segments set start_ms = 0 where id='${SEG}'`)).toBe(true)
    expect(await fails(db, A, `update transcript_segments set meeting_id = '${MEETING}' where id='${SEG}'`)).toBe(true)
    // ...and the trigger would undo it even if a grant were ever widened
    await db.exec(`grant update on transcript_segments to authenticated`)
    await asUser(db, A, `update transcript_segments set text = 'x', original_text = 'forged', edited_at = '2000-01-01', start_ms = 0, end_ms = 1 where id='${SEG}'`)
    const r = await row(db)
    expect(r.original_text).toBe('Prya will send the report')
    expect(new Date(r.edited_at!).getFullYear()).toBeGreaterThan(2000)
    expect([r.start_ms, r.end_ms]).toEqual([1000, 4000])
  })

  it('rejects empty and oversized lines', async () => {
    const db = await setup()
    expect(await fails(db, A, `update transcript_segments set text = '   ' where id='${SEG}'`)).toBe(true)
    expect(await fails(db, A, `update transcript_segments set text = repeat('a', 4001) where id='${SEG}'`)).toBe(true)
    expect((await row(db)).text).toBe('Prya will send the report')
    await asUser(db, A, `update transcript_segments set text = repeat('a', 4000) where id='${SEG}'`) // the limit itself is fine
  })

  it('only the meeting\'s owner, and only while approved, can edit', async () => {
    const db = await setup()
    await asUser(db, B, `update transcript_segments set text = 'hacked' where id='${SEG}'`)
    expect((await row(db)).text).toBe('Prya will send the report') // RLS: zero rows touched
    await db.exec(`update profiles set status='rejected' where id='${A}'`)
    await asUser(db, A, `update transcript_segments set text = 'late edit' where id='${SEG}'`)
    expect((await row(db)).text).toBe('Prya will send the report') // revoked users are locked out
  })

  it('users cannot rewrite the notes\' bookkeeping, only the summary and decisions', async () => {
    const db = await setup()
    await db.exec(`insert into meeting_notes(meeting_id,summary,generated_at) values ('${MEETING}','s','2026-01-01')`)
    await asUser(db, A, `update meeting_notes set summary = 'edited' where meeting_id='${MEETING}'`)
    expect(await fails(db, A, `update meeting_notes set generated_at = now() where meeting_id='${MEETING}'`)).toBe(true)
    expect(await fails(db, A, `update meeting_notes set raw_llm_output = '{}'::jsonb where meeting_id='${MEETING}'`)).toBe(true)
  })

  it('the scheduler can continue a notes-only regeneration after the audio was deleted', async () => {
    const db = await setup()
    await db.exec(`update meetings set status='summarising', audio_parts='[]'::jsonb, processed_parts=3, created_at=now()-interval '10 minutes' where id='${MEETING}'`)
    const ids = (await db.query<{ id: string }>(`select id from pending_processing_ids(5)`)).rows.map((r) => r.id)
    expect(ids).toEqual([MEETING])
    await db.exec(`update meetings set processed_parts=0 where id='${MEETING}'`) // never transcribed and no audio: nothing to do
    expect((await db.query(`select id from pending_processing_ids(5)`)).rows).toHaveLength(0)
  })
})
