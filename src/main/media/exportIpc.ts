import { BrowserWindow, dialog, shell } from 'electron'
import { existsSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { broadcast, handle } from '../ipc'
import { libraryStore } from '../recording/ipc'
import { outputDurationMs } from '../../shared/edit'
import { loadEdit } from '../edit/store'
import { buildEditedGifArgs, buildEditedMp4Args, pngOverlays } from './editExportArgs'
import { frameSize } from './exportArgs'
import { ensureCircleMask } from './mask'
import { probeSourceMs } from './probe'
import { runFfmpeg } from './ffmpeg'

/** Never overwrite: `name.mp4` → `name (2).mp4` → … */
export function uniqueFile(path: string): string {
  const ext = extname(path)
  const stem = join(dirname(path), basename(path, ext))
  let candidate = path
  for (let n = 2; existsSync(candidate); n++) candidate = `${stem} (${n})${ext}`
  return candidate
}

const safeName = (title: string): string => title.replace(/[<>:"/\\|?*]+/g, '-').trim() || 'Recording'

async function chooseOutput(
  sender: Electron.WebContents,
  suggested: string,
  kind: 'mp4' | 'gif',
  outPath?: string
): Promise<string | null> {
  if (outPath) return uniqueFile(outPath)
  const win = BrowserWindow.fromWebContents(sender)
  const options: Electron.SaveDialogOptions = {
    defaultPath: uniqueFile(suggested),
    filters: [kind === 'mp4' ? { name: 'MP4 video', extensions: ['mp4'] } : { name: 'GIF', extensions: ['gif'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : uniqueFile(result.filePath)
}

async function exportRecording(
  sender: Electron.WebContents,
  id: string,
  kind: 'mp4' | 'gif',
  outPath?: string
): Promise<string | null> {
  const found = await libraryStore().find(id)
  if (!found) throw new Error('Recording not found.')
  const { dir, manifest } = found
  const out = await chooseOutput(sender, join(dir, `${safeName(manifest.title)}.${kind}`), kind, outPath)
  if (!out) return null
  // Every export goes through the edit; a recording never edited gets the default (whole) edit.
  const { edit } = await loadEdit(dir, manifest, () => probeSourceMs(dir, manifest))
  // Callout/lower-third PNGs are rendered by the renderer before it asks for an export.
  const pngs: Record<string, string> = {}
  for (const o of pngOverlays(edit)) {
    const png = join(dir, 'overlays', `${o.id}.png`)
    if (existsSync(png)) pngs[o.id] = png
  }
  const mask = edit.camera?.visible && manifest.tracks.camera ? await ensureCircleMask(dir) : null
  const args =
    kind === 'mp4'
      ? buildEditedMp4Args(manifest, edit, dir, out, pngs, mask)
      : buildEditedGifArgs(manifest, edit, dir, out, pngs, mask, { fps: 15, width: Math.min(960, frameSize(manifest).width) })
  broadcast('export:progress', { id, pct: 0 })
  await runFfmpeg(args, outputDurationMs(edit), (pct) => broadcast('export:progress', { id, pct }))
  broadcast('export:progress', { id, pct: 100 })
  return out
}

export function registerExportIpc(): void {
  handle('export:mp4', (e, id, outPath) => exportRecording(e.sender, id, 'mp4', outPath))
  handle('export:gif', (e, id, outPath) => exportRecording(e.sender, id, 'gif', outPath))
  handle('shell:showInFolder', (_e, path) => shell.showItemInFolder(path))
  handle('rec:delete', async (_e, id) => {
    const found = await libraryStore().find(id)
    if (!found) return
    // Recycle Bin, not a permanent delete.
    await shell.trashItem(found.dir)
    broadcast('library:changed', null)
  })
  handle('rec:dir', async (_e, id) => (await libraryStore().find(id))?.dir ?? null)
}
