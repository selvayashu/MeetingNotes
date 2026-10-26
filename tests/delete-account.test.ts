import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DeleteError, deleteAccount, listUserObjects } from '../functions/lib/deleteAccount'

interface Fake {
  /** folder path -> entries; an entry with id null is a sub-folder */
  tree: Record<string, { name: string; id: string | null }[]>
  isAdmin?: boolean
  otherAdmins?: number
  removeError?: string
  deleteError?: string
  listError?: string
}

function fake(f: Fake) {
  const order: string[] = []
  const removed: string[] = []
  const deleteUser = vi.fn(async () => {
    order.push('deleteUser')
    return { error: f.deleteError ? { message: f.deleteError } : null }
  })
  const db = {
    from: (table: string) => {
      expect(table).toBe('profiles')
      let head = false
      const b: Record<string, unknown> = {
        select: (_c: string, o?: { head?: boolean }) => ((head = !!o?.head), b),
        eq: () => b,
        neq: () => b,
        maybeSingle: async () => ({ data: { is_admin: !!f.isAdmin }, error: null }),
        then: (res: (v: unknown) => unknown) => res({ count: head ? (f.otherAdmins ?? 0) : null, error: null }),
      }
      return b
    },
    storage: {
      from: () => ({
        list: async (prefix: string) => ({ data: f.listError ? null : f.tree[prefix] ?? [], error: f.listError ? { message: f.listError } : null }),
        remove: async (paths: string[]) => {
          order.push('remove')
          if (f.removeError) return { error: { message: f.removeError } }
          removed.push(...paths)
          return { error: null }
        },
      }),
    },
    auth: { admin: { deleteUser } },
  }
  return { db: db as unknown as SupabaseClient, order, removed, deleteUser }
}

const user = { id: 'u1', email: 'Ann@Example.com' }
const tree = {
  u1: [{ name: 'm1', id: null }, { name: 'orphan.wav', id: 'o1' }],
  'u1/m1': [{ name: '000.wav', id: 'a' }, { name: '001.wav', id: 'b' }],
}

describe('listUserObjects', () => {
  it('finds files in meeting folders and loose files, but ignores nothing', async () => {
    const { db } = fake({ tree })
    expect((await listUserObjects(db, 'u1')).sort()).toEqual(['u1/m1/000.wav', 'u1/m1/001.wav', 'u1/orphan.wav'])
  })
  it('reports a listing failure instead of silently deleting less', async () => {
    const { db } = fake({ tree, listError: 'boom' })
    await expect(listUserObjects(db, 'u1')).rejects.toBeInstanceOf(DeleteError)
  })
})

describe('deleteAccount', () => {
  it('needs the e-mail typed correctly (any letter case) and touches nothing otherwise', async () => {
    for (const bad of [undefined, '', 'someone@else.com', 42]) {
      const f = fake({ tree })
      await expect(deleteAccount(f.db, user, bad)).rejects.toMatchObject({ status: 400 })
      expect(f.order).toEqual([])
    }
    const f = fake({ tree })
    await expect(deleteAccount(f.db, user, '  ann@example.COM ')).resolves.toEqual({ deletedRecordings: 3 })
  })

  it('removes the recordings before the account, then the account', async () => {
    const f = fake({ tree })
    await deleteAccount(f.db, user, 'ann@example.com')
    expect(f.order).toEqual(['remove', 'deleteUser'])
    expect(f.removed.sort()).toEqual(['u1/m1/000.wav', 'u1/m1/001.wav', 'u1/orphan.wav'])
    expect(f.deleteUser).toHaveBeenCalledWith('u1')
  })

  it('keeps the account if recordings could not be removed, so it can be retried', async () => {
    const f = fake({ tree, removeError: 'storage down' })
    await expect(deleteAccount(f.db, user, 'ann@example.com')).rejects.toMatchObject({ status: 500 })
    expect(f.deleteUser).not.toHaveBeenCalled()
  })

  it('works for an account with no recordings', async () => {
    const f = fake({ tree: {} })
    await expect(deleteAccount(f.db, user, 'ann@example.com')).resolves.toEqual({ deletedRecordings: 0 })
    expect(f.order).toEqual(['deleteUser'])
  })

  it('refuses to delete the only administrator, but allows it when another exists', async () => {
    const only = fake({ tree, isAdmin: true, otherAdmins: 0 })
    await expect(deleteAccount(only.db, user, 'ann@example.com')).rejects.toMatchObject({ status: 409 })
    expect(only.order).toEqual([])
    const shared = fake({ tree, isAdmin: true, otherAdmins: 1 })
    await expect(deleteAccount(shared.db, user, 'ann@example.com')).resolves.toBeTruthy()
  })

  it('reports a failure to delete the account itself', async () => {
    const f = fake({ tree, deleteError: 'nope' })
    await expect(deleteAccount(f.db, user, 'ann@example.com')).rejects.toMatchObject({ status: 500 })
  })
})
