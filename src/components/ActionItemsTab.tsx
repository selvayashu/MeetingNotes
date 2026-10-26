import { useState } from 'react'
import { useI18n } from '../i18n/context'
import { supabase } from '../lib/supabase'
import type { ActionItem } from '../lib/types'

const small =
  'rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900'

interface Props {
  meetingId: string
  items: ActionItem[]
  onChange: (items: ActionItem[]) => void
}

export default function ActionItemsTab({ meetingId, items, onChange }: Props) {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [newTask, setNewTask] = useState('')

  async function update(id: string, patch: Partial<Omit<ActionItem, 'id'>>) {
    const before = items
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i))) // optimistic
    const { error } = await supabase.from('action_items').update(patch).eq('id', id)
    if (error) {
      onChange(before)
      setError(error.message)
    } else setError(null)
  }

  async function remove(id: string) {
    const before = items
    onChange(items.filter((i) => i.id !== id))
    const { error } = await supabase.from('action_items').delete().eq('id', id)
    if (error) {
      onChange(before)
      setError(error.message)
    }
  }

  async function add() {
    const task = newTask.trim()
    if (!task) return
    const { data, error } = await supabase
      .from('action_items')
      .insert({ meeting_id: meetingId, task })
      .select('id,task,owner,due_date,is_done')
      .single()
    if (error) return setError(error.message)
    onChange([...items, data as ActionItem])
    setNewTask('')
    setError(null)
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && <p className="text-slate-500 dark:text-slate-400">{t('actions.none')}</p>}
      <ul className="flex flex-col gap-3">
        {items.map((i) => (
          <li key={i.id} className="card p-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={i.is_done}
                onChange={(e) => update(i.id, { is_done: e.target.checked })}
                aria-label={t('actions.markDone', { task: i.task })}
                className="mt-1.5 h-5 w-5 shrink-0"
              />
              <input
                defaultValue={i.task}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (!v) e.target.value = i.task
                  else if (v !== i.task) void update(i.id, { task: v })
                }}
                aria-label={t('actions.task')}
                className={`min-w-0 flex-1 bg-transparent py-1 ${i.is_done ? 'text-slate-400 line-through' : ''}`}
              />
              <button onClick={() => remove(i.id)} aria-label={t('actions.delete', { task: i.task })} className="px-2 py-1 text-slate-400 hover:text-red-600">
                ✕
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 pl-8">
              <input
                defaultValue={i.owner ?? ''}
                placeholder={t('actions.owner')}
                aria-label={t('actions.owner')}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null
                  if (v !== i.owner) void update(i.id, { owner: v })
                }}
                className={`${small} w-32`}
              />
              <input
                type="date"
                defaultValue={i.due_date ?? ''}
                aria-label={t('actions.due')}
                onChange={(e) => update(i.id, { due_date: e.target.value || null })}
                className={small}
              />
            </div>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
        className="flex gap-2"
      >
        <input
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          placeholder={t('actions.new')}
          aria-label={t('actions.new')}
          className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
        />
        <button disabled={!newTask.trim()} className="rounded-full bg-indigo-600 px-4 font-semibold text-white disabled:opacity-50">
          {t('common.add')}
        </button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
