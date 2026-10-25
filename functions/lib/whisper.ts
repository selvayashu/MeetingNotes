const MODEL = '@cf/openai/whisper-large-v3-turbo'

export interface WhisperSegment {
  start: number
  end: number
  text: string
  no_speech_prob?: number
}

export interface WhisperResult {
  segments: WhisperSegment[]
  durationSeconds: number
}

// btoa on 3-byte-aligned pieces keeps peak memory low (no giant binary string).
export function toBase64(bytes: Uint8Array): string {
  const PIECE = 3 * 8192
  let out = ''
  for (let i = 0; i < bytes.length; i += PIECE) {
    out += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + PIECE) as unknown as number[]))
  }
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Transcribe one self-contained audio file. Retries transient failures. */
export async function transcribe(
  ai: Ai,
  audio: ArrayBuffer,
  language: string | undefined,
): Promise<WhisperResult> {
  const input: Record<string, unknown> = {
    audio: toBase64(new Uint8Array(audio)),
    // VAD skips silence (fewer hallucinations); no cross-segment conditioning stops loops.
    vad_filter: true,
    condition_on_previous_text: false,
  }
  if (language && language !== 'auto') input.language = language

  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = (await ai.run(MODEL as keyof AiModels, input as never)) as {
        segments?: WhisperSegment[]
        text?: string
        transcription_info?: { duration?: number }
      }
      const segments =
        out.segments && out.segments.length > 0
          ? out.segments
          : out.text?.trim()
            ? [{ start: 0, end: out.transcription_info?.duration ?? 0, text: out.text }]
            : []
      return { segments, durationSeconds: out.transcription_info?.duration ?? 0 }
    } catch (err) {
      lastErr = err
      // 3030 = undecodable audio: retrying won't help.
      if (String(err).includes('3030')) break
      await sleep(1500 * (attempt + 1))
    }
  }
  throw new Error(`Transcription failed: ${String((lastErr as Error)?.message ?? lastErr)}`)
}
