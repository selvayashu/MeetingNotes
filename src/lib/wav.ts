/**
 * Minimal PCM WAV slicing. Used on the client to cut uploaded WAV files into parts small
 * enough for one Whisper call each (the server has no ffmpeg to cut compressed formats).
 */

export interface WavInfo {
  dataOffset: number
  dataLength: number
  byteRate: number
  blockAlign: number
  format: Uint8Array // the 'fmt ' chunk body, copied into each slice header
}

export function parseWavHeader(head: ArrayBuffer, totalSize: number): WavInfo | null {
  const v = new DataView(head)
  const tag = (o: number) => String.fromCharCode(...new Uint8Array(head, o, 4))
  if (head.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null

  let pos = 12
  let fmt: { body: Uint8Array; byteRate: number; blockAlign: number } | null = null
  while (pos + 8 <= head.byteLength) {
    const id = tag(pos)
    const size = v.getUint32(pos + 4, true)
    if (id === 'fmt ') {
      if (pos + 8 + size > head.byteLength) return null
      fmt = {
        body: new Uint8Array(head.slice(pos + 8, pos + 8 + size)),
        byteRate: v.getUint32(pos + 8 + 8, true),
        blockAlign: v.getUint16(pos + 8 + 12, true),
      }
    } else if (id === 'data') {
      if (!fmt || fmt.byteRate === 0 || fmt.blockAlign === 0) return null
      const dataOffset = pos + 8
      // Streamed WAVs may declare 0 or 0xFFFFFFFF; trust the real file size then.
      const declared = size === 0 || size === 0xffffffff ? Infinity : size
      return {
        dataOffset,
        dataLength: Math.min(declared, totalSize - dataOffset),
        byteRate: fmt.byteRate,
        blockAlign: fmt.blockAlign,
        format: fmt.body,
      }
    }
    pos += 8 + size + (size % 2)
  }
  return null
}

export function buildWavHeader(info: WavInfo, dataLength: number): Uint8Array {
  const fmtSize = info.format.length
  const out = new Uint8Array(12 + 8 + fmtSize + 8)
  const v = new DataView(out.buffer)
  const put = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)))
  put(0, 'RIFF')
  v.setUint32(4, 4 + 8 + fmtSize + 8 + dataLength, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  v.setUint32(16, fmtSize, true)
  out.set(info.format, 20)
  put(20 + fmtSize, 'data')
  v.setUint32(24 + fmtSize, dataLength, true)
  return out
}

export interface WavSlice {
  blob: Blob
  durationSeconds: number
}

/** Cut into slices of at most `maxSeconds` and `maxBytes` of audio, aligned to sample frames. */
export function sliceWav(
  file: Blob,
  info: WavInfo,
  maxSeconds: number,
  maxBytes: number,
): WavSlice[] {
  const perSlice = Math.max(
    info.blockAlign,
    Math.floor(Math.min(maxSeconds * info.byteRate, maxBytes) / info.blockAlign) * info.blockAlign,
  )
  const slices: WavSlice[] = []
  for (let off = 0; off < info.dataLength; off += perSlice) {
    const len = Math.min(perSlice, info.dataLength - off)
    const start = info.dataOffset + off
    slices.push({
      blob: new Blob([buildWavHeader(info, len) as BlobPart, file.slice(start, start + len)], {
        type: 'audio/wav',
      }),
      durationSeconds: len / info.byteRate,
    })
  }
  return slices
}
