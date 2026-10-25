import { describe, expect, it } from 'vitest'
import { isCronCaller, safeEqual } from '../functions/lib/cron'

describe('scheduler secret check', () => {
  it('accepts only the exact secret', async () => {
    expect(await safeEqual('s3cret-value', 's3cret-value')).toBe(true)
    expect(await safeEqual('s3cret-value', 's3cret-valuE')).toBe(false)
    expect(await safeEqual('s3cret', 's3cret-value')).toBe(false) // prefix is not enough
    expect(await safeEqual('s3cret-value-and-more', 's3cret-value')).toBe(false)
    expect(await safeEqual('', 'x')).toBe(false)
  })

  it('works with non-ASCII secrets', async () => {
    expect(await safeEqual('கடவுச்சொல்-1', 'கடவுச்சொல்-1')).toBe(true)
    expect(await safeEqual('கடவுச்சொல்-1', 'கடவுச்சொல்-2')).toBe(false)
  })

  it('never authenticates when no secret is configured, even if the caller sends an empty or matching-looking value', async () => {
    expect(await isCronCaller('anything', undefined)).toBe(false)
    expect(await isCronCaller('anything', '')).toBe(false)
    expect(await isCronCaller('', '')).toBe(false)
    expect(await isCronCaller(null, 'configured')).toBe(false)
    expect(await isCronCaller('', 'configured')).toBe(false)
  })

  it('authenticates a caller presenting the configured secret', async () => {
    expect(await isCronCaller('configured', 'configured')).toBe(true)
    expect(await isCronCaller('Configured', 'configured')).toBe(false)
  })
})
