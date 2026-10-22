import { normalizeDrag } from '../../../shared/region'
import type { Point, Shape } from '../../../shared/snap'
import type { Rect } from '../../../shared/types'

export type Measure = (text: string, fontPx: number) => { width: number; height: number }

/** Rough text size, for when no canvas is at hand. */
export const roughMeasure: Measure = (text, px) => {
  const lines = text.split('\n')
  return {
    width: Math.max(...lines.map((l) => l.length)) * px * 0.6,
    height: lines.length * px * 1.25
  }
}

const STEP = Math.PI / 4

/** Move `b` to the nearest 45° direction from `a`, keeping the distance (Shift while drawing). */
export function snapAngle(a: Point, b: Point): Point {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len === 0) return { ...b }
  const angle = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / STEP) * STEP
  return { x: a.x + len * Math.cos(angle), y: a.y + len * Math.sin(angle) }
}

/**
 * Arrow head that grows with the stroke (Flameshot's proportions: length 18 + 4·size, width
 * 10 + 2·size), capped at 60 % of the arrow so short arrows stay arrows. `head[0]` is the tip (= b).
 */
export function arrowGeometry(
  a: Point,
  b: Point,
  size: number
): { shaftEnd: Point; head: [Point, Point, Point] } {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len === 0) return { shaftEnd: { ...b }, head: [{ ...b }, { ...b }, { ...b }] }
  const fullLen = 18 + 4 * size
  const headLen = Math.min(fullLen, len * 0.6)
  const halfWidth = ((10 + 2 * size) * (headLen / fullLen)) / 2
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const base = { x: b.x - ux * headLen, y: b.y - uy * headLen }
  // Stop the shaft inside the head so its square end never pokes through the tip.
  const shaftEnd = { x: b.x - ux * headLen * 0.7, y: b.y - uy * headLen * 0.7 }
  return {
    shaftEnd,
    head: [
      { ...b },
      { x: base.x - uy * halfWidth, y: base.y + ux * halfWidth },
      { x: base.x + uy * halfWidth, y: base.y - ux * halfWidth }
    ]
  }
}

export const counterRadius = (size: number): number => 10 + 2 * size
export const markerWidth = (size: number): number => 14 + size

export function normalizeRect(r: Rect): Rect {
  return normalizeDrag({ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height })
}

const pad = (r: Rect, p: number): Rect => ({
  x: r.x - p,
  y: r.y - p,
  width: r.width + 2 * p,
  height: r.height + 2 * p
})

function pointsBounds(points: Point[]): Rect {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

export function shapeBounds(shape: Shape, measure: Measure = roughMeasure): Rect {
  switch (shape.kind) {
    case 'pen':
      return pad(pointsBounds(shape.points), shape.size / 2)
    case 'marker':
      return pad(pointsBounds(shape.points), markerWidth(shape.size) / 2)
    case 'line':
      return pad(pointsBounds([shape.a, shape.b]), shape.size / 2)
    case 'arrow':
      return pad(pointsBounds([shape.a, shape.b]), (10 + 2 * shape.size) / 2)
    case 'rect':
    case 'ellipse':
      return pad(normalizeRect(shape.rect), shape.filled ? 0 : shape.size / 2)
    case 'pixelate':
    case 'redact':
      return normalizeRect(shape.rect)
    case 'text': {
      const { width, height } = measure(shape.text || ' ', shape.size)
      return { x: shape.at.x, y: shape.at.y, width, height }
    }
    case 'counter': {
      const r = counterRadius(shape.size)
      return { x: shape.at.x - r, y: shape.at.y - r, width: 2 * r, height: 2 * r }
    }
  }
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

const inRect = (p: Point, r: Rect, tol: number): boolean =>
  p.x >= r.x - tol && p.x <= r.x + r.width + tol && p.y >= r.y - tol && p.y <= r.y + r.height + tol

function hits(shape: Shape, p: Point, tol: number, measure: Measure): boolean {
  switch (shape.kind) {
    case 'line':
    case 'arrow':
      return distToSegment(p, shape.a, shape.b) <= shape.size / 2 + tol
    case 'pen':
    case 'marker': {
      const reach = (shape.kind === 'pen' ? shape.size : markerWidth(shape.size)) / 2 + tol
      const pts = shape.points
      if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= reach
      return pts.slice(1).some((q, i) => distToSegment(p, pts[i], q) <= reach)
    }
    default:
      // Box-like shapes are picked anywhere inside, so a thin outline is easy to grab.
      return inRect(p, shapeBounds(shape, measure), tol)
  }
}

/** Id of the topmost shape at `p` (within `tol` image pixels), or null. */
export function hitTest(
  shapes: Shape[],
  p: Point,
  tol: number,
  measure: Measure = roughMeasure
): string | null {
  for (let i = shapes.length - 1; i >= 0; i--)
    if (hits(shapes[i], p, tol, measure)) return shapes[i].id
  return null
}

const shift = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy })

export function moveShape(shape: Shape, dx: number, dy: number): Shape {
  switch (shape.kind) {
    case 'pen':
    case 'marker':
      return { ...shape, points: shape.points.map((p) => shift(p, dx, dy)) }
    case 'line':
    case 'arrow':
      return { ...shape, a: shift(shape.a, dx, dy), b: shift(shape.b, dx, dy) }
    case 'rect':
    case 'ellipse':
    case 'pixelate':
    case 'redact':
      return { ...shape, rect: { ...shape.rect, x: shape.rect.x + dx, y: shape.rect.y + dy } }
    case 'text':
    case 'counter':
      return { ...shape, at: shift(shape.at, dx, dy) }
  }
}

/** Step numbers follow drawing order, so deleting step 1 renumbers the rest. */
export function counterNumbers(shapes: Shape[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of shapes) if (s.kind === 'counter') out.set(s.id, out.size + 1)
  return out
}
