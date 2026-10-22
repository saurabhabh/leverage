import type { Rect } from '../../../shared/types'
import { normalizeRect } from './geometry'

export type Pixels = { data: Uint8ClampedArray; width: number; height: number }

type Rgb = [number, number, number]

/** Small seeded PRNG (mulberry32): the same shape always renders the same pixels. */
function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Pixelation that cannot be undone. Ordinary pixelation averages the hidden pixels, which tools like
 * bishopfox/unredacter can reverse. Like Flameshot's "pseudo-pixelation", this reads only the 1-px
 * fringe *outside* the area and paints blocks interpolated from it; the hidden pixels are never read.
 * Returns RGBA for the (clamped) rect.
 */
export function pseudoPixelate(
  img: Pixels,
  area: Rect,
  block: number
): { rect: Rect; data: Uint8ClampedArray<ArrayBuffer> } {
  const n = normalizeRect(area)
  const x0 = Math.max(0, Math.round(n.x))
  const y0 = Math.max(0, Math.round(n.y))
  const x1 = Math.min(img.width, Math.round(n.x + n.width))
  const y1 = Math.min(img.height, Math.round(n.y + n.height))
  const rect = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
  const out = new Uint8ClampedArray(rect.width * rect.height * 4)
  if (rect.width === 0 || rect.height === 0) return { rect, data: out }

  const at = (x: number, y: number): Rgb => {
    const i = (y * img.width + x) * 4
    return [img.data[i], img.data[i + 1], img.data[i + 2]]
  }
  const row = (y: number): Rgb[] | null =>
    y < 0 || y >= img.height ? null : Array.from({ length: rect.width }, (_, i) => at(x0 + i, y))
  const col = (x: number): Rgb[] | null =>
    x < 0 || x >= img.width ? null : Array.from({ length: rect.height }, (_, i) => at(x, y0 + i))
  const top = row(y0 - 1)
  const bottom = row(y1)
  const left = col(x0 - 1)
  const right = col(x1)

  const rand = prng((x0 * 73856093) ^ (y0 * 19349663) ^ (rect.width * 83492791) ^ rect.height)
  const pick = (line: Rgb[], t: number): Rgb => {
    // Jitter where we sample along the fringe so blocks don't copy one edge pixel each.
    const jitter = (rand() - 0.5) * block * 2
    return line[Math.max(0, Math.min(line.length - 1, Math.round(t * (line.length - 1) + jitter)))]
  }
  const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
    [0, 1, 2].map((k) => a[k] * (1 - t) + b[k] * t) as Rgb

  const size = Math.max(1, Math.round(block))
  for (let by = 0; by < rect.height; by += size) {
    for (let bx = 0; bx < rect.width; bx += size) {
      const u = Math.min(1, (bx + size / 2) / rect.width)
      const v = Math.min(1, (by + size / 2) / rect.height)
      const estimates: Rgb[] = []
      if (left && right) estimates.push(mix(pick(left, v), pick(right, v), u))
      else if (left || right) estimates.push(pick((left ?? right)!, v))
      if (top && bottom) estimates.push(mix(pick(top, u), pick(bottom, u), v))
      else if (top || bottom) estimates.push(pick((top ?? bottom)!, u))
      let color: Rgb = [128, 128, 128]
      if (estimates.length) {
        const noise = (rand() - 0.5) * 24
        color = [0, 1, 2].map(
          (k) => estimates.reduce((s, e) => s + e[k], 0) / estimates.length + noise
        ) as Rgb
      }
      for (let y = by; y < Math.min(by + size, rect.height); y++)
        for (let x = bx; x < Math.min(bx + size, rect.width); x++)
          out.set([...color, 255], (y * rect.width + x) * 4)
    }
  }
  return { rect, data: out }
}
