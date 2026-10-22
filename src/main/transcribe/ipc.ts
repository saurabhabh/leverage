import { readFile, rename, rm, writeFile, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseSilences, toTrackTime, TranscriptSchema, type Range, type Transcript } from '../../shared/transcript'
import { ffmpegStderr } from '../media/ffmpeg'
import { probeDurationSeconds } from '../media/probe'
import { keyStore } from '../ai/keys'
import { transcribeGroq } from '../ai/groq'
import { chat } from '../ai/chat'
import { buildSuggestPrompt, parseSuggestions } from '../ai/suggest'
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

/** Transcribe a recording (engine from Settings) and save transcript.json beside it. */
export async function transcribeRecording(id: string): Promise<Transcript> {
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

/** Long pauses in the speech track (≥ 1 s below -35 dB), padded 250 ms, on the source timeline. */
async function silences(id: string): Promise<Range[]> {
  const { dir, manifest } = await recording(id)
  const speech = speechTrack(manifest)
  if (!speech) throw new Error('This recording has no microphone or system audio to check for pauses.')
  const file = join(dir, manifest.tracks[speech.track]!.file)
  const stderr = await ffmpegStderr(['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'silencedetect=n=-35dB:d=1.0', '-f', 'null', '-'])
  const endMs = (await probeDurationSeconds(file).catch(() => 0)) * 1000 || undefined
  return parseSilences(stderr, 250, endMs).map((r) => ({ startMs: r.startMs + speech.offsetMs, endMs: r.endMs + speech.offsetMs }))
}

/** Ask the chosen provider for cuts. Only the transcript text is sent. */
async function suggestCuts(id: string, targetSeconds?: number): Promise<{
  cuts: { from: number; to: number; reason: string; startMs: number; endMs: number }[]
  dropped: number
}> {
  const { dir } = await recording(id)
  const transcript = await readTranscript(dir)
  if (!transcript?.words.length) throw new Error('Transcribe the recording first.')
  const { suggestions, groqChatModel, openrouterModel } = getSettings().ai
  const name = suggestions === 'groq' ? 'Groq' : 'OpenRouter'
  const key = keyStore().get(suggestions)
  if (!key) throw new Error(`Add a ${name} API key in Settings`)
  const prompt = buildSuggestPrompt(transcript.words, { targetSeconds })
  const reply = await chat(suggestions, key, suggestions === 'groq' ? groqChatModel : openrouterModel, [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ])
  const parsed = parseSuggestions(reply, transcript.words.length)
  if (parsed.error) throw new Error(parsed.error)
  const w = transcript.words
  return {
    cuts: parsed.cuts.map((c) => ({ ...c, startMs: w[c.from].startMs, endMs: w[c.to].endMs })),
    dropped: parsed.dropped
  }
}

export function registerTranscribeIpc(): void {
  handle('ai:suggestCuts', (_e, id, targetSeconds) => suggestCuts(id, targetSeconds))
  handle('autocut:silences', (_e, id) => silences(id))
  handle('transcribe:run', (_e, id) => transcribeRecording(id))
  handle('transcribe:get', async (_e, id) => readTranscript((await recording(id)).dir))
  handle('transcribe:cancel', (_e, id) => running.get(id)?.abort())
}
