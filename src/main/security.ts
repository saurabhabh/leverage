import { resolve, sep } from 'path'
import { fileURLToPath } from 'url'

/**
 * True only for Leverage's own pages: files inside the bundled renderer folder, or the dev server
 * in development. Anything else (a dropped file, a web page) gets no permissions and no IPC.
 */
export function isOwnUrl(url: string, rendererDir: string, devServerUrl?: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'file:') {
    const file = resolve(fileURLToPath(parsed))
    const root = resolve(rendererDir) + sep
    return file.toLowerCase().startsWith(root.toLowerCase())
  }
  if (devServerUrl) {
    try {
      return parsed.origin === new URL(devServerUrl).origin
    } catch {
      return false
    }
  }
  return false
}
