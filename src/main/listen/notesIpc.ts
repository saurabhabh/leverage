import { shell } from 'electron'
import { appendFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { NoteDoc } from '../../shared/listen'
import { broadcast, getSettings, handle } from '../ipc'
import { chat } from '../ai/chat'
import { transcribeGroq } from '../ai/groq'
import { keyStore } from '../ai/keys'
import { execFfmpeg } from '../media/ffmpeg'
import { libraryStore } from '../recording/ipc'
import { readTranscript, transcribeRecording } from '../transcribe/ipc'
import { cliPath, modelPath, whisperStatus } from '../whisper/install'
import { whisperRoot } from '../whisper/ipc'
import { chunkAudio, transcribeLocal } from '../whisper/local'
import { NotesStore } from './notes'
import { mixArgs, processNote, summarizeNote, type NoteDeps } from './noteProcess'
import { buildSummaryPrompt, wordsToText } from './summary'

const store = (): NotesStore =>
  new NotesStore(getSettings().listen.notesDir, (p) => shell.trashItem(p))
const changed = (id: string | null): void => broadcast('notes:changed', { id })
// Chunk appends per note+track, in arrival order.
const appending = new Map<string, Promise<void>>()

/** Meeting audio (mic and/or system) → text, with the engine chosen in Settings. */
async function transcribeMeeting(doc: NoteDoc): Promise<string> {
  const dir = store().dir(doc.id)
  const inputs = [doc.tracks.mic, doc.tracks.system]
    .filter((f): f is string => !!f)
    .map((f) => join(dir, f))
  if (!inputs.length) throw new Error('Nothing was recorded.')
  const work = await mkdtemp(join(tmpdir(), 'leverage-note-'))
  try {
    if (getSettings().ai.transcription === 'local') {
      const root = whisperRoot()
      const s = whisperStatus(root)
      if (!s.engine || !s.model)
        throw new Error(
          'Install the local speech engine (Studio → Transcribe), or choose Groq in Settings.'
        )
      const wav = join(work, 'speech.wav')
      await execFfmpeg(mixArgs(inputs, wav, 'wav16k'))
      return wordsToText(
        (await transcribeLocal({ cli: cliPath(root), model: modelPath(root) }, wav, () => {})).words
      )
    }
    const key = keyStore().get('groq')
    if (!key) throw new Error('Add a Groq API key in Settings, or choose local transcription.')
    const mp3 = join(work, 'speech.mp3')
    await execFfmpeg(mixArgs(inputs, mp3, 'mp3'))
    return wordsToText((await transcribeGroq(key, await chunkAudio(mp3, work))).words)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

async function transcribeSource(doc: NoteDoc): Promise<string> {
  if (doc.source.kind === 'meeting') return transcribeMeeting(doc)
  const found = await libraryStore().find(doc.source.recordingId)
  if (!found) throw new Error('The Studio recording is gone.')
  // Reuse the recording's transcript; make one (it also serves Studio's editor) if missing.
  const transcript =
    (await readTranscript(found.dir)) ?? (await transcribeRecording(doc.source.recordingId))
  return wordsToText(transcript.words)
}

function deps(): NoteDeps {
  const { suggestions: provider, groqChatModel, openrouterModel } = getSettings().ai
  const name = provider === 'groq' ? 'Groq' : 'OpenRouter'
  const key = keyStore().get(provider)
  return {
    store: store(),
    transcribe: transcribeSource,
    summarize: key
      ? (m) => {
          const p = buildSummaryPrompt(m)
          const model = provider === 'groq' ? groqChatModel : openrouterModel
          const messages = [
            { role: 'system' as const, content: p.system },
            { role: 'user' as const, content: p.user }
          ]
          // Plain Markdown, not JSON mode: long notes inside a JSON string made Groq reject whole
          // replies ("Failed to validate JSON"). Notes are worth the wait, so reasoning runs high.
          return chat(provider, key, model, messages, { json: false, reasoningEffort: 'high' })
        }
      : null,
    noSummaryReason: `Add a ${name} API key in Settings for an AI summary.`,
    changed
  }
}

const background = (id: string, job: Promise<unknown>): void =>
  void job.catch((err) =>
    store()
      .update(id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
      .then(() => changed(id))
  )

/** Notes left mid-way when Leverage closed: their audio/transcript is kept and they can be retried. */
export async function recoverNotes(): Promise<void> {
  const s = store()
  for (const n of await s.list()) {
    if (n.status === 'ready' || n.status === 'error') continue
    await s.update(n.id, {
      status: 'error',
      error: 'Leverage closed before this note was finished.'
    })
  }
}

export function registerNotesIpc(): void {
  handle('notes:retry', async (_e, id) => {
    background(id, processNote(id, deps()))
  })
  handle('notes:list', () => store().list())
  handle('notes:get', async (_e, id) => {
    const doc = await store().get(id)
    if (!doc) throw new Error('Note not found.')
    return doc
  })
  handle('notes:save', async (_e, id, patch) => {
    const doc = await store().saveUser(id, patch)
    changed(id)
    return doc
  })
  handle('notes:delete', async (_e, id) => {
    await store().remove(id)
    changed(null)
  })
  handle('notes:summarize', (_e, id) => summarizeNote(id, deps()))
  handle('notes:fromRecording', async (_e, recordingId) => {
    const found = await libraryStore().find(recordingId)
    if (!found) throw new Error('Recording not found.')
    const doc = await store().create({
      title: found.manifest.title,
      source: { kind: 'recording', recordingId, title: found.manifest.title }
    })
    changed(null)
    background(doc.id, processNote(doc.id, deps()))
    return doc
  })
  handle('notes:meetingStart', async (_e, title) => {
    const doc = await store().create({
      title: title.trim() || 'Meeting',
      source: { kind: 'meeting' }
    })
    changed(null)
    return doc
  })
  handle('notes:meetingChunk', (_e, id, track, data) => {
    const s = store()
    const key = `${id}/${track}`
    const next = (appending.get(key) ?? Promise.resolve()).then(async () => {
      const file = `${track}.webm`
      // Inside the store's queue: the mic's and the system's first chunks arrive together.
      await s.update(id, (doc) => ({ tracks: { ...doc.tracks, [track]: file } }))
      await appendFile(join(s.dir(id), file), Buffer.from(data))
    })
    appending.set(
      key,
      next.catch(() => undefined)
    )
    return next
  })
  handle('notes:meetingWarn', async (_e, id, warning) => {
    await store().update(id, (doc) => ({
      warnings: doc.warnings.includes(warning) ? doc.warnings : [...doc.warnings, warning]
    }))
    changed(id)
  })
  handle('notes:meetingStop', async (_e, id, durationMs) => {
    // Every chunk already sent is on disk before processing starts.
    await Promise.all([appending.get(`${id}/mic`), appending.get(`${id}/system`)])
    await store().update(id, { durationMs })
    background(id, processNote(id, deps()))
  })
}
