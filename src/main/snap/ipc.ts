import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  desktopCapturer,
  dialog,
  globalShortcut,
  nativeImage,
  Notification,
  screen,
  shell
} from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import type { SnapSelection } from '../../shared/ipc'
import type { SnapMode } from '../../shared/snap'
import type { Rect } from '../../shared/types'
import { broadcast, getSettings, handle } from '../ipc'
import { uniqueFile } from '../media/exportIpc'
import { helperWebPreferences, loadPage } from '../windows/load'
import { dipToImageRect, matchSources } from './capture'
import { SnapStore } from './store'

type Frozen = { displayId: string; bounds: Rect; image: Electron.NativeImage; png?: Buffer }

let mainWindow: () => BrowserWindow | undefined = () => undefined
let busy = false
let pick: {
  frozen: Frozen[]
  windows: BrowserWindow[]
  resolve: (s: SnapSelection | null) => void
} | null = null
const pins = new Set<BrowserWindow>()

const store = (): SnapStore => new SnapStore(getSettings().snap.dir, (p) => shell.trashItem(p))
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const toArrayBuffer = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

/** Freeze every display once, at native resolution (Flameshot's "grab first, select second"). */
async function grabDisplays(): Promise<Frozen[]> {
  const displays = screen.getAllDisplays()
  const native = (d: Electron.Display): { width: number; height: number } => ({
    width: Math.round(d.bounds.width * d.scaleFactor),
    height: Math.round(d.bounds.height * d.scaleFactor)
  })
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.max(...displays.map((d) => native(d).width)),
      height: Math.max(...displays.map((d) => native(d).height))
    }
  })
  const frozen: Frozen[] = []
  matchSources(displays, sources).forEach((source, i) => {
    if (!source || source.thumbnail.isEmpty()) return
    const d = displays[i]
    const target = native(d)
    const size = source.thumbnail.getSize()
    // Thumbnails fit the largest display's box; bring each back to its own display's pixels.
    const image =
      size.width === target.width && size.height === target.height
        ? source.thumbnail
        : source.thumbnail.resize({ ...target, quality: 'best' })
    frozen.push({ displayId: String(d.id), bounds: d.bounds, image })
  })
  if (frozen.length === 0) throw new Error('Could not capture the screen.')
  return frozen
}

function finishPick(result: SnapSelection | null): void {
  if (!pick) return
  const { resolve, windows } = pick
  pick = null
  globalShortcut.unregister('Escape')
  for (const w of windows) if (!w.isDestroyed()) w.close()
  resolve(result)
}

/** One overlay per display showing its frozen image; resolves with the selection or null. */
function pickRegion(frozen: Frozen[]): Promise<SnapSelection | null> {
  finishPick(null)
  return new Promise((resolve) => {
    const windows = frozen.map((f) => {
      const win = new BrowserWindow({
        ...f.bounds,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        show: false,
        backgroundColor: '#000000',
        webPreferences: helperWebPreferences()
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setBounds(f.bounds)
      win.on('closed', () => {
        if (pick?.windows.includes(win)) finishPick(null)
      })
      // Shown by `snap:ready` once the frozen image is painted; this is only a fallback.
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) win.show()
      }, 3000)
      void loadPage(win, 'snap-overlay.html', {
        displayId: f.displayId,
        w: String(f.bounds.width),
        h: String(f.bounds.height),
        x: String(f.bounds.x),
        y: String(f.bounds.y)
      })
      return win
    })
    pick = { frozen, windows, resolve }
    globalShortcut.register('Escape', () => finishPick(null))
  })
}

async function storeImage(image: Electron.NativeImage): Promise<string> {
  const doc = await store().create(image.toPNG(), image.getSize())
  broadcast('snap:changed', null)
  return doc.id
}

function showMain(): BrowserWindow | undefined {
  const win = mainWindow()
  if (!win) return undefined
  if (win.isMinimized()) win.restore()
  win.show()
  return win
}

function openEditor(id: string): void {
  showMain()?.focus()
  mainWindow()?.webContents.send('snap:open', { id })
}

async function copy(id: string): Promise<void> {
  const png = await store().image(id, 'rendered')
  await clipboard.write([
    new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })
  ])
}

function notify(body: string, id: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: 'Leverage', body })
  n.on('click', () => openEditor(id))
  n.show()
}

async function capture(mode: SnapMode, delaySec = 0): Promise<void> {
  if (busy) return
  busy = true
  const main = mainWindow()
  const hideMain = !!main && main.isVisible() && !main.isMinimized()
  try {
    if (hideMain) main!.hide()
    // Give the window time to disappear before the screen is grabbed.
    await sleep(delaySec > 0 ? delaySec * 1000 : hideMain ? 250 : 0)
    const frozen = await grabDisplays()
    if (mode === 'full') {
      const under = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const f = frozen.find((x) => x.displayId === String(under.id)) ?? frozen[0]
      openEditor(await storeImage(f.image))
      return
    }
    const selection = await pickRegion(frozen)
    const f = selection && frozen.find((x) => x.displayId === selection.displayId)
    if (!selection || !f) {
      if (hideMain) showMain()
      return
    }
    const id = await storeImage(
      f.image.crop(dipToImageRect(selection.rectDip, f.bounds, f.image.getSize()))
    )
    if (selection.action === 'edit') return openEditor(id)
    if (selection.action === 'copy') await copy(id)
    notify(selection.action === 'copy' ? 'Screenshot copied.' : 'Screenshot saved.', id)
    if (hideMain) showMain()
  } catch (err) {
    if (hideMain) showMain()
    throw err
  } finally {
    busy = false
  }
}

/** Hotkey and tray entry point: errors become a dialog instead of an unhandled rejection. */
export function triggerSnap(mode: SnapMode = 'region'): void {
  capture(mode).catch((err) =>
    dialog.showErrorBox(
      'Leverage',
      `Screenshot failed: ${err instanceof Error ? err.message : err}`
    )
  )
}

function openPin(id: string, png: Buffer): void {
  const image = nativeImage.createFromBuffer(png)
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width: pw, height: ph } = image.getSize()
  const fit = Math.min(
    1,
    (display.workArea.width * 0.8) / (pw / display.scaleFactor),
    (display.workArea.height * 0.8) / (ph / display.scaleFactor)
  )
  const width = Math.max(40, Math.round((pw / display.scaleFactor) * fit))
  const height = Math.max(40, Math.round((ph / display.scaleFactor) * fit))
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + (display.workArea.height - height) / 2),
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'Leverage pin',
    webPreferences: helperWebPreferences()
  })
  win.setAlwaysOnTop(true, 'floating')
  pins.add(win)
  win.on('closed', () => pins.delete(win))
  win.once('ready-to-show', () => win.show())
  void loadPage(win, 'pin.html', { id })
}

/** The pin window that sent this call (pin controls never move other windows). */
function pinOf(e: Electron.IpcMainInvokeEvent): BrowserWindow | undefined {
  const win = BrowserWindow.fromWebContents(e.sender)
  return win && pins.has(win) ? win : undefined
}

export function registerSnapIpc(getMain: () => BrowserWindow | undefined): void {
  mainWindow = getMain
  handle('snap:capture', (_e, mode, delaySec) => capture(mode, delaySec))
  handle('snap:frozen', (_e, displayId) => {
    const f = pick?.frozen.find((x) => x.displayId === displayId)
    if (!f) throw new Error('No capture in progress.')
    f.png ??= f.image.toPNG()
    return toArrayBuffer(f.png)
  })
  handle('snap:ready', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || !pick?.windows.includes(win)) return
    win.show()
    const cursor = screen.getCursorScreenPoint()
    const b = win.getBounds()
    if (cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height)
      win.focus()
  })
  handle('snap:select', (_e, selection) => finishPick(selection))
  handle('snap:list', () => store().list())
  handle('snap:get', async (_e, id) => {
    const doc = await store().get(id)
    if (!doc) throw new Error('Screenshot not found.')
    return doc
  })
  handle('snap:image', async (_e, id, which) => toArrayBuffer(await store().image(id, which)))
  handle('snap:save', async (_e, id, doc, png) => {
    const saved = await store().save(id, doc, Buffer.from(png))
    broadcast('snap:changed', null)
    return saved
  })
  handle('snap:copy', (_e, id) => copy(id))
  handle('snap:saveAs', async (e, id, outPath) => {
    const png = await store().image(id, 'rendered')
    let out = outPath
    if (!out) {
      const win = BrowserWindow.fromWebContents(e.sender)
      const options: Electron.SaveDialogOptions = {
        defaultPath: uniqueFile(join(app.getPath('downloads'), `${id}.png`)),
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      }
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      out = result.filePath
    }
    out = uniqueFile(out)
    await writeFile(out, png, { flag: 'wx' })
    return out
  })
  handle('snap:pin', async (_e, id) => openPin(id, await store().image(id, 'rendered')))
  handle('snap:show', (_e, id) => shell.showItemInFolder(store().pngPath(id)))
  handle('snap:delete', async (_e, id) => {
    await store().remove(id)
    broadcast('snap:changed', null)
  })

  handle('pin:move', (e, dx, dy) => {
    const win = pinOf(e)
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(Math.round(x + dx), Math.round(y + dy))
  })
  handle('pin:zoom', (e, factor) => {
    const win = pinOf(e)
    if (!win) return
    const b = win.getBounds()
    const width = Math.max(40, Math.min(8000, Math.round(b.width * factor)))
    const height = Math.max(40, Math.round((b.height * width) / b.width))
    // Zoom around the window's centre.
    win.setBounds({
      x: Math.round(b.x + (b.width - width) / 2),
      y: Math.round(b.y + (b.height - height) / 2),
      width,
      height
    })
  })
  handle('pin:opacity', (e, delta) => {
    const win = pinOf(e)
    if (win)
      win.setOpacity(Math.max(0.1, Math.min(1, Math.round((win.getOpacity() + delta) * 10) / 10)))
  })
  handle('pin:close', (e) => pinOf(e)?.close())
}
