// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SupabaseClient } from '@supabase/supabase-js'

const sb = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => sb.client }))

import { onRequestPost } from '../functions/api/retention'
import { ownPaths, sweepExpiredAudio } from '../functions/lib/retention'
import RetentionSetting from '../src/components/RetentionSetting'
import { I18nProvider } from '../src/i18n/I18nProvider'

afterEach(cleanup)

interface Fake {
  rows: { id: string; user_id: string; audio_parts: { path?: unknown }[] | null }[]
  removeError?: string
  updateError?: boolean
  rpcError?: boolean
}
function fake(f: Fake) {
  const removed: string[][] = []
  const cleared: string[] = []
  const db = {
    rpc: async () => (f.rpcError ? { data: null, error: { message: 'boom' } } : { data: f.rows, error: null }),
    storage: {
      from: () => ({
        remove: async (p: string[]) => {
          removed.push(p)
          return { error: f.removeError ? { message: f.removeError } : null }
        },
      }),
    },
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (_c: string, id: string) => {
          if (!f.updateError) cleared.push(`${id}:${JSON.stringify(patch)}`)
          return { error: f.updateError ? { message: 'x' } : null }
        },
      }),
    }),
  }
  return { db: db as unknown as SupabaseClient, removed, cleared }
}
const row = (id: string, user: string, ...paths: unknown[]) => ({ id, user_id: user, audio_parts: paths.map((path) => ({ path })) })

describe('sweepExpiredAudio', () => {
  it('removes the files, then clears the meeting row, and reports counts', async () => {
    const f = fake({ rows: [row('m1', 'u1', 'u1/m1/000.wav', 'u1/m1/001.wav'), row('m2', 'u2', 'u2/m2/000.wav')] })
    expect(await sweepExpiredAudio(f.db)).toEqual({ meetings: 2, files: 3, skipped: 0 })
    expect(f.removed).toEqual([['u1/m1/000.wav', 'u1/m1/001.wav'], ['u2/m2/000.wav']])
    expect(f.cleared).toEqual(['m1:{"audio_parts":[],"audio_path":null}', 'm2:{"audio_parts":[],"audio_path":null}'])
  })

  it("never removes a path outside the owner's own folder, even if the row says so", async () => {
    const f = fake({ rows: [row('m1', 'u1', 'u2/secret.wav', 'u1/../u2/x.wav', 'u1/ok.wav', 42, undefined)] })
    await sweepExpiredAudio(f.db)
    expect(f.removed).toEqual([['u1/ok.wav']])
    expect(ownPaths(row('m', 'u1', 'u1x/a.wav'))).toEqual([]) // prefix must be "u1/", not just "u1"
  })

  it('keeps the row (to retry tomorrow) when the files could not be removed', async () => {
    const f = fake({ rows: [row('m1', 'u1', 'u1/a.wav')], removeError: 'storage down' })
    expect(await sweepExpiredAudio(f.db)).toEqual({ meetings: 0, files: 0, skipped: 1 })
    expect(f.cleared).toEqual([])
  })

  it('counts a failed row update as skipped, not done', async () => {
    const f = fake({ rows: [row('m1', 'u1', 'u1/a.wav')], updateError: true })
    expect((await sweepExpiredAudio(f.db)).skipped).toBe(1)
  })

  it('does nothing when nothing has expired, and fails loudly if the list cannot be read', async () => {
    expect(await sweepExpiredAudio(fake({ rows: [] }).db)).toEqual({ meetings: 0, files: 0, skipped: 0 })
    await expect(sweepExpiredAudio(fake({ rows: [], rpcError: true }).db)).rejects.toThrow('audio_expired failed')
  })
})

describe('POST /api/retention', () => {
  const call = (headers: Record<string, string>, secret: string | undefined = 's3cret') =>
    onRequestPost({ request: new Request('https://x/api/retention', { method: 'POST', headers }), env: { CRON_SECRET: secret, SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' } } as never)

  it('refuses anyone without the scheduler secret, including when none is configured', async () => {
    sb.client = fake({ rows: [row('m1', 'u1', 'u1/a.wav')] }).db
    expect((await call({})).status).toBe(401)
    expect((await call({ 'x-cron-secret': 'wrong' })).status).toBe(401)
    expect((await call({ 'x-cron-secret': '' }, '')).status).toBe(401)
    expect((await call({ 'x-cron-secret': 'anything' }, undefined)).status).toBe(401)
  })

  it('runs the sweep for the scheduler', async () => {
    sb.client = fake({ rows: [row('m1', 'u1', 'u1/a.wav')] }).db
    const r = await call({ 'x-cron-secret': 's3cret' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, meetings: 1, files: 1, skipped: 0 })
  })

  it('answers 500 without leaking details when the sweep fails', async () => {
    sb.client = fake({ rows: [], rpcError: true }).db
    const r = await call({ 'x-cron-secret': 's3cret' })
    expect(r.status).toBe(500)
    expect(JSON.stringify(await r.json())).not.toMatch(/boom|audio_expired/)
  })
})

describe('retention setting', () => {
  const page = (v: 7 | 30 | 90 | null | undefined, overridden = false, onChange = vi.fn()) =>
    render(<I18nProvider><RetentionSetting value={v} onChange={onChange} overridden={overridden} /></I18nProvider>)

  it('offers four choices and shows the current one', () => {
    page(30)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Until I delete them', '7 days', '30 days', '90 days'])
    expect((screen.getByLabelText('Keep audio recordings') as HTMLSelectElement).value).toBe('30')
  })

  it('reports a number, or null for "until I delete them"', async () => {
    const onChange = vi.fn()
    page(30, false, onChange)
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Keep audio recordings'), '7')
    expect(onChange).toHaveBeenLastCalledWith(7)
    await user.selectOptions(screen.getByLabelText('Keep audio recordings'), '')
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('is disabled while loading, and explains why when "delete after notes" already applies', () => {
    page(undefined)
    expect((screen.getByLabelText('Keep audio recordings') as HTMLSelectElement).disabled).toBe(true)
    cleanup()
    page(null, true)
    expect((screen.getByLabelText('Keep audio recordings') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText(/already deletes the audio sooner/)).toBeTruthy()
  })
})
