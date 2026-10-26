/**
 * A minimal ZIP writer ("stored", no compression), enough to hand people their data in one file without a library.
 * Names are UTF-8 (so Hindi and Tamil titles survive). Limits: 65,535 files and 4 GB in total, both checked.
 */

export interface ZipEntry {
  name: string
  data: Uint8Array | Blob
}

const MAX_FILES = 65_535
const MAX_BYTES = 0xffff_ffff - 1_000_000

let table: Uint32Array | null = null
export function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export async function makeZip(entries: ZipEntry[], now = new Date()): Promise<Blob> {
  if (entries.length > MAX_FILES) throw new Error('Too many files for one archive')
  const { time, date } = dosDateTime(now)
  const enc = new TextEncoder()
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const e of entries) {
    const bytes = e.data instanceof Blob ? new Uint8Array(await e.data.arrayBuffer()) : e.data
    const name = enc.encode(e.name)
    const crc = crc32(bytes)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // flag: UTF-8 names
    local.setUint16(8, 0, true) // method: stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, bytes.length, true)
    local.setUint32(22, bytes.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)

    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true) // made by
    cd.setUint16(6, 20, true) // needed
    cd.setUint16(8, 0x0800, true)
    cd.setUint16(10, 0, true)
    cd.setUint16(12, time, true)
    cd.setUint16(14, date, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, bytes.length, true)
    cd.setUint32(24, bytes.length, true)
    cd.setUint16(28, name.length, true)
    cd.setUint32(42, offset, true)
    const record = new Uint8Array(46 + name.length)
    record.set(new Uint8Array(cd.buffer), 0)
    record.set(name, 46)
    central.push(record)

    parts.push(local.buffer, name, bytes as BlobPart)
    offset += 30 + name.length + bytes.length
    if (offset > MAX_BYTES) throw new Error('Archive would be larger than 4 GB')
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end.buffer] as BlobPart[], { type: 'application/zip' })
}
