import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface Profile {
  status: ApprovalStatus
  is_admin: boolean
}

/** The signed-in user's approval state. `refresh` re-reads it (used by the "waiting" screen). */
export function useProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!userId) return
    const { data, error } = await supabase
      .from('profiles')
      .select('status,is_admin')
      .eq('id', userId)
      .maybeSingle()
    if (error) setError(error.message)
    else {
      setError(null)
      // A missing row (trigger not yet run) is treated as pending, never as approved.
      setProfile(data ? (data as Profile) : { status: 'pending', is_admin: false })
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Pick up an approval granted while this tab was open, as soon as the user comes back to it.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  return { profile, loading, error, refresh }
}
