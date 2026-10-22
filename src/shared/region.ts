import type { Rect, Size } from './types'

const floorEven = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)

/**
 * Map a rect in global DIP coordinates onto the captured video of one display.
 * The video may be larger than the DIP bounds (display scaling), so scale by video/DIP width.
 * Result is clamped to the frame and has even width/height (H.264 4:2:0 needs even sizes).
 */
export function dipRectToVideoRect(r: Rect, displayBoundsDip: Rect, videoSize: Size): Rect {
  const sx = videoSize.width / displayBoundsDip.width
  const sy = videoSize.height / displayBoundsDip.height
  const left = Math.max(0, (r.x - displayBoundsDip.x) * sx)
  const top = Math.max(0, (r.y - displayBoundsDip.y) * sy)
  const right = Math.min(videoSize.width, (r.x - displayBoundsDip.x + r.width) * sx)
  const bottom = Math.min(videoSize.height, (r.y - displayBoundsDip.y + r.height) * sy)
  const width = Math.min(floorEven(right - left), floorEven(videoSize.width))
  const height = Math.min(floorEven(bottom - top), floorEven(videoSize.height))
  const x = Math.min(Math.round(left), videoSize.width - width)
  const y = Math.min(Math.round(top), videoSize.height - height)
  return { x, y, width, height }
}

/** Rectangle spanned by a drag from `a` to `b`, whichever direction it went. */
export function normalizeDrag(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  }
}
