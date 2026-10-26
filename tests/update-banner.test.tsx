// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const pwa = vi.hoisted(() => ({ ready: null as null | ((h: { apply: () => Promise<void> }) => void) }))
vi.mock('../src/lib/pwa', () => ({ watchForUpdate: (cb: (h: { apply: () => Promise<void> }) => void) => { pwa.ready = cb } }))

import UpdateBanner from '../src/components/UpdateBanner'
import { I18nProvider } from '../src/i18n/I18nProvider'
import { act } from 'react'

afterEach(cleanup)

describe('update banner', () => {
  it('is hidden until a new version is ready, then applies it only when asked', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    render(<I18nProvider><UpdateBanner /></I18nProvider>)
    expect(screen.queryByRole('status')).toBeNull()
    act(() => pwa.ready!({ apply }))
    expect(screen.getByRole('status').textContent).toContain('A new version of MeetNotes is ready.')
    expect(apply).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Update' }))
    expect(apply).toHaveBeenCalledOnce()
  })
  it('"Later" dismisses it without updating', async () => {
    const apply = vi.fn()
    render(<I18nProvider><UpdateBanner /></I18nProvider>)
    act(() => pwa.ready!({ apply }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(apply).not.toHaveBeenCalled()
  })
})
