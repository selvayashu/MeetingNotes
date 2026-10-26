/** Round a maximum up to a "nice" axis end (1, 2, 5 times a power of ten) so ticks read as clean numbers. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(value))
  const f = value / pow
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nice * pow
}

/** Axis end for whole-number data: an even number, so the middle tick (half of it) is also a whole number. */
export function niceMaxInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 2) return 2
  // Small counts get the tightest even end (3 -> 4, 7 -> 8); larger ones use the usual round numbers (11 -> 20, 40 -> 50).
  return value <= 10 ? 2 * Math.ceil(value / 2) : niceMax(value)
}

/** 0 / 1K / 2.5K style labels for axis ticks and compact figures. */
export function compact(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `${+(n / 1_000).toFixed(1)}K`
  return String(Math.round(n * 10) / 10)
}

/** Which x labels to print so they never collide: every bar when few, otherwise every k-th, always including the last. */
export function labelIndexes(count: number, maxLabels = 7): Set<number> {
  const out = new Set<number>()
  if (count <= 0) return out
  const step = Math.max(1, Math.ceil(count / maxLabels))
  for (let i = count - 1; i >= 0; i -= step) out.add(i) // count back from the newest so it is always labelled
  return out
}
