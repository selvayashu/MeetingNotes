// Shared helpers for the accuracy experiments: FLEURS clips (cached on disk), WER/CER, calls to the bench worker.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

export const CACHE = path.join(os.tmpdir(), 'meetnotes-asr-experiments')
export const ENDPOINT = 'http://127.0.0.1:8799'
const BASE = 'https://huggingface.co/datasets/google/fleurs/resolve/main/data'
fs.mkdirSync(CACHE, { recursive: true })

export const normalize = (s) => s.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/g, ' ').trim()
export function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}
const words = (s) => (s ? s.split(' ') : [])
const chars = (s) => Array.from(s.replace(/ /g, ''))
export function score(pairs) {
  let we = 0, wn = 0, ce = 0, cn = 0
  for (const { ref, hyp } of pairs) {
    const r = normalize(ref), h = normalize(hyp)
    we += editDistance(words(r), words(h)); wn += words(r).length
    ce += editDistance(chars(r), chars(h)); cn += chars(r).length
  }
  return { wer: we / wn, cer: ce / cn }
}
export const pct = (x) => (x * 100).toFixed(1) + '%'

function untar(buf, max) {
  const out = []
  let off = 0
  while (off + 512 <= buf.length && out.length < max) {
    const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/, '')
    if (!name) break
    const size = parseInt(buf.toString('ascii', off + 124, off + 136).replace(/\0.*$/, '').trim() || '0', 8)
    const start = off + 512
    if (start + size > buf.length) break
    if (buf[off + 156] === 0x30 || buf[off + 156] === 0) out.push({ name: name.split('/').pop(), data: buf.subarray(start, start + size) })
    off = start + Math.ceil(size / 512) * 512
  }
  return out
}

/** The first `n` FLEURS test clips of a language, with references; cached so every variant sees the same audio. */
export async function clips(cfg, n = 20) {
  const dir = path.join(CACHE, cfg)
  const index = path.join(dir, 'index.json')
  if (fs.existsSync(index)) {
    return JSON.parse(fs.readFileSync(index, 'utf8')).slice(0, n).map((c) => ({ ...c, data: fs.readFileSync(path.join(dir, c.name)) }))
  }
  fs.mkdirSync(dir, { recursive: true })
  const tsvText = await (await fetch(`${BASE}/${cfg}/test.tsv`)).text()
  const tsv = new Map()
  for (const line of tsvText.split('\n')) {
    const c = line.split('\t')
    if (c.length >= 4) tsv.set(c[1], { raw: c[2], ref: c[3] })
  }
  const res = await fetch(`${BASE}/${cfg}/audio/test.tar.gz`, { headers: { Range: `bytes=0-${16 * 1024 * 1024 - 1}` } })
  const tar = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()), { finishFlush: zlib.constants.Z_SYNC_FLUSH })
  const list = untar(tar, 80).filter((f) => f.name.endsWith('.wav') && tsv.has(f.name)).slice(0, 40)
  const meta = list.map((f) => ({ name: f.name, ...tsv.get(f.name) }))
  list.forEach((f) => fs.writeFileSync(path.join(dir, f.name), f.data))
  fs.writeFileSync(index, JSON.stringify(meta))
  return meta.slice(0, n).map((m, i) => ({ ...m, data: list[i].data }))
}

export async function asr(wav, { lang = '', model = '', opts = null } = {}) {
  const q = new URLSearchParams()
  if (lang) q.set('lang', lang)
  if (model) q.set('model', model)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${ENDPOINT}/?${q}`, { method: 'POST', body: wav, headers: opts ? { 'x-opts': encodeURIComponent(JSON.stringify(opts)) } : {} })
      const j = await r.json()
      if (j.ok) return j
      if (attempt === 2) return { ok: false, error: j.error, text: '' }
    } catch (e) {
      if (attempt === 2) return { ok: false, error: String(e), text: '' }
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
  }
}

export async function llm(messages, model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast', max_tokens = 600) {
  const r = await fetch(`${ENDPOINT}/llm`, { method: 'POST', body: JSON.stringify({ model, messages, max_tokens }) })
  return r.json()
}

export async function pool(items, n, fn) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i) } }))
  return results
}

/** Raw samples of a WAV file as 16-bit PCM, whatever its format (FLEURS clips are 32-bit float). */
export function pcm16(wav) {
  let off = 12, fmt = null
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4), size = wav.readUInt32LE(off + 4)
    if (id === 'fmt ') fmt = { tag: wav.readUInt16LE(off + 8), bits: wav.readUInt16LE(off + 22) }
    if (id === 'data') {
      const d = wav.subarray(off + 8, off + 8 + Math.min(size, wav.length - off - 8))
      if (fmt.tag === 3 && fmt.bits === 32) {
        const out = Buffer.alloc((d.length / 4) * 2)
        for (let i = 0; i < d.length / 4; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(d.readFloatLE(i * 4) * 32767))), i * 2)
        return out
      }
      return d
    }
    off += 8 + size + (size % 2)
  }
  throw new Error('no data chunk')
}

/** Concatenate WAV clips into one 16 kHz mono 16-bit WAV (long-form test). */
export function concatWav(wavs, gapSeconds = 0.4) {
  const gap = Buffer.alloc(Math.round(16000 * gapSeconds) * 2)
  const pcm = Buffer.concat(wavs.flatMap((w) => [pcm16(w), gap]))
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}
