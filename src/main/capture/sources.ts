import type { CaptureSource, Rect } from '../../shared/types'

/** The fields we use from Electron's DesktopCapturerSource / Display (kept structural for tests). */
export type DesktopSourceLike = {
  id: string
  name: string
  display_id: string
  thumbnail: { toDataURL(): string }
}
export type DisplayLike = { id: number; bounds: Rect; scaleFactor: number; primary: boolean }

const OWN_WINDOW_NAMES = new Set(['Leverage'])

export function toCaptureSources(sources: DesktopSourceLike[], displays: DisplayLike[]): CaptureSource[] {
  const primary = displays.find((d) => d.primary) ?? displays[0]
  const out: CaptureSource[] = []
  for (const s of sources) {
    const kind = s.id.startsWith('screen:') ? 'screen' : 'window'
    if (kind === 'window' && OWN_WINDOW_NAMES.has(s.name)) continue
    const display = kind === 'screen' ? displays.find((d) => String(d.id) === s.display_id) : undefined
    out.push({
      id: s.id,
      kind,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
      ...(display ? { displayId: String(display.id), displayBoundsDip: display.bounds } : {}),
      scaleFactor: (display ?? primary)?.scaleFactor ?? 1
    })
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'screen' ? -1 : 1))
}
