import type { Shape, SnapDoc } from '../../../shared/snap'
import {
  arrowGeometry,
  counterNumbers,
  counterRadius,
  markerWidth,
  normalizeRect
} from './geometry'
import { pseudoPixelate } from './pixelate'

export const textFont = (px: number, bold: boolean): string =>
  `${bold ? 'bold ' : ''}${px}px "Segoe UI", system-ui, sans-serif`
export const LINE_HEIGHT = 1.25

function strokePath(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]): void {
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  // A single click still leaves a dot.
  if (points.length === 1) ctx.lineTo(points[0].x + 0.01, points[0].y)
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.stroke()
}

function pixelate(
  ctx: CanvasRenderingContext2D,
  shape: Extract<Shape, { kind: 'pixelate' }>
): void {
  const r = normalizeRect(shape.rect)
  const { width: cw, height: ch } = ctx.canvas
  // Read the area plus its 1-px fringe, but never past the canvas (that would sample transparent black).
  const x0 = Math.max(0, Math.round(r.x) - 1)
  const y0 = Math.max(0, Math.round(r.y) - 1)
  const x1 = Math.min(cw, Math.round(r.x + r.width) + 1)
  const y1 = Math.min(ch, Math.round(r.y + r.height) + 1)
  if (x1 <= x0 || y1 <= y0) return
  const src = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
  const area = { x: r.x - x0, y: r.y - y0, width: r.width, height: r.height }
  const { rect, data } = pseudoPixelate(src, area, shape.size)
  if (rect.width === 0 || rect.height === 0) return
  ctx.putImageData(new ImageData(data, rect.width, rect.height), x0 + rect.x, y0 + rect.y)
}

/** Draw one shape in image coordinates. `number` is a counter's step number. */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  opts: { number?: number } = {}
): void {
  ctx.save()
  ctx.strokeStyle = shape.color
  ctx.fillStyle = shape.color
  ctx.lineWidth = shape.size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  switch (shape.kind) {
    case 'pen':
      strokePath(ctx, shape.points)
      break
    case 'marker':
      ctx.globalCompositeOperation = 'multiply'
      ctx.globalAlpha = 0.35
      ctx.lineWidth = markerWidth(shape.size)
      strokePath(ctx, shape.points)
      break
    case 'line':
      strokePath(ctx, [shape.a, shape.b])
      break
    case 'arrow': {
      const { shaftEnd, head } = arrowGeometry(shape.a, shape.b, shape.size)
      ctx.lineCap = 'butt'
      strokePath(ctx, [shape.a, shaftEnd])
      ctx.beginPath()
      ctx.moveTo(head[1].x, head[1].y)
      ctx.lineTo(head[0].x, head[0].y)
      ctx.lineTo(head[2].x, head[2].y)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'rect': {
      const r = normalizeRect(shape.rect)
      ctx.lineJoin = 'miter'
      if (shape.filled) ctx.fillRect(r.x, r.y, r.width, r.height)
      else ctx.strokeRect(r.x, r.y, r.width, r.height)
      break
    }
    case 'ellipse': {
      const r = normalizeRect(shape.rect)
      ctx.beginPath()
      ctx.ellipse(
        r.x + r.width / 2,
        r.y + r.height / 2,
        r.width / 2,
        r.height / 2,
        0,
        0,
        Math.PI * 2
      )
      if (shape.filled) ctx.fill()
      else ctx.stroke()
      break
    }
    case 'redact': {
      const r = normalizeRect(shape.rect)
      ctx.fillRect(r.x, r.y, r.width, r.height)
      break
    }
    case 'pixelate':
      pixelate(ctx, shape)
      break
    case 'text': {
      ctx.font = textFont(shape.size, shape.bold)
      ctx.textBaseline = 'top'
      shape.text
        .split('\n')
        .forEach((line, i) =>
          ctx.fillText(line, shape.at.x, shape.at.y + i * shape.size * LINE_HEIGHT)
        )
      break
    }
    case 'counter': {
      const r = counterRadius(shape.size)
      ctx.beginPath()
      ctx.arc(shape.at.x, shape.at.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      const label = String(opts.number ?? 1)
      ctx.fillStyle = '#ffffff'
      ctx.font = textFont(Math.round(r * (label.length > 1 ? 0.9 : 1.1)), true)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, shape.at.x, shape.at.y, r * 1.6)
      break
    }
  }
  ctx.restore()
}

/** The whole shot at full image size (crop is applied when exporting, so it stays editable). */
export function renderDoc(
  ctx: CanvasRenderingContext2D,
  doc: SnapDoc,
  image: CanvasImageSource
): void {
  ctx.clearRect(0, 0, doc.width, doc.height)
  ctx.drawImage(image, 0, 0)
  const numbers = counterNumbers(doc.shapes)
  for (const shape of doc.shapes) drawShape(ctx, shape, { number: numbers.get(shape.id) })
}
