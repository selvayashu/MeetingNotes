import type { TKey } from '../i18n/translate'

interface AuthErrorLike {
  code?: string
  status?: number
  message?: string
}

/** Map a Supabase Auth error to a translated message key (never show raw server text to users). */
export function authErrorKey(err: AuthErrorLike): TKey {
  switch (err.code) {
    case 'invalid_credentials':
      return 'login.badCredentials'
    case 'user_already_exists':
    case 'email_exists':
      return 'login.alreadyExists'
    case 'weak_password':
      return 'password.rules'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'login.rateLimited'
  }
  if (err.status === 429) return 'login.rateLimited'
  // Older/other responses only carry a message.
  if (/invalid login credentials/i.test(err.message ?? '')) return 'login.badCredentials'
  if (/already registered/i.test(err.message ?? '')) return 'login.alreadyExists'
  return 'login.genericError'
}

/** True when the URL carries an expired/used e-mail-link error from Supabase. */
export function isLinkError(hashOrSearch: string): boolean {
  return /(^|[#&?])error_code=(otp_expired|access_denied)|(^|[#&?])error=access_denied/.test(hashOrSearch)
}
