// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => {
  const makeRec = (over: Record<string, unknown> = {}) => ({
    state: 'idle', elapsed: 0, level: 0, error: null, result: null,
    start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), reset: vi.fn(),
    getDraftId: () => null, discardDraft: vi.fn(async () => {}),
    ...over,
  })
  return { makeRec, rec: makeRec(), navigate: vi.fn(), submit: vi.fn() }
})

vi.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@x.co' } }) }))
vi.mock('../src/hooks/useRecorder', () => ({ useRecorder: () => h.rec }))
vi.mock('../src/hooks/useDraftRecovery', () => ({ useDraftRecovery: () => ({ found: null, refresh: vi.fn() }) }))
vi.mock('../src/lib/drafts', () => ({ deleteDraft: vi.fn(), loadDraftParts: vi.fn() })) // IndexedDB does not exist in jsdom
vi.mock('../src/lib/upload', () => ({ submitRecording: (...a: unknown[]) => h.submit(...a) }))
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => h.navigate }))
vi.mock('../src/lib/audio', async (orig) => ({
  ...(await orig<typeof import('../src/lib/audio')>()),
  partsFromFile: vi.fn(async (f: File) => [{ blob: f, durationSeconds: 30, fileName: f.name }]),
}))

import Record from '../src/pages/Record'
import { I18nProvider } from '../src/i18n/I18nProvider'

const ui = () => (
  <I18nProvider>
    <Record />
  </I18nProvider>
)
const consentBox = () => screen.getByRole('checkbox', { name: /everyone who can be heard has been told/i }) as HTMLInputElement
const recButton = () => screen.getByRole('button', { name: 'Start recording' }) as HTMLButtonElement
const stoppedRec = () =>
  h.makeRec({ state: 'stopped', result: { parts: [{ blob: new Blob(['x']), durationSeconds: 60 }], durationSeconds: 60 } })

beforeEach(() => {
  localStorage.clear()
  h.rec = h.makeRec()
  h.navigate.mockReset()
  h.submit.mockReset()
  h.submit.mockResolvedValue({ id: 'm1', queued: false })
})
afterEach(cleanup)

describe('consent before recording', () => {
  it('will not start recording until consent is confirmed', async () => {
    const user = userEvent.setup()
    render(ui())
    expect(consentBox().checked).toBe(false)
    expect(recButton().disabled).toBe(true)
    expect(screen.getByText('Please confirm consent first.')).toBeTruthy()

    await user.click(consentBox())
    expect(recButton().disabled).toBe(false)
    await user.click(recButton())
    expect(h.rec.start).toHaveBeenCalledTimes(1)
  })

  it('says plainly that this is a reminder and not legal advice', () => {
    render(ui())
    expect(screen.getByText(/differ by country and state/i)).toBeTruthy()
    expect(screen.getByText(/not legal advice/i)).toBeTruthy()
  })

  it('shows a recording banner and locks the checkbox while recording', () => {
    h.rec = h.makeRec({ state: 'recording', elapsed: 5 })
    render(ui())
    expect(screen.getByText('Recording in progress')).toBeTruthy()
    expect(consentBox().disabled).toBe(true)
  })
})

describe('notice for participants', () => {
  it('opens full screen, can be switched to Hindi and Tamil, and closes with Esc', async () => {
    const user = userEvent.setup()
    render(ui())
    await user.click(screen.getByRole('button', { name: 'Show notice to participants' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('This meeting is being recorded')

    await user.click(screen.getByRole('button', { name: 'हिन्दी' }))
    expect(screen.getByRole('dialog').textContent).toContain('इस बैठक की रिकॉर्डिंग हो रही है')
    await user.click(screen.getByRole('button', { name: 'தமிழ்' }))
    expect(screen.getByRole('dialog').textContent).toContain('இந்தக் கூட்டம் பதிவு செய்யப்படுகிறது')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('follows the spoken language chosen for the meeting, regardless of the app language', async () => {
    localStorage.setItem('meetnotes.spokenLanguage', 'ta')
    const user = userEvent.setup()
    render(ui())
    await user.click(screen.getByRole('button', { name: 'Show notice to participants' }))
    expect(screen.getByRole('dialog').textContent).toContain('இந்தக் கூட்டம் பதிவு செய்யப்படுகிறது')
  })

  it('can copy the text, and the recording keeps going while it is open', async () => {
    h.rec = h.makeRec({ state: 'recording' })
    const user = userEvent.setup() // installs its own clipboard stand-in, so ours must come after
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(ui())
    await user.click(screen.getByRole('button', { name: 'Show notice to participants' }))
    await user.click(screen.getByRole('button', { name: 'Copy text' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('This meeting is being recorded'))
    expect(h.rec.stop).not.toHaveBeenCalled()
    expect(h.rec.pause).not.toHaveBeenCalled()
  })
})

describe('consent travels with the recording', () => {
  it('cannot save a recording without consent, and sends consent: true when saving with it', async () => {
    h.rec = stoppedRec()
    const user = userEvent.setup()
    render(ui())
    const save = screen.getByRole('button', { name: 'Save meeting' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(h.submit).not.toHaveBeenCalled()

    await user.click(consentBox())
    expect(save.disabled).toBe(false)
    await user.click(save)
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1))
    expect(h.submit.mock.calls[0][0]).toMatchObject({ userId: 'u1', consent: true })
    expect(h.navigate).toHaveBeenCalledWith('/?process=m1')
  })

  it('asks again for the next recording (consent is not remembered)', async () => {
    h.submit.mockResolvedValue({ id: 'm2', queued: true }) // offline: the page stays open
    h.rec = stoppedRec()
    const user = userEvent.setup()
    render(ui())
    await user.click(consentBox())
    await user.click(screen.getByRole('button', { name: 'Save meeting' }))
    await waitFor(() => expect(h.submit).toHaveBeenCalled())
    await waitFor(() => expect(consentBox().checked).toBe(false))
  })

  it('discarding a recording also clears the confirmation', async () => {
    h.rec = stoppedRec()
    const user = userEvent.setup()
    render(ui())
    await user.click(consentBox())
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(consentBox().checked).toBe(false)
  })

  it('an uploaded file needs the same confirmation before it can be saved', async () => {
    const user = userEvent.setup()
    const { container } = render(ui())
    const file = new File([new Uint8Array(10)], 'standup.mp3', { type: 'audio/mpeg' })
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file)

    const save = await screen.findByRole('button', { name: 'Save meeting' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    await user.click(consentBox())
    await user.click(save)
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1))
    expect(h.submit.mock.calls[0][0]).toMatchObject({ consent: true, title: 'standup' })
  })
})
