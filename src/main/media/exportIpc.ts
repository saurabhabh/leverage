import { BrowserWindow, dialog, shell } from 'electron'
import { existsSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { broadcast, handle } from '../ipc'
import { libraryStore } from '../recording/ipc'
import { buildGifArgs, buildMp4Args, frameSize } from './exportArgs'
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
  const args =
    kind === 'mp4'
      ? buildMp4Args(manifest, dir, out, { micGain: 1, systemGain: 1, includeCamera: true })
      : buildGifArgs(manifest, dir, out, { fps: 15, width: Math.min(960, frameSize(manifest).width) })
  broadcast('export:progress', { id, pct: 0 })
  await runFfmpeg(args, manifest.durationMs, (pct) => broadcast('export:progress', { id, pct }))
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
