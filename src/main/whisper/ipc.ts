import { app } from 'electron'
import { join } from 'path'
import { broadcast, handle } from '../ipc'
import { installWhisper, whisperStatus } from './install'

export const whisperRoot = (): string => join(app.getPath('userData'), 'whisper')

let running: { abort: AbortController; done: Promise<void> } | null = null

export function registerWhisperIpc(): void {
  handle('whisper:status', () => whisperStatus(whisperRoot()))
  handle('whisper:install', async () => {
    if (running) return running.done
    const abort = new AbortController()
    const done = installWhisper(whisperRoot(), {
      signal: abort.signal,
      onProgress: (stage, pct) => broadcast('whisper:progress', { stage, pct })
    }).finally(() => {
      running = null
    })
    running = { abort, done }
    return done
  })
  handle('whisper:cancel', () => running?.abort.abort())
}
