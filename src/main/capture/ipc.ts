import { desktopCapturer, screen, session, type DesktopCapturerSource } from 'electron'
import { handle } from '../ipc'
import { toCaptureSources } from './sources'

let lastSources: DesktopCapturerSource[] = []
let chosenId: string | null = null

async function fetchSources(): Promise<DesktopCapturerSource[]> {
  lastSources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false
  })
  return lastSources
}

export function registerCaptureIpc(): void {
  handle('capture:list', async () => {
    const sources = await fetchSources()
    return toCaptureSources(sources, screen.getAllDisplays().map((d) => ({ ...d, primary: d.id === screen.getPrimaryDisplay().id })))
  })
  handle('capture:select', (_e, sourceId) => {
    chosenId = sourceId
  })
}

/**
 * getDisplayMedia() in our renderer resolves to the source picked in our own UI (no browser
 * picker) and, when audio is requested, Windows system-audio loopback.
 */
export function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    let source = lastSources.find((s) => s.id === chosenId)
    if (!source && chosenId) source = (await fetchSources()).find((s) => s.id === chosenId)
    if (!source) {
      callback({})
      return
    }
    callback(request.audioRequested ? { video: source, audio: 'loopback' } : { video: source })
  })
}

/** Camera, mic and screen access are granted to Leverage's own pages only. */
export function installPermissionHandlers(isOwnUrl: (url: string) => boolean): void {
  const allowed = new Set(['media', 'display-capture', 'clipboard-sanitized-write'])
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(allowed.has(permission) && isOwnUrl(wc.getURL()))
  })
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return allowed.has(permission) && !!wc && isOwnUrl(wc.getURL())
  })
}
