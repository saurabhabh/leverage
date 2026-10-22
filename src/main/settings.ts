import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { Settings, SettingsSchema } from '../shared/types'

export function defaultSettings(home: string): Settings {
  return {
    libraryDir: join(home, 'Videos', 'Leverage'),
    countdownSec: 3,
    confirmAbort: true,
    hotkeys: {
      toggle: 'CommandOrControl+Shift+R',
      pause: 'CommandOrControl+Shift+P',
      abort: 'CommandOrControl+Shift+X'
    },
    ai: {
      transcription: 'local',
      suggestions: 'groq',
      groqChatModel: 'openai/gpt-oss-120b',
      openrouterModel: 'anthropic/claude-sonnet-5.5'
    },
    snap: {
      dir: join(home, 'Pictures', 'Leverage'),
      // Ctrl+Shift+X is Studio's abort, and Windows 11 gives Print Screen to Snipping Tool.
      hotkey: 'CommandOrControl+Shift+2'
    }
  }
}

/** Missing or corrupt file → defaults; each valid field overrides its default; unknown keys are dropped. */
export function loadSettings(file: string, home: string): Settings {
  const settings = defaultSettings(home)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return settings
  }
  if (typeof raw !== 'object' || raw === null) return settings
  const record = raw as Record<string, unknown>
  for (const key of Object.keys(SettingsSchema.shape) as (keyof Settings)[]) {
    const parsed = SettingsSchema.shape[key].safeParse(record[key])
    if (parsed.success) (settings as Record<string, unknown>)[key] = parsed.data
  }
  return settings
}

export function saveSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify(SettingsSchema.parse(settings), null, 2))
  renameSync(temp, file)
}
