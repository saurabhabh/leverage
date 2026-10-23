import { desktopCapturer, screen, session, type DesktopCapturerSource } from 'electron'
import { handle } from '../ipc'
import { createCaptureChoice, primaryScreenId } from './choice'
import { toCaptureSources } from './sources'

let lastSources: DesktopCapturerSource[] = []
const choice = createCaptureChoice()

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
    choice.selectStudio(sourceId)
  })
  handle('capture:meetingAudio', () => {
    choice.armMeeting()
  })
}

/**
 * getDisplayMedia() in our renderer resolves to the source picked in our own UI (no browser
 * picker) and, when audio is requested, Windows system-audio loopback. A meeting's request gets the
 * primary screen (only its loopback audio is kept) and leaves Studio's pick as it was.
 */
export function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const pick = choice.forRequest(request.audioRequested)
    if (pick.kind === 'meeting') {
      const sources = await fetchSources()
      const id = primaryScreenId(sources, screen.getPrimaryDisplay().id)
      const source = sources.find((s) => s.id === id)
      callback(source ? { video: source, audio: 'loopback' } : {})
      return
    }
    const chosenId = pick.sourceId
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
