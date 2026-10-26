import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/context'
import type { TKey } from '../i18n/translate'
import { supabase } from '../lib/supabase'

type Status = 'pending' | 'approved' | 'rejected'

interface UserRow {
  id: string
  email: string
  full_name: string | null
  status: Status
  is_admin: boolean
  created_at: string
}

const SECTIONS: { status: Status; title: TKey }[] = [
  { status: 'pending', title: 'admin.pending' },
  { status: 'approved', title: 'admin.approved' },
  { status: 'rejected', title: 'admin.rejected' },
]

export default function Admin() {
  const { t, lang } = useI18n()
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_users')
    if (error) setError(error.message)
    else {
      setError(null)
      setUsers(data as UserRow[])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function setStatus(id: string, status: Status) {
    setBusyId(id)
    const { error } = await supabase.rpc('admin_set_status', { target: id, new_status: status })
    setBusyId(null)
    if (error) return setError(t('admin.error'))
    await load()
  }

  const btn = 'rounded-2xl px-3 py-2 text-sm font-semibold disabled:opacity-60'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t('admin.title')}</h2>
        <div className="flex gap-4 text-sm text-indigo-600 underline dark:text-indigo-400">
          <Link to="/admin/usage">{t('admin.usageLink')}</Link>
          <Link to="/">{t('detail.back')}</Link>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!users && !error && <p className="text-slate-500 dark:text-slate-400">{t('common.loading')}</p>}

      {users &&
        SECTIONS.map(({ status, title }) => {
          const rows = users.filter((u) => u.status === status)
          return (
            <section key={status} aria-label={t(title)} className="card p-4">
              <h3 className="mb-2 font-semibold">
                {t(title)} <span className="text-slate-500 dark:text-slate-400">({rows.length})</span>
              </h3>
              {rows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('admin.none')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {rows.map((u) => (
                    <li key={u.id} className="flex flex-wrap items-center gap-3 card p-3">
                      <div className="min-w-0 flex-1">
                        {u.full_name && <p className="truncate font-medium">{u.full_name}</p>}
                        <p className={`truncate ${u.full_name ? 'text-sm text-slate-600 dark:text-slate-300' : 'font-medium'}`}>
                          {u.email}
                          {u.is_admin && (
                            <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
                              {t('admin.adminBadge')}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {t('admin.joined', { date: new Date(u.created_at).toLocaleDateString(lang) })}
                        </p>
                      </div>
                      {!u.is_admin && (
                        <div className="flex gap-2">
                          {status !== 'approved' && (
                            <button
                              disabled={busyId === u.id}
                              onClick={() => setStatus(u.id, 'approved')}
                              className={`${btn} bg-emerald-600 text-white`}
                            >
                              {t('admin.approve')}
                            </button>
                          )}
                          {status === 'pending' && (
                            <button
                              disabled={busyId === u.id}
                              onClick={() => setStatus(u.id, 'rejected')}
                              className={`${btn} border border-slate-300 dark:border-slate-700`}
                            >
                              {t('admin.reject')}
                            </button>
                          )}
                          {status === 'approved' && (
                            <button
                              disabled={busyId === u.id}
                              onClick={() => setStatus(u.id, 'rejected')}
                              className={`${btn} border border-red-300 text-red-700 dark:border-red-800 dark:text-red-300`}
                            >
                              {t('admin.revoke')}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
    </div>
  )
}
