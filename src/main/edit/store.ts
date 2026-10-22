import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { defaultEdit, EditDocSchema, repairEdit, sourceDurationMs, type EditDoc } from '../../shared/edit'
import type { RecordingManifest } from '../../shared/types'
import { bubbleOverlayBox, frameSize } from '../media/exportArgs'

const EDIT = 'edit.json'

/**
 * Load a recording's edit. Never blocks opening: a missing file gives the default edit; a corrupt or
 * out-of-range one is repaired (or replaced by the default) and reported via `repaired`.
 */
export async function loadEdit(
  dir: string,
  m: RecordingManifest,
  probeMs: () => Promise<number>
): Promise<{ edit: EditDoc; repaired: boolean; sourceMs: number }> {
  const sourceMs = m.durationMs > 0 ? sourceDurationMs(m) : Math.round(await probeMs())
  const fallback = defaultEdit(m, sourceMs, m.tracks.camera ? bubbleOverlayBox(m, frameSize(m)) : null)
  let text: string
  try {
    text = await readFile(join(dir, EDIT), 'utf8')
  } catch {
    return { edit: fallback, repaired: false, sourceMs }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { edit: fallback, repaired: true, sourceMs }
  }
  return { ...repairEdit(raw, sourceMs, fallback), sourceMs }
}

export async function saveEdit(dir: string, e: EditDoc): Promise<void> {
  const temp = join(dir, `${EDIT}.tmp`)
  await writeFile(temp, JSON.stringify(EditDocSchema.parse(e), null, 2))
  await rename(temp, join(dir, EDIT))
}

export async function writeOverlayPng(dir: string, overlayId: string, png: Uint8Array): Promise<string> {
  if (!/^[A-Za-z0-9-]+$/.test(overlayId)) throw new Error(`Invalid overlay id: ${overlayId}`)
  const folder = join(dir, 'overlays')
  await mkdir(folder, { recursive: true })
  const path = join(folder, `${overlayId}.png`)
  await writeFile(path, png)
  return path
}
