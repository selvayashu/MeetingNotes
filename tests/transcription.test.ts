import { describe, expect, it } from 'vitest'
import { buildWavHeader, parseWavHeader, sliceWav, type WavInfo } from '../src/lib/wav'
import { partOffsetMs, toSegmentRows } from '../functions/lib/segments'
import { toBase64 } from '../functions/lib/whisper'

function makeWav(seconds: number, rate = 16000, channels = 1): Blob {
  const blockAlign = 2 * channels
  const dataLen = seconds * rate * blockAlign
  const info: WavInfo = {
    dataOffset: 0,
    dataLength: dataLen,
    byteRate: rate * blockAlign,
    blockAlign,
    format: new Uint8Array(16),
  }
  const fmt = new DataView(info.format.buffer)
  fmt.setUint16(0, 1, true)
  fmt.setUint16(2, channels, true)
  fmt.setUint32(4, rate, true)
  fmt.setUint32(8, info.byteRate, true)
  fmt.setUint16(12, blockAlign, true)
  fmt.setUint16(14, 16, true)
  const pcm = new Uint8Array(dataLen)
  for (let i = 0; i < dataLen; i++) pcm[i] = i % 251
  return new Blob([buildWavHeader(info, dataLen) as BlobPart, pcm])
}

describe('wav slicing', () => {
  it('parses a header it built', async () => {
    const wav = makeWav(10)
    const info = parseWavHeader(await wav.slice(0, 65536).arrayBuffer(), wav.size)
    expect(info).toMatchObject({ dataOffset: 44, dataLength: 320000, byteRate: 32000, blockAlign: 2 })
  })

  it('rejects non-wav data', () => {
    expect(parseWavHeader(new TextEncoder().encode('not a wav file at all').buffer as ArrayBuffer, 21)).toBeNull()
  })

  it('splits by duration, covers all audio, keeps frame alignment', async () => {
    const wav = makeWav(70)
    const info = parseWavHeader(await wav.slice(0, 65536).arrayBuffer(), wav.size)!
    const slices = sliceWav(wav, info, 30, 100 * 1024 * 1024)
    expect(slices.map((s) => s.durationSeconds)).toEqual([30, 30, 10])

    // Reassembled slice PCM equals the original PCM, and every slice is a valid WAV.
    const original = new Uint8Array(await wav.slice(44).arrayBuffer())
    let pos = 0
    for (const s of slices) {
      const bytes = new Uint8Array(await s.blob.arrayBuffer())
      const si = parseWavHeader(bytes.buffer.slice(0, 65536), bytes.length)!
      expect(si.dataLength).toBe(bytes.length - 44)
      const pcm = bytes.subarray(44)
      expect(Buffer.from(pcm).equals(Buffer.from(original.subarray(pos, pos + pcm.length)))).toBe(true)
      pos += pcm.length
    }
    expect(pos).toBe(original.length)
  })

  it('caps slices by bytes for high-bitrate audio (44.1k stereo)', async () => {
    const wav = makeWav(20, 44100, 2)
    const info = parseWavHeader(await wav.slice(0, 65536).arrayBuffer(), wav.size)!
    const slices = sliceWav(wav, info, 300, 1024 * 1024)
    for (const s of slices) expect(s.blob.size).toBeLessThanOrEqual(1024 * 1024 + 44)
    expect(slices.reduce((t, s) => t + s.durationSeconds, 0)).toBeCloseTo(20, 3)
  })
})

describe('timeline stitching', () => {
  it('shifts segments by the part offset and drops empty text', () => {
    const rows = toSegmentRows('m1', 300000, [
      { start: 0, end: 4.88, text: ' Hello there. ' },
      { start: 5, end: 6, text: '   ' },
      { start: 10.5, end: 10.2, text: 'odd' },
    ])
    expect(rows).toEqual([
      { meeting_id: 'm1', start_ms: 300000, end_ms: 304880, text: 'Hello there.' },
      { meeting_id: 'm1', start_ms: 310500, end_ms: 310500, text: 'odd' },
    ])
  })

  it('prefers real part durations over client estimates', () => {
    const parts = [
      { duration_seconds: 300, actual_ms: 300420 },
      { duration_seconds: 300 },
      { duration_seconds: 120 },
    ]
    expect(partOffsetMs(parts, 0)).toBe(0)
    expect(partOffsetMs(parts, 1)).toBe(300420)
    expect(partOffsetMs(parts, 2)).toBe(600420)
  })
})

describe('base64', () => {
  it('matches Buffer for sizes around the piece boundary', () => {
    for (const n of [0, 1, 2, 3, 24575, 24576, 24577, 100000]) {
      const b = new Uint8Array(n).map((_, i) => (i * 7) % 256)
      expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'))
    }
  })
})
