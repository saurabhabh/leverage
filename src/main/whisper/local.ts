import { spawn } from 'child_process'
import { mkdtemp, readdir, readFile, rm } from 'fs/promises'
import { cpus, tmpdir } from 'os'
import { join } from 'path'
import { relativeOffsets } from '../../shared/edit'
import type { Word } from '../../shared/transcript'
import type { RecordingManifest } from '../../shared/types'
import { execFfmpeg } from '../media/ffmpeg'

/** The voice to transcribe: the mic if recorded, else system audio. Offset is on the source timeline. */
export function speechTrack(m: RecordingManifest): { track: 'mic' | 'system'; offsetMs: number } | null {
  const track = m.tracks.mic ? 'mic' : m.tracks.system ? 'system' : null
  if (!track) return null
  return { track, offsetMs: relativeOffsets(m)[track] ?? 0 }
}

/** The speech track as 16 kHz mono WAV (whisper.cpp) or 48 kbps mono MP3 (Groq upload). */
export async function extractSpeechAudio(m: RecordingManifest, dir: string, out: string, format: 'wav16k' | 'mp3'): Promise<void> {
  const t = speechTrack(m)
  if (!t) throw new Error('This recording has no microphone or system audio to transcribe.')
  const codec = format === 'wav16k' ? ['-ar', '16000', '-c:a', 'pcm_s16le'] : ['-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k']
  await execFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', join(dir, m.tracks[t.track]!.file), '-vn', '-ac', '1', ...codec, out])
}

/** Split audio into ≤ maxMs pieces (Groq's upload limit). Returns each piece with its start time. */
export async function chunkAudio(input: string, outDir: string, maxMs = 600_000): Promise<{ file: string; startMs: number }[]> {
  await execFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-f', 'segment', '-segment_time', String(maxMs / 1000), '-c', 'copy', join(outDir, 'chunk%03d.mp3')
  ])
  const files = (await readdir(outDir)).filter((f) => /^chunk\d{3}\.mp3$/.test(f)).sort()
  return files.map((f, i) => ({ file: join(outDir, f), startMs: i * maxMs }))
}

type WhisperSegment = { offsets?: { from: number; to: number }; text?: string }

/** whisper-cli -oj output with one word per segment (-ml 1 -sow). */
export function parseWhisperJson(json: unknown): { language: string; words: Word[] } {
  const j = (json ?? {}) as { result?: { language?: string }; transcription?: WhisperSegment[] }
  const words: Word[] = []
  for (const seg of j.transcription ?? []) {
    const text = (seg.text ?? '').trim()
    if (!text || !seg.offsets) continue
    words.push({ text, startMs: seg.offsets.from, endMs: Math.max(seg.offsets.from, seg.offsets.to) })
  }
  return { language: j.result?.language ?? 'unknown', words }
}

/** Run whisper-cli; progress from its `-pp` output; the stderr tail is kept for error messages. */
export function runWhisper(cli: string, args: string[], onProgress: (pct: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cli, args, { windowsHide: true })
    const tail: string[] = []
    const onAbort = (): void => {
      child.kill()
      reject(new Error('Transcription cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stderr.on('data', (buf: Buffer) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        const m = /progress\s*=\s*(\d+)%/.exec(line)
        if (m) onProgress(Number(m[1]))
        else if (line.trim()) tail.push(line)
      }
      if (tail.length > 40) tail.splice(0, tail.length - 40)
    })
    child.stdout.resume()
    child.on('error', reject)
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (code === 0) resolve()
      else if (!signal?.aborted) reject(new Error(`Transcription failed (whisper exit ${code})\n${tail.slice(-8).join('\n')}`))
    })
  })
}

/** Run whisper.cpp on a 16 kHz mono WAV. Language is detected (English with Hindi/Marathi mixed in). */
export async function transcribeLocal(
  engine: { cli: string; model: string },
  wav: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<{ language: string; words: Word[] }> {
  // An abort listener added after the signal fired never runs, so check first.
  if (signal?.aborted) throw new Error('Transcription cancelled')
  const work = await mkdtemp(join(tmpdir(), 'leverage-whisper-'))
  try {
    const threads = String(Math.max(2, cpus().length - 1))
    const args = ['-m', engine.model, '-f', wav, '-l', 'auto', '-ml', '1', '-sow', '-oj', '-of', join(work, 'out'), '-pp', '-t', threads]
    await runWhisper(engine.cli, args, onProgress, signal)
    return parseWhisperJson(JSON.parse(await readFile(join(work, 'out.json'), 'utf8')))
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
