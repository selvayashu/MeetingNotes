/**
 * Constant-time string comparison. Both values are hashed first, so the comparison always touches the same
 * number of bytes whatever the lengths, and a mismatch reveals nothing about how much of the secret was right.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const x = new Uint8Array(ha)
  const y = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

/** True only when a non-empty secret is configured and the caller presented exactly that secret. */
export async function isCronCaller(presented: string | null, configured: string | undefined): Promise<boolean> {
  if (!presented || !configured) return false
  return safeEqual(presented, configured)
}
