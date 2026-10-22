import { normalizeDrag } from './region'
import type { Rect, Size } from './types'

/** Region-overlay selection math (Flameshot-style handles and keyboard nudging). DIP, display-relative. */

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

/** Which handle is under `p`. On a tiny selection the grab zones shrink so its middle stays movable. */
export function handleAt(r: Rect, p: { x: number; y: number }, grab: number): Handle | null {
  const gx = Math.min(grab, r.width / 4)
  const gy = Math.min(grab, r.height / 4)
  const inX = p.x >= r.x - grab && p.x <= r.x + r.width + grab
  const inY = p.y >= r.y - grab && p.y <= r.y + r.height + grab
  if (!inX || !inY) return null
  const west = Math.abs(p.x - r.x) <= gx || p.x < r.x
  const east = Math.abs(p.x - (r.x + r.width)) <= gx || p.x > r.x + r.width
  const north = Math.abs(p.y - r.y) <= gy || p.y < r.y
  const south = Math.abs(p.y - (r.y + r.height)) <= gy || p.y > r.y + r.height
  const v = north ? 'n' : south ? 's' : ''
  const h = west ? 'w' : east ? 'e' : ''
  return ((v + h) as Handle) || 'move'
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

/** Apply a drag of (dx, dy) on `handle` to the selection as it was when the drag started. */
export function resizeBy(start: Rect, handle: Handle, dx: number, dy: number, bounds: Size): Rect {
  if (handle === 'move') {
    return {
      ...start,
      x: clamp(start.x + dx, 0, bounds.width - start.width),
      y: clamp(start.y + dy, 0, bounds.height - start.height)
    }
  }
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height
  if (handle.includes('w')) left += dx
  if (handle.includes('e')) right += dx
  if (handle.includes('n')) top += dy
  if (handle.includes('s')) bottom += dy
  return normalizeDrag(
    { x: clamp(left, 0, bounds.width), y: clamp(top, 0, bounds.height) },
    { x: clamp(right, 0, bounds.width), y: clamp(bottom, 0, bounds.height) }
  )
}

type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
export const isArrowKey = (k: string): k is ArrowKey => k.startsWith('Arrow')

/** Arrows move the selection (Shift = 10 px); Ctrl+arrows resize from the right/bottom edge. */
export function nudge(
  r: Rect,
  key: ArrowKey,
  mods: { shift: boolean; ctrl: boolean },
  bounds: Size
): Rect {
  const step = mods.shift ? 10 : 1
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
  if (mods.ctrl) {
    return {
      ...r,
      width: clamp(r.width + dx, 1, bounds.width - r.x),
      height: clamp(r.height + dy, 1, bounds.height - r.y)
    }
  }
  return resizeBy(r, 'move', dx, dy, bounds)
}
