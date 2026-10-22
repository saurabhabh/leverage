import { test, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import ffmpeg from 'ffmpeg-static'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { parseWhisperJson, speechTrack, transcribeLocal } from '../../src/main/whisper/local'
import type { RecordingManifest } from '../../src/shared/types'

const fixture = (name: string): string => resolve(__dirname, '..', 'fixtures', name)
const LAB = resolve(__dirname, '..', '..', '_lab', 'whisper-dl')
const engine = { cli: join(LAB, 'bin', 'Release', 'whisper-cli.exe'), model: join(LAB, 'models', 'ggml-base.bin') }
const haveEngine = existsSync(engine.cli) && existsSync(engine.model)

test('parseWhisperJson reads offsets.from/to and drops empty tokens', () => {
  const { language, words } = parseWhisperJson(JSON.parse(readFileSync(fixture('whisper-out.json'), 'utf8')))
  expect(language).toBe('en')
  expect(words[0]).toEqual({ text: 'Hello', startMs: 150, endMs: 400 })
  expect(words.some((w) => w.text === '')).toBe(false)
  expect(words.map((w) => w.text)).toContain('Um,')
})

test('parseWhisperJson tolerates missing transcription', () => {
  expect(parseWhisperJson({})).toEqual({ language: 'unknown', words: [] })
})

test('speechTrack prefers the mic, then system audio, with its relative offset', () => {
  const m = (tracks: RecordingManifest['tracks']): RecordingManifest => ({ tracks }) as RecordingManifest
  const t = (offsetMs: number): { file: string; mime: string; offsetMs: number } => ({ file: 'x', mime: 'x', offsetMs })
  expect(speechTrack(m({ screen: t(2000), mic: t(2050), system: t(2000) }))).toEqual({ track: 'mic', offsetMs: 50 })
  expect(speechTrack(m({ screen: t(0), system: t(30) }))).toEqual({ track: 'system', offsetMs: 30 })
  expect(speechTrack(m({ screen: t(0) }))).toBeNull()
})

test.skipIf(!haveEngine)('real local transcription finds "welcome" and "record"', async () => {
  const progress: number[] = []
  const { words } = await transcribeLocal(engine, fixture('speech.wav'), (p) => progress.push(p))
  const text = words.map((w) => w.text.toLowerCase())
  expect(text.some((t) => t.startsWith('welcome'))).toBe(true)
  expect(text.some((t) => t.startsWith('record'))).toBe(true)
  const welcome = words.find((w) => w.text.toLowerCase().startsWith('welcome'))!
  expect(welcome.startMs).toBeGreaterThan(300)
  expect(welcome.startMs).toBeLessThan(1600)
  expect(progress.length).toBeGreaterThan(0)
}, 120_000)

test.skipIf(!haveEngine)('silent audio gives no words', async () => {
  const wav = join(mkdtempSync(join(tmpdir(), 'lev-silent-')), 'silent.wav')
  execFileSync(ffmpeg!, ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '3', '-c:a', 'pcm_s16le', wav])
  const { words } = await transcribeLocal(engine, wav, () => {})
  // Whisper may hallucinate a stray token on pure silence; it must not invent speech.
  expect(words.length).toBeLessThanOrEqual(2)
}, 120_000)
