import { test, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  processDictation,
  retryDictation,
  type PipelineDeps
} from '../../src/main/listen/dictation'
import { HistoryStore } from '../../src/main/listen/history'
import type { DictationStatus } from '../../src/shared/listen'

let statuses: DictationStatus[]
let pasted: string[]
let kept: string[]
let dropped: string[]
let copied: string[]
let deps: PipelineDeps
const speech = { skip: false, reason: 'speech_detected' } as const

beforeEach(() => {
  statuses = []
  pasted = []
  kept = []
  dropped = []
  copied = []
  deps = {
    engine: 'groq',
    transcribe: async () => 'um send it by friday',
    cleanup: async () => '{"text":"Send it by Friday."}',
    paste: async (t) => {
      pasted.push(t)
      return { pasted: true }
    },
    copy: async (t) => void copied.push(t),
    history: new HistoryStore(join(mkdtempSync(join(tmpdir(), 'lev-pipe-')), 'h.json')),
    keepAudio: async (id) => void kept.push(id),
    dropAudio: async (id) => void dropped.push(id),
    status: (s) => void statuses.push(s),
    now: () => new Date(2026, 9, 22)
  }
})

test('speech → transcribe → clean → paste → history', async () => {
  const entry = await processDictation('d1', { durationMs: 2000, gate: speech }, deps)
  expect(pasted).toEqual(['Send it by Friday.'])
  expect(entry).toMatchObject({
    raw: 'um send it by friday',
    text: 'Send it by Friday.',
    cleaned: true,
    pasted: true,
    engine: 'groq'
  })
  expect((await deps.history.list()).map((e) => e.id)).toEqual(['d1'])
  expect(statuses.map((s) => s.phase)).toEqual(['transcribing', 'done'])
  expect(dropped).toEqual(['d1'])
})

test('silence and very short presses never reach the transcriber', async () => {
  let called = false
  deps.transcribe = async () => {
    called = true
    return 'Thank you.'
  }
  expect(
    await processDictation(
      'd1',
      { durationMs: 2000, gate: { skip: true, reason: 'silence' } },
      deps
    )
  ).toBeNull()
  expect(await processDictation('d1', { durationMs: 150, gate: speech }, deps)).toBeNull()
  expect(called).toBe(false)
  expect(pasted).toEqual([])
  expect(statuses.filter((s) => s.phase === 'done').map((s) => s.message)).toEqual([
    'No speech heard',
    'Too short'
  ])
})

test('cleanup failing or off pastes the raw words', async () => {
  deps.cleanup = async () => {
    throw new Error('401')
  }
  expect(await processDictation('d1', { durationMs: 2000, gate: speech }, deps)).toMatchObject({
    text: 'um send it by friday',
    cleaned: false
  })
  deps.cleanup = null
  await processDictation('d1', { durationMs: 2000, gate: speech }, deps)
  expect(pasted).toEqual(['um send it by friday', 'um send it by friday'])
})

test('a transcription failure keeps the audio, records the error, and Retry recovers it', async () => {
  deps.transcribe = async () => {
    throw new Error('Groq is unreachable')
  }
  const failed = await processDictation('d1', { durationMs: 2000, gate: speech }, deps)
  expect(failed).toMatchObject({ error: 'Groq is unreachable', audio: true, pasted: false })
  expect(kept).toEqual(['d1'])
  expect(statuses.at(-1)).toMatchObject({ phase: 'error', message: 'Groq is unreachable' })

  deps.transcribe = async () => 'second try'
  deps.cleanup = null
  const fixed = await retryDictation('d1', deps)
  expect(fixed).toMatchObject({ text: 'second try', error: undefined, audio: false })
  expect(dropped).toContain('d1')
  // A retry only copies: the app the user dictated into is long gone.
  expect(pasted).toEqual([])
  expect(copied).toEqual(['second try'])
  expect((await deps.history.list())[0].text).toBe('second try')
})

test('nothing transcribed → no paste, no history', async () => {
  deps.transcribe = async () => '  '
  expect(await processDictation('d1', { durationMs: 2000, gate: speech }, deps)).toBeNull()
  expect(await deps.history.list()).toEqual([])
})
