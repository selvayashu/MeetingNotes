// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Diagnostics from '../src/components/Diagnostics'
import { I18nProvider } from '../src/i18n/I18nProvider'
import { collectDiagnostics, formatDiagnostics, testRecording } from '../src/lib/diagnostics'

// ---- fakes for the recording APIs jsdom does not have ----
class FakeRecorder {
  static supported = true
  static chunks = 3
  static isTypeSupported = (t: string) => FakeRecorder.supported && t === 'audio/mp4'
  mimeType = 'audio/mp4'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(public stream: unknown, public opts?: { mimeType?: string }) {}
  start() {
    for (let i = 0; i < FakeRecorder.chunks; i++) this.ondataavailable?.({ data: new Blob([new Uint8Array(4000)]) })
  }
  stop() {
    setTimeout(() => this.onstop?.(), 0)
  }
}
let playable = true
class FakeAudio {
  onloadedmetadata: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_v: string) {
    setTimeout(() => (playable ? this.onloadedmetadata?.() : this.onerror?.()), 0)
  }
}
const track = { stop: vi.fn() }

beforeEach(() => {
  FakeRecorder.supported = true
  FakeRecorder.chunks = 3
  playable = true
  track.stop.mockClear()
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('Audio', FakeAudio)
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('collectDiagnostics', () => {
  it('reports what the browser can do and never throws, even with most APIs missing', async () => {
    const rows = await collectDiagnostics()
    const by = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(by['Can record audio (MediaRecorder)']).toBe('yes')
    expect(by['Recording format used']).toBe('audio/mp4')
    expect(by['Microphone permission']).toMatch(/unknown/) // jsdom has no Permissions API
    expect(by['Installed app (standalone)']).toBe('no')
    expect(by['App version']).toMatch(/^dev, built/)
    expect(by['Screen']).toMatch(/px, pixel ratio/)
    expect(rows.every((r) => r.value.length > 0)).toBe(true)
  })

  it('says so when recording is not supported at all', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    const by = Object.fromEntries((await collectDiagnostics()).map((r) => [r.label, r.value]))
    expect(by['Can record audio (MediaRecorder)']).toBe('no')
    expect(by['Recording format used']).toBe('none supported')
  })

  it('formats a paste-able report', () => {
    const text = formatDiagnostics([{ label: 'A', value: '1' }], [{ label: 'B', value: '2' }])
    expect(text).toBe('MeetNotes diagnostics\nA: 1\nB: 2')
  })
})

describe('testRecording', () => {
  it('passes when audio arrives and plays back, and always releases the microphone', async () => {
    const r = await testRecording(0)
    expect(r.ok).toBe(true)
    expect(r.rows).toEqual(expect.arrayContaining([{ label: 'Chunks received', value: '3' }, { label: 'Plays back', value: 'yes' }]))
    expect(track.stop).toHaveBeenCalled()
  })

  it('fails clearly when nothing was recorded', async () => {
    FakeRecorder.chunks = 0
    const r = await testRecording(0)
    expect(r).toMatchObject({ ok: false })
    expect(r.summary).toMatch(/no audio was recorded/)
    expect(track.stop).toHaveBeenCalled()
  })

  it('fails clearly when the recording cannot be played back (an iPhone-style codec problem)', async () => {
    playable = false
    const r = await testRecording(0)
    expect(r.ok).toBe(false)
    expect(r.summary).toMatch(/could not play it back/)
  })

  it.each([
    ['NotAllowedError', /permission was refused/],
    ['NotFoundError', /No microphone/],
    ['NotReadableError', /busy/],
    ['SomethingElse', /failed \(SomethingElse\)/],
  ])('explains %s in plain words', async (name, re) => {
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('x'), { name }))
    const r = await testRecording(0)
    expect(r.ok).toBe(false)
    expect(r.summary).toMatch(re)
  })

  it('reports an unsupported browser without trying', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    expect((await testRecording(0)).summary).toMatch(/cannot record audio/)
  })
})

describe('Diagnostics panel', () => {
  const page = () => render(<I18nProvider><Diagnostics /></I18nProvider>)

  it('loads the device facts only when opened', async () => {
    page()
    expect(screen.queryByText('Can record audio (MediaRecorder)')).toBeNull()
    await userEvent.setup().click(screen.getByText('Diagnostics (for bug reports)'))
    expect(await screen.findByText('Can record audio (MediaRecorder)')).toBeTruthy()
  })

  it('runs the recording test and shows the result', async () => {
    const user = userEvent.setup()
    page()
    await user.click(screen.getByText('Diagnostics (for bug reports)'))
    FakeRecorder.chunks = 0
    await user.click(screen.getByRole('button', { name: 'Test recording (3 seconds)' }))
    expect(await screen.findByText(/no audio was recorded/, undefined, { timeout: 6000 })).toBeTruthy()
  })

  it('copies the report including the test result', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup() // user-event installs its own clipboard, so ours goes in afterwards
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } })
    page()
    await user.click(screen.getByText('Diagnostics (for bug reports)'))
    await screen.findByText('Can record audio (MediaRecorder)')
    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }))
    await waitFor(() => expect(write).toHaveBeenCalled())
    expect(write.mock.calls[0][0]).toContain('MeetNotes diagnostics')
    expect(write.mock.calls[0][0]).toContain('Recording format used: audio/mp4')
    expect(await screen.findByText('Copied.')).toBeTruthy()
  })

  it('says when copying is not possible', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('no')) } })
    page()
    await user.click(screen.getByText('Diagnostics (for bug reports)'))
    await screen.findByText('Can record audio (MediaRecorder)')
    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }))
    expect(await screen.findByText(/Could not copy/)).toBeTruthy()
  })
})
