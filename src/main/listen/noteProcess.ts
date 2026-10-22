import type { NoteDoc } from '../../shared/listen'
import type { NotesStore } from './notes'
import { parseSummary } from './summary'

export type NoteDeps = {
  store: NotesStore
  /** The note's speech as text (meeting audio, or the Studio recording's transcript). */
  transcribe: (doc: NoteDoc) => Promise<string>
  /** Raw reply for a summary request; null when no AI key is set. */
  summarize: ((m: { title: string; transcript: string; notes: string }) => Promise<string>) | null
  /** Shown on the note when `summarize` is null. */
  noSummaryReason: string
  changed: (id: string) => void
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message.split('\n')[0] : String(err)
export const NOTHING = '_Nothing to summarise: the recording had no substantive discussion._'

/** ffmpeg: one track converted, or mic + system mixed at full volume, to Whisper's input format. */
export function mixArgs(inputs: string[], out: string, format: 'wav16k' | 'mp3'): string[] {
  const codec = format === 'wav16k' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-b:a', '48k']
  const ins = inputs.flatMap((f) => ['-i', f])
  const mix =
    inputs.length > 1
      ? [
          '-filter_complex',
          `${inputs.map((_, i) => `[${i}:a]`).join('')}amix=inputs=${inputs.length}:duration=longest:normalize=0[m]`,
          '-map',
          '[m]'
        ]
      : ['-vn']
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...ins,
    ...mix,
    '-ac',
    '1',
    '-ar',
    '16000',
    ...codec,
    out
  ]
}

async function set(deps: NoteDeps, id: string, patch: Partial<NoteDoc>): Promise<NoteDoc> {
  const doc = await deps.store.update(id, patch)
  deps.changed(id)
  return doc
}

/** Write the AI summary. A provider failure keeps everything else and is shown on the note. */
export async function summarizeNote(id: string, deps: NoteDeps): Promise<NoteDoc> {
  const doc = await deps.store.get(id)
  if (!doc) throw new Error('Note not found.')
  if (!doc.transcript?.trim()) throw new Error('There is no transcript to summarise yet.')
  if (!deps.summarize) throw new Error(deps.noSummaryReason)
  await set(deps, id, { status: 'summarizing', error: undefined })
  try {
    const parsed = parseSummary(
      await deps.summarize({ title: doc.title, transcript: doc.transcript, notes: doc.notes })
    )
    if ('error' in parsed) return set(deps, id, { status: 'ready', error: parsed.error })
    return set(deps, id, {
      status: 'ready',
      summary: 'nothing' in parsed ? NOTHING : parsed.summary,
      error: undefined,
      // A key exists now, so "add a key" no longer applies.
      warnings: doc.warnings.filter((w) => w !== deps.noSummaryReason)
    })
  } catch (err) {
    return set(deps, id, { status: 'ready', error: message(err) })
  }
}

/** After recording (or for a Studio recording): transcript, then summary when a key exists. */
export async function processNote(id: string, deps: NoteDeps): Promise<NoteDoc> {
  const doc = await set(deps, id, { status: 'transcribing', error: undefined })
  let transcript: string
  try {
    transcript = (await deps.transcribe(doc)).trim()
  } catch (err) {
    return set(deps, id, { status: 'error', error: message(err) })
  }
  if (!transcript) {
    return set(deps, id, {
      status: 'ready',
      transcript: '',
      warnings: [...doc.warnings, 'No speech was recognised.']
    })
  }
  if (!deps.summarize) {
    return set(deps, id, {
      status: 'ready',
      transcript,
      warnings: [...doc.warnings, deps.noSummaryReason]
    })
  }
  await set(deps, id, { transcript })
  return summarizeNote(id, deps)
}
