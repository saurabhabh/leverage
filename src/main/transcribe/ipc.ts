import { readFile, rename, rm, writeFile, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { toTrackTime, TranscriptSchema, type Transcript } from '../../shared/transcript'
import { keyStore } from '../ai/keys'
import { transcribeGroq } from '../ai/groq'
import { broadcast, getSettings, handle } from '../ipc'
import { libraryStore } from '../recording/ipc'
import { cliPath, modelPath, whisperStatus } from '../whisper/install'
import { whisperRoot } from '../whisper/ipc'
import { chunkAudio, extractSpeechAudio, speechTrack, transcribeLocal } from '../whisper/local'

/** Thrown when the local engine isn't installed; the renderer answers with the download dialog. */
export const NEEDS_INSTALL = 'NEEDS_INSTALL'
const TRANSCRIPT = 'transcript.json'

const running = new Map<string, AbortController>()

async function recording(id: string): Promise<{ dir: string; manifest: import('../../shared/types').RecordingManifest }> {
  const found = await libraryStore().find(id)
  if (!found) throw new Error('Recording not found.')
  return found
}

export async function readTranscript(dir: string): Promise<Transcript | null> {
  try {
    const parsed = TranscriptSchema.safeParse(JSON.parse(await readFile(join(dir, TRANSCRIPT), 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function run(id: string): Promise<Transcript> {
  const { dir, manifest } = await recording(id)
  const speech = speechTrack(manifest)
  if (!speech) throw new Error('This recording has no microphone or system audio to transcribe.')
  const engine = getSettings().ai.transcription
  const progress = (stage: string, pct: number): void => broadcast('transcribe:progress', { id, stage, pct })
  const abort = new AbortController()
  running.get(id)?.abort()
  running.set(id, abort)
  const work = await mkdtemp(join(tmpdir(), 'leverage-transcribe-'))
  try {
    progress('Preparing audio', 0)
    let result: { language: string; words: Transcript['words'] }
    if (engine === 'local') {
      const root = whisperRoot()
      const status = whisperStatus(root)
      if (!status.engine || !status.model) throw new Error(NEEDS_INSTALL)
      const wav = join(work, 'speech.wav')
      await extractSpeechAudio(manifest, dir, wav, 'wav16k')
      result = await transcribeLocal({ cli: cliPath(root), model: modelPath(root) }, wav, (p) => progress('Transcribing', p), abort.signal)
    } else {
      const key = keyStore().get('groq')
      if (!key) throw new Error('Add a Groq API key in Settings')
      const mp3 = join(work, 'speech.mp3')
      await extractSpeechAudio(manifest, dir, mp3, 'mp3')
      const chunks = await chunkAudio(mp3, work)
      progress('Uploading to Groq', 10)
      result = await transcribeGroq(key, chunks, fetch, undefined, abort.signal)
    }
    const transcript: Transcript = {
      version: 1,
      engine,
      language: result.language,
      track: speech.track,
      words: toTrackTime(result.words, speech.offsetMs),
      createdAt: new Date().toISOString()
    }
    const temp = join(dir, `${TRANSCRIPT}.tmp`)
    await writeFile(temp, JSON.stringify(transcript))
    await rename(temp, join(dir, TRANSCRIPT))
    progress('Done', 100)
    return transcript
  } finally {
    if (running.get(id) === abort) running.delete(id)
    await rm(work, { recursive: true, force: true })
  }
}

export function registerTranscribeIpc(): void {
  handle('transcribe:run', (_e, id) => run(id))
  handle('transcribe:get', async (_e, id) => readTranscript((await recording(id)).dir))
  handle('transcribe:cancel', (_e, id) => running.get(id)?.abort())
}
