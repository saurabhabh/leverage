import type { CalloutOverlay, EditDoc, Overlay } from '../../../shared/edit'
import { outputToSource } from '../../../shared/edit'
import type { Rect, Size } from '../../../shared/types'
import { textBounds } from './drawOverlay'

export type Tool = 'blur' | 'arrow' | 'box' | 'text' | null

export const DEFAULT_SPAN_MS = 3000
export const SWATCHES = ['#ff3b30', '#ffd60a', '#34c759', '#0a84ff', '#ffffff']

export const normalize = (r: Rect): Rect => ({
  x: Math.min(r.x, r.x + r.width),
  y: Math.min(r.y, r.y + r.height),
  width: Math.abs(r.width),
  height: Math.abs(r.height)
})

let measureCtx: CanvasRenderingContext2D | null = null

/** Box an overlay covers in output-frame px (for hit-testing and selection outlines). */
export function overlayBox(o: Overlay, frame: Size): Rect {
  if (o.kind === 'lowerThird') {
    const margin = Math.round(frame.height * 0.05)
    const h = Math.round(frame.height / 22) * 2.4
    return { x: margin, y: frame.height - margin - h, width: frame.width * 0.45, height: h }
  }
  if (o.kind === 'text') {
    measureCtx ??= document.createElement('canvas').getContext('2d')
    return measureCtx ? textBounds(measureCtx, o as CalloutOverlay, frame) : { ...o.rect, width: 200, height: 60 }
  }
  return normalize(o.rect)
}

/** Source span for a new overlay at the playhead: 3 s, kept inside the current clip. */
export function newSpan(e: EditDoc, outMs: number): { srcStartMs: number; srcEndMs: number } {
  const { clipIndex, srcMs } = outputToSource(e, outMs)
  const clip = e.clips[clipIndex]
  let start = Math.min(srcMs, clip.srcEndMs - 100)
  const end = Math.min(clip.srcEndMs, start + DEFAULT_SPAN_MS)
  start = Math.max(clip.srcStartMs, Math.min(start, end - 100))
  return { srcStartMs: Math.round(start), srcEndMs: Math.round(end) }
}

export const isVisibleAt = (o: Overlay, srcMs: number): boolean => srcMs >= o.srcStartMs && srcMs < o.srcEndMs

/** Camera size presets as a share of the frame width. */
export const CAMERA_PRESETS = { S: 0.12, M: 0.2, L: 0.3 } as const

/** Keep the camera circle whole and inside the frame (same rule as export). */
export function clampCamera(c: { x: number; y: number; size: number }, frame: Size): { x: number; y: number; size: number } {
  const size = Math.max(32, Math.min(Math.round(c.size), frame.width, frame.height))
  return {
    size,
    x: Math.round(Math.min(Math.max(0, c.x), frame.width - size)),
    y: Math.round(Math.min(Math.max(0, c.y), frame.height - size))
  }
}
