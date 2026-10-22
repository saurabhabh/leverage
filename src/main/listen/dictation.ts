import type { DictationEntry, DictationStatus } from '../../shared/listen'
import type { GateDecision } from '../../shared/speechGate'
import { pickCleaned } from './cleanup'
import type { HistoryStore } from './history'

/** Shorter than this is a mis-press, not a dictation. */
export const MIN_DURATION_MS = 300

export type PipelineDeps = {
  engine: 'local' | 'groq'
  /** Text from the dictation's audio (by id). */
  transcribe: (id: string) => Promise<string>
  /** Raw model reply for a cleanup request; null when cleanup is off or has no key. */
  cleanup: ((raw: string) => Promise<string>) | null
  paste: (text: string) => Promise<{ pasted: boolean }>
  copy: (text: string) => Promise<void>
  history: HistoryStore
  /** Move the audio somewhere safe so the dictation can be retried. */
  keepAudio: (id: string) => Promise<void>
  dropAudio: (id: string) => Promise<void>
  status: (s: DictationStatus) => void
  now: () => Date
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message.split('\n')[0] : String(err)

async function transcribeAndClean(
  id: string,
  deps: PipelineDeps
): Promise<{ raw: string; text: string; cleaned: boolean }> {
  const raw = (await deps.transcribe(id)).trim()
  if (!raw || !deps.cleanup) return { raw, text: raw, cleaned: false }
  try {
    return { raw, ...pickCleaned(raw, await deps.cleanup(raw)) }
  } catch {
    // Cleanup is a nicety: if the provider fails, the words still get through.
    return { raw, text: raw, cleaned: false }
  }
}

/**
 * One dictation, after recording stopped. Words are never lost: a failure keeps the audio for Retry,
 * a cleanup problem pastes the raw text. Silence and mis-presses are dropped before Whisper sees them.
 */
export async function processDictation(
  id: string,
  info: { durationMs: number; gate: GateDecision },
  deps: PipelineDeps
): Promise<DictationEntry | null> {
  const nothing = async (msg: string): Promise<null> => {
    await deps.dropAudio(id)
    deps.status({ phase: 'done', message: msg })
    deps.status({ phase: 'idle' })
    return null
  }
  if (info.durationMs < MIN_DURATION_MS) return nothing('Too short')
  if (info.gate.skip) return nothing('No speech heard')

  deps.status({ phase: 'transcribing' })
  const base = {
    id,
    createdAt: deps.now().toISOString(),
    durationMs: info.durationMs,
    engine: deps.engine
  }
  let result: { raw: string; text: string; cleaned: boolean }
  try {
    result = await transcribeAndClean(id, deps)
  } catch (err) {
    await deps.keepAudio(id)
    const entry: DictationEntry = {
      ...base,
      raw: '',
      text: '',
      cleaned: false,
      pasted: false,
      error: message(err),
      audio: true
    }
    await deps.history.add(entry)
    deps.status({ phase: 'error', message: entry.error })
    return entry
  }
  if (!result.raw) return nothing('No speech heard')
  if (!result.text) return nothing('Nothing to paste')
  const { pasted } = await deps.paste(result.text)
  const entry: DictationEntry = { ...base, ...result, pasted }
  await deps.history.add(entry)
  await deps.dropAudio(id)
  deps.status({
    phase: 'done',
    text: result.text,
    message: pasted ? 'Pasted' : 'Copied — press Ctrl+V'
  })
  return entry
}

/** Transcribe a failed dictation again. The original app has moved on, so the result is only copied. */
export async function retryDictation(id: string, deps: PipelineDeps): Promise<DictationEntry> {
  const entry = (await deps.history.list()).find((e) => e.id === id)
  if (!entry?.audio) throw new Error('This dictation has no audio to retry.')
  try {
    const result = await transcribeAndClean(id, { ...deps })
    const fixed: DictationEntry = {
      ...entry,
      ...result,
      engine: deps.engine,
      pasted: false,
      error: undefined,
      audio: false
    }
    await deps.copy(result.text)
    await deps.history.update(id, fixed)
    await deps.dropAudio(id)
    return fixed
  } catch (err) {
    await deps.history.update(id, { error: message(err) })
    throw err
  }
}
