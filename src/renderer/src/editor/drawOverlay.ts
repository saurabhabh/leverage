import type { CalloutOverlay, LowerThird } from '../../../shared/edit'
import type { Rect, Size } from '../../../shared/types'

/**
 * Draws a callout or lower-third in OUTPUT-FRAME pixels. The preview passes a context scaled to the
 * display; export rasterizes the same drawing onto a full-frame transparent canvas, so both match.
 */

const FONT = 'Segoe UI, sans-serif'
export const ACCENT = '#ff3b30'

const normalize = (r: Rect): Rect => ({
  x: Math.min(r.x, r.x + r.width),
  y: Math.min(r.y, r.y + r.height),
  width: Math.abs(r.width),
  height: Math.abs(r.height)
})

export const strokeWidth = (frame: Size): number => Math.max(4, frame.width / 240)
export const textSize = (frame: Size): number => Math.round(frame.height / 24)

export function drawOverlay(ctx: CanvasRenderingContext2D, o: CalloutOverlay | LowerThird, frame: Size): void {
  ctx.save()
  if (o.kind === 'arrow') drawArrow(ctx, o, frame)
  else if (o.kind === 'box') drawBox(ctx, o, frame)
  else if (o.kind === 'text') drawText(ctx, o, frame)
  else if (o.kind === 'lowerThird') drawLowerThird(ctx, o, frame)
  ctx.restore()
}

function drawArrow(ctx: CanvasRenderingContext2D, o: CalloutOverlay, frame: Size): void {
  const lw = strokeWidth(frame)
  const head = lw * 5
  const tail = { x: o.rect.x, y: o.rect.y }
  const tip = { x: o.rect.x + o.rect.width, y: o.rect.y + o.rect.height }
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x)
  const length = Math.hypot(tip.x - tail.x, tip.y - tail.y)
  const base = { x: tip.x - Math.cos(angle) * Math.min(head, length), y: tip.y - Math.sin(angle) * Math.min(head, length) }
  ctx.strokeStyle = o.color
  ctx.fillStyle = o.color
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(tail.x, tail.y)
  ctx.lineTo(base.x, base.y)
  ctx.stroke()
  const spread = Math.PI / 7
  ctx.beginPath()
  ctx.moveTo(tip.x - Math.cos(angle - spread) * head, tip.y - Math.sin(angle - spread) * head)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(tip.x - Math.cos(angle + spread) * head, tip.y - Math.sin(angle + spread) * head)
  ctx.closePath()
  ctx.fill()
}

function drawBox(ctx: CanvasRenderingContext2D, o: CalloutOverlay, frame: Size): void {
  const r = normalize(o.rect)
  ctx.strokeStyle = o.color
  ctx.lineWidth = strokeWidth(frame)
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.width, r.height, 8)
  ctx.stroke()
}

/** Box a text callout occupies (output-frame px), for hit-testing and handles. */
export function textBounds(ctx: CanvasRenderingContext2D, o: CalloutOverlay, frame: Size): Rect {
  const size = textSize(frame)
  ctx.font = `bold ${size}px ${FONT}`
  const pad = Math.round(size * 0.4)
  return { x: o.rect.x, y: o.rect.y, width: ctx.measureText(o.text || ' ').width + pad * 2, height: size + pad * 2 }
}

function drawText(ctx: CanvasRenderingContext2D, o: CalloutOverlay, frame: Size): void {
  const size = textSize(frame)
  const pad = Math.round(size * 0.4)
  const box = textBounds(ctx, o, frame)
  ctx.fillStyle = 'rgba(0,0,0,0.7)'
  ctx.fillRect(box.x, box.y, box.width, box.height)
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'top'
  ctx.fillText(o.text, o.rect.x + pad, o.rect.y + pad)
}

function drawLowerThird(ctx: CanvasRenderingContext2D, o: LowerThird, frame: Size): void {
  const title = Math.round(frame.height / 22)
  const sub = Math.round(frame.height / 34)
  const margin = Math.round(frame.height * 0.05)
  const pad = Math.round(title * 0.5)
  const width = Math.round(frame.width * 0.45)
  const height = pad * 2 + title + (o.subtitle ? Math.round(sub * 1.35) : 0)
  const x = margin
  const y = frame.height - margin - height
  ctx.fillStyle = 'rgba(20,20,22,0.85)'
  ctx.fillRect(x, y, width, height)
  ctx.fillStyle = ACCENT
  ctx.fillRect(x, y, 6, height)
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${title}px ${FONT}`
  ctx.fillText(o.title, x + 6 + pad, y + pad, width - 6 - pad * 2)
  if (o.subtitle) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.font = `${sub}px ${FONT}`
    ctx.fillText(o.subtitle, x + 6 + pad, y + pad + title + Math.round(sub * 0.3), width - 6 - pad * 2)
  }
}

/** Rasterize an overlay to a transparent full-frame PNG for export. */
export async function renderOverlayPng(o: CalloutOverlay | LowerThird, frame: Size): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(frame.width, frame.height)
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  drawOverlay(ctx, o, frame)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}
