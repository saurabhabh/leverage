import type { CalloutOverlay, LowerThird } from '../../../shared/edit'
import { renderOverlayPng } from './drawOverlay'

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)

/**
 * Render every callout and lower-third of a recording's edit to a full-frame PNG in its folder, so
 * the main process can composite them. Runs right before each export, so PNGs are never stale.
 */
export async function prepareOverlayPngs(recordingId: string): Promise<void> {
  const { manifest, edit } = await window.leverage['edit:open'](recordingId)
  const size = manifest.crop ?? manifest.videoSize
  const frame = { width: even(size.width), height: even(size.height) }
  for (const o of edit.overlays) {
    if (o.kind === 'blur') continue
    const png = await renderOverlayPng(o as CalloutOverlay | LowerThird, frame)
    await window.leverage['edit:overlayPng'](recordingId, o.id, png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer)
  }
}

/** Prepare overlays, then export. Resolves to the written path, or null if the user cancelled. */
export async function exportRecording(recordingId: string, kind: 'mp4' | 'gif'): Promise<string | null> {
  await prepareOverlayPngs(recordingId)
  return window.leverage[kind === 'mp4' ? 'export:mp4' : 'export:gif'](recordingId)
}
