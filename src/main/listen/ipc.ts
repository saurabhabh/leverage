import { app, BrowserWindow, clipboard, ClipboardItem, globalShortcut, screen } from 'electron'
import { copyFile, mkdir, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { cpus, tmpdir } from 'os'
import { join } from 'path'
import type { DictateCommand } from '../../shared/ipc'
import type { DictationStatus } from '../../shared/listen'
import { buildCleanupPrompt } from './cleanup'
import { processDictation, retryDictation, type PipelineDeps } from './dictation'
import { HistoryStore } from './history'
import { pasteText, sendCtrlV, type PasteDeps } from './paste'
import { dictionaryPrompt, transcribeGroqText, transcribeLocalText } from './transcribeText'
import { broadcast, getSettings, handle } from '../ipc'
import { chat } from '../ai/chat'
import { keyStore } from '../ai/keys'
import { execFfmpeg } from '../media/ffmpeg'
import { cliPath, modelPath, whisperStatus } from '../whisper/install'
import { whisperRoot } from '../whisper/ipc'
import { helperWebPreferences, loadPage } from '../windows/load'

const PILL = { width: 300, height: 64 }

let pill: BrowserWindow | null = null
let pillReady: Promise<void> = Promise.resolve()
let markPillReady: () => void = () => {}
let status: DictationStatus = { phase: 'idle' }
let hideTimer: NodeJS.Timeout | undefined
let escapeHeld = false
let history: HistoryStore | null = null

const listenDir = (): string => join(app.getPath('userData'), 'listen')
const historyStore = (): HistoryStore =>
  (history ??= new HistoryStore(join(listenDir(), 'history.json')))
const tempAudio = (id: string): string => join(tmpdir(), `leverage-dictation-${id}.webm`)
const keptAudio = (id: string): string => join(listenDir(), 'failed', `${id}.webm`)
const audioOf = (id: string): string => (existsSync(keptAudio(id)) ? keptAudio(id) : tempAudio(id))
const newId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function ensurePill(): BrowserWindow {
  if (pill && !pill.isDestroyed()) return pill
  const win = new BrowserWindow({
    ...PILL,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    // Never take focus from the app being dictated into: the text must land there.
    focusable: false,
    show: false,
    title: 'Leverage dictation',
    webPreferences: { ...helperWebPreferences(), backgroundThrottling: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(true)
  // Ready once the page has its listeners attached (it then asks for the current status).
  pillReady = new Promise((resolve) => (markPillReady = resolve))
  void loadPage(win, 'pill.html')
  win.on('closed', () => {
    pill = null
  })
  pill = win
  return win
}

function showPill(): void {
  const win = ensurePill()
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  win.setBounds({
    ...PILL,
    x: Math.round(workArea.x + (workArea.width - PILL.width) / 2),
    y: Math.round(workArea.y + workArea.height - PILL.height - 48)
  })
  win.showInactive()
}

async function command(c: DictateCommand): Promise<void> {
  const win = ensurePill()
  await pillReady
  win.webContents.send('dictate:command', c)
}

/** Esc cancels while recording (as in Wispr Flow); held only for that time. */
function holdEscape(on: boolean): void {
  if (on && !escapeHeld)
    escapeHeld = globalShortcut.register('Escape', () => void command({ action: 'cancel' }))
  else if (!on && escapeHeld) {
    globalShortcut.unregister('Escape')
    escapeHeld = false
  }
}

function setStatus(next: DictationStatus): void {
  status = next
  broadcast('dictate:status', next)
  holdEscape(next.phase === 'recording')
  clearTimeout(hideTimer)
  const hideAfter = { idle: 0, done: 1600, error: 5000 }[next.phase as 'idle' | 'done' | 'error']
  if (hideAfter !== undefined) {
    hideTimer = setTimeout(() => {
      if (status.phase === next.phase) pill?.hide()
    }, hideAfter)
  }
}

/** Snapshot every format on the clipboard now (reads are lazy, so resolve them before we overwrite it). */
async function saveClipboard(): Promise<Record<string, Blob>[]> {
  const items = await clipboard.read()
  const out: Record<string, Blob>[] = []
  for (const item of items) {
    const entry: Record<string, Blob> = {}
    for (const type of item.types) {
      if (type.startsWith('electron ')) continue
      try {
        const data = await item.getType(type)
        if (data instanceof Blob) entry[type] = data
      } catch {
        // A format that can't be read back is skipped.
      }
    }
    if (Object.keys(entry).length) out.push(entry)
  }
  return out
}

const pasteDeps: PasteDeps = {
  save: saveClipboard,
  restore: async (saved) => {
    const items = saved as Record<string, Blob>[]
    if (!items.length) return clipboard.clear()
    await clipboard.write(items.map((i) => new ClipboardItem(i)))
  },
  writeText: (t) => clipboard.writeText(t),
  readText: () => clipboard.readText(),
  sendPaste: sendCtrlV,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms))
}

async function transcribe(id: string): Promise<string> {
  const settings = getSettings()
  const prompt = dictionaryPrompt(settings.listen.dictionary)
  const file = audioOf(id)
  if (settings.ai.transcription === 'local') {
    const root = whisperRoot()
    const s = whisperStatus(root)
    if (!s.engine || !s.model)
      throw new Error(
        'Install the local speech engine (Studio → Transcribe), or choose Groq in Settings.'
      )
    const wav = join(tmpdir(), `leverage-dictation-${id}.wav`)
    try {
      await execFfmpeg([
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        file,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        wav
      ])
      return await transcribeLocalText(
        { cli: cliPath(root), model: modelPath(root) },
        wav,
        prompt,
        Math.max(2, cpus().length - 1)
      )
    } finally {
      await rm(wav, { force: true })
    }
  }
  const key = keyStore().get('groq')
  if (!key) throw new Error('Add a Groq API key in Settings, or choose local transcription.')
  return transcribeGroqText(key, file, prompt)
}

function pipelineDeps(): PipelineDeps {
  const settings = getSettings()
  const provider = settings.ai.suggestions
  const key = settings.listen.cleanup ? keyStore().get(provider) : null
  const model = provider === 'groq' ? settings.ai.groqChatModel : settings.ai.openrouterModel
  return {
    engine: settings.ai.transcription,
    transcribe,
    cleanup: key
      ? (raw) => {
          const p = buildCleanupPrompt(raw, settings.listen.dictionary)
          return chat(provider, key, model, [
            { role: 'system', content: p.system },
            { role: 'user', content: p.user }
          ])
        }
      : null,
    paste: async (text) => {
      const r = await pasteText(text, settings.listen.paste, pasteDeps)
      void r.restored.catch(() => false)
      return { pasted: r.pasted }
    },
    copy: (text) => clipboard.writeText(text),
    history: historyStore(),
    keepAudio: async (id) => {
      await mkdir(join(listenDir(), 'failed'), { recursive: true })
      if (audioOf(id) !== keptAudio(id)) {
        // Copy then delete: temp and profile folders can be on different drives.
        await copyFile(tempAudio(id), keptAudio(id))
        await rm(tempAudio(id), { force: true })
      }
    },
    dropAudio: async (id) => {
      await rm(tempAudio(id), { force: true })
      await rm(keptAudio(id), { force: true })
    },
    status: (s) => {
      setStatus(s)
      // Final statuses come after the history write.
      if (s.phase === 'done' || s.phase === 'error') broadcast('dictate:historyChanged', null)
    },
    now: () => new Date()
  }
}

/** Hotkey, tray and the Listen page: start, or stop and paste. */
export function toggleDictation(): void {
  if (status.phase === 'recording') return void command({ action: 'stop' })
  if (status.phase === 'transcribing') return
  showPill()
  setStatus({ phase: 'recording' })
  void command({ action: 'start', id: newId() })
}

export function registerListenIpc(): void {
  handle('dictate:toggle', () => toggleDictation())
  handle('dictate:cancel', () => setStatus({ phase: 'idle' }))
  handle('dictate:current', (e) => {
    if (pill && !pill.isDestroyed() && e.sender === pill.webContents) markPillReady()
    return status
  })
  handle('dictate:micError', (_e, message) =>
    setStatus({ phase: 'error', message: `Microphone: ${message}` })
  )
  handle('dictate:audio', async (_e, id, data, info) => {
    await writeFile(tempAudio(id), Buffer.from(data))
    processDictation(id, info, pipelineDeps()).catch((err) =>
      setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    )
  })
  handle('dictate:history', () => historyStore().list())
  handle('dictate:retry', async (_e, id) => {
    const entry = await retryDictation(id, pipelineDeps())
    broadcast('dictate:historyChanged', null)
    return entry
  })
  handle('dictate:copy', async (_e, id) => {
    const entry = (await historyStore().list()).find((e) => e.id === id)
    if (entry?.text) await clipboard.writeText(entry.text)
  })
  handle('dictate:remove', async (_e, id) => {
    await historyStore().remove(id)
    await rm(keptAudio(id), { force: true })
    broadcast('dictate:historyChanged', null)
  })
  handle('dictate:clear', async () => {
    await historyStore().clear()
    await rm(join(listenDir(), 'failed'), { recursive: true, force: true })
    broadcast('dictate:historyChanged', null)
  })
}
