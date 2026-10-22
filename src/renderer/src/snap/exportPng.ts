import type { SnapDoc } from '../../../shared/snap'
import { renderDoc } from './draw'
import { normalizeRect } from './geometry'

/** Render the shot at full resolution, apply the crop, and encode it as PNG. */
export async function exportPng(doc: SnapDoc, image: CanvasImageSource): Promise<ArrayBuffer> {
  const full = document.createElement('canvas')
  full.width = doc.width
  full.height = doc.height
  renderDoc(full.getContext('2d', { willReadFrequently: true })!, doc, image)
  let out = full
  if (doc.crop) {
    const c = normalizeRect(doc.crop)
    out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(c.width))
    out.height = Math.max(1, Math.round(c.height))
    out.getContext('2d')!.drawImage(full, -Math.round(c.x), -Math.round(c.y))
  }
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode the screenshot.')
  return blob.arrayBuffer()
}
