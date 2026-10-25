/** Must match the server rule in supabase/config.toml (minimum_password_length + letters_digits). */
export const MIN_PASSWORD_LENGTH = 8

export function isStrongEnough(password: string): boolean {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    /\p{L}/u.test(password) && // at least one letter (any script)
    /\d/.test(password)
  )
}
