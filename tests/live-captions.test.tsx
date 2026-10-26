// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LiveCaptions from '../src/components/LiveCaptions'
import { useLiveCaptions } from '../src/hooks/useLiveCaptions'
import { I18nProvider } from '../src/i18n/I18nProvider'
import {
  MAX_CAPTION_LINES,
  problemFor,
  readCaptionsPref,
  readResults,
  recognitionLang,
  saveCaptionsPref,
  trimLines,
  type SpeechEventLike,
  type SpeechRecognitionLike,
} from '../src/lib/liveCaptions'

// ---------- a stand-in for the browser's speech recognition ----------
class FakeRecognition implements SpeechRecognitionLike {
  static all: FakeRecognition[] = []
  continuous = false
  interimResults = false
  lang = ''
  onresult: SpeechRecognitionLike['onresult'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  onend: SpeechRecognitionLike['onend'] = null
  started = 0
  aborted = false
  constructor() {
    FakeRecognition.all.push(this)
  }
  start() {
    this.started++
  }
  stop() {}
  abort() {
    this.aborted = true
  }
  say(parts: { text: string; final: boolean }[], resultIndex = 0) {
    const results = parts.map((p) => ({ isFinal: p.final, 0: { transcript: p.text } }))
    this.onresult?.({ resultIndex, results: Object.assign(results, { length: results.length }) } as SpeechEventLike)
  }
}
const last = () => FakeRecognition.all[FakeRecognition.all.length - 1]

beforeEach(() => {
  FakeRecognition.all = []
  vi.useFakeTimers()
  ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
})

describe('helpers', () => {
  it('maps the spoken language to a recognition language; auto follows the interface language', () => {
    expect(recognitionLang('hi', 'en')).toBe('hi-IN')
    expect(recognitionLang('ta', 'en')).toBe('ta-IN')
    expect(recognitionLang('en', 'hi')).toBe('en-IN')
    expect(recognitionLang('auto', 'ta')).toBe('ta-IN')
    expect(recognitionLang('auto', 'en')).toBe('en-IN')
  })

  it('treats silence and our own stop as harmless, and permission/network/language as problems', () => {
    expect(problemFor('no-speech')).toBeNull()
    expect(problemFor('aborted')).toBeNull()
    expect(problemFor('not-allowed')).toBe('denied')
    expect(problemFor('service-not-allowed')).toBe('denied')
    expect(problemFor('network')).toBe('network')
    expect(problemFor('language-not-supported')).toBe('language')
    expect(problemFor('audio-capture')).toBe('unavailable')
  })

  it('splits an event into finished sentences and the changing tail, from resultIndex on', () => {
    const results = [
      { isFinal: true, 0: { transcript: ' already shown ' } },
      { isFinal: true, 0: { transcript: ' hello team ' } },
      { isFinal: false, 0: { transcript: 'and welcome' } },
      { isFinal: false, 0: { transcript: '   ' } },
    ]
    expect(readResults({ resultIndex: 1, results: Object.assign(results, { length: 4 }) })).toEqual({ finals: ['hello team'], interim: 'and welcome' })
  })

  it('keeps only the latest lines', () => {
    const many = Array.from({ length: MAX_CAPTION_LINES + 20 }, (_, i) => String(i))
    expect(trimLines(many)).toHaveLength(MAX_CAPTION_LINES)
    expect(trimLines(many).at(-1)).toBe(String(MAX_CAPTION_LINES + 19))
    expect(trimLines(['a'])).toEqual(['a'])
  })

  it('is off by default, remembers the choice, and survives blocked storage', () => {
    expect(readCaptionsPref()).toBe(false)
    saveCaptionsPref(true)
    expect(readCaptionsPref()).toBe(true)
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readCaptionsPref()).toBe(false)
    get.mockRestore()
  })
})

describe('useLiveCaptions', () => {
  const setup = (init: Partial<{ active: boolean; enabled: boolean; lang: string; resetKey: unknown }> = {}) =>
    renderHook((p) => useLiveCaptions(p), { initialProps: { active: true, enabled: true, lang: 'hi-IN', resetKey: 0, ...init } })

  it('never starts listening unless the person switched it on', () => {
    setup({ enabled: false })
    expect(FakeRecognition.all).toHaveLength(0)
  })

  it('does not start while not recording (e.g. paused or idle)', () => {
    setup({ active: false })
    expect(FakeRecognition.all).toHaveLength(0)
  })

  it('reports when the browser has no speech recognition at all', () => {
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    const { result } = setup()
    expect(result.current.supported).toBe(false)
    expect(FakeRecognition.all).toHaveLength(0)
  })

  it('listens continuously in the chosen language and shows finished lines plus the live tail', () => {
    const { result } = setup()
    expect(last()).toMatchObject({ continuous: true, interimResults: true, lang: 'hi-IN', started: 1 })
    act(() => last().say([{ text: 'नमस्ते सब लोग', final: true }, { text: 'आज की मीटिंग', final: false }]))
    expect(result.current.lines).toEqual(['नमस्ते सब लोग'])
    expect(result.current.interim).toBe('आज की मीटिंग')
    act(() => last().say([{ text: 'नमस्ते सब लोग', final: true }, { text: 'आज की मीटिंग शुरू', final: true }], 1))
    expect(result.current.lines).toEqual(['नमस्ते सब लोग', 'आज की मीटिंग शुरू'])
    expect(result.current.interim).toBe('')
  })

  it('restarts by itself when the browser ends a session after silence', () => {
    setup()
    const first = last()
    act(() => {
      vi.setSystemTime(Date.now() + 20_000) // a normal long session, not an instant failure
      first.onend?.()
      vi.advanceTimersByTime(300)
    })
    expect(FakeRecognition.all).toHaveLength(2)
    expect(last().started).toBe(1)
  })

  it('gives up with a message if sessions keep dying instantly', () => {
    const { result } = setup()
    for (let i = 0; i < 6; i++) act(() => { last().onend?.(); vi.advanceTimersByTime(300) })
    expect(result.current.problem).toBe('unavailable')
    const count = FakeRecognition.all.length
    act(() => vi.advanceTimersByTime(5000))
    expect(FakeRecognition.all).toHaveLength(count) // no endless retry loop
  })

  it('stops for good and says why when permission is refused, but ignores plain silence', () => {
    const { result } = setup()
    act(() => last().onerror?.({ error: 'no-speech' }))
    expect(result.current.problem).toBeNull()
    act(() => { last().onerror?.({ error: 'not-allowed' }); last().onend?.(); vi.advanceTimersByTime(1000) })
    expect(result.current.problem).toBe('denied')
    expect(FakeRecognition.all).toHaveLength(1)
  })

  it('stops listening when recording pauses or ends, and aborts the engine', () => {
    const { rerender } = setup()
    const r = last()
    rerender({ active: false, enabled: true, lang: 'hi-IN', resetKey: 0 })
    expect(r.aborted).toBe(true)
    act(() => vi.advanceTimersByTime(2000))
    expect(FakeRecognition.all).toHaveLength(1)
  })

  it('keeps the text across a pause but forgets it for a new recording', () => {
    const { result, rerender } = setup()
    act(() => last().say([{ text: 'first part', final: true }]))
    rerender({ active: false, enabled: true, lang: 'hi-IN', resetKey: 0 })
    expect(result.current.lines).toEqual(['first part'])
    rerender({ active: true, enabled: true, lang: 'hi-IN', resetKey: 0 })
    expect(result.current.lines).toEqual(['first part'])
    rerender({ active: true, enabled: true, lang: 'hi-IN', resetKey: 1 })
    expect(result.current.lines).toEqual([])
  })

  it('does not keep listening after the page is left', () => {
    const { unmount } = setup()
    const r = last()
    unmount()
    expect(r.aborted).toBe(true)
  })
})

describe('LiveCaptions panel', () => {
  const panel = (over: Partial<React.ComponentProps<typeof LiveCaptions>> = {}) =>
    render(
      <I18nProvider>
        <LiveCaptions supported enabled onToggle={() => {}} recording lines={[]} interim="" problem={null} {...over} />
      </I18nProvider>,
    )

  it('states the privacy trade-off right next to the switch', () => {
    panel({ enabled: false })
    expect(screen.getByText(/sends the audio to its speech service/)).toBeTruthy()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByRole('log')).toBeNull()
  })

  it('reports the choice', async () => {
    const onToggle = vi.fn()
    vi.useRealTimers()
    panel({ enabled: false, onToggle })
    await userEvent.setup().click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('shows lines and the live tail only while recording, as a quiet log', () => {
    panel({ lines: ['hello'], interim: 'and welcome' })
    const log = screen.getByRole('log')
    expect(log.getAttribute('aria-live')).toBe('off')
    expect(log.textContent).toContain('hello')
    expect(log.textContent).toContain('and welcome')
    expect(screen.getByText(/rough preview only/)).toBeTruthy()
    cleanup()
    panel({ recording: false })
    expect(screen.queryByRole('log')).toBeNull()
  })

  it('says it is listening before anything is heard, and shows a problem without alarming', () => {
    panel()
    expect(screen.getByText('Listening…')).toBeTruthy()
    cleanup()
    panel({ problem: 'network' })
    expect(screen.getByRole('alert').textContent).toContain('Recording continues normally')
    expect(screen.queryByText('Listening…')).toBeNull()
  })

  it('explains when the browser cannot do it, and offers no switch', () => {
    panel({ supported: false })
    expect(screen.getByText(/work in Chrome and Edge/)).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
