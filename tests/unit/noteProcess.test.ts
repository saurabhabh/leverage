import { test, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NotesStore } from '../../src/main/listen/notes'
import {
  mixArgs,
  processNote,
  summarizeNote,
  type NoteDeps
} from '../../src/main/listen/noteProcess'

let store: NotesStore
let deps: NoteDeps
let changed: string[]

beforeEach(() => {
  store = new NotesStore(join(mkdtempSync(join(tmpdir(), 'lev-np-')), 'Notes'), async (p) =>
    rmSync(p, { recursive: true, force: true })
  )
  changed = []
  deps = {
    store,
    transcribe: async () => 'we agreed to ship on friday',
    summarize: async () => '{"summary":"## Summary\\nShip Friday."}',
    noSummaryReason: 'Add a Groq key',
    changed: (id) => void changed.push(id)
  }
})

const meeting = (): Promise<{ id: string }> =>
  store.create({ title: 'Sync', source: { kind: 'meeting' } })

test('transcribe then summarise; every step is announced', async () => {
  const { id } = await meeting()
  const done = await processNote(id, deps)
  expect(done).toMatchObject({
    status: 'ready',
    transcript: 'we agreed to ship on friday',
    summary: '## Summary\nShip Friday.'
  })
  expect(done.error).toBeUndefined()
  expect(changed.length).toBeGreaterThanOrEqual(3)
})

test('without an AI key the transcript is kept and the note says why there is no summary', async () => {
  const { id } = await meeting()
  const done = await processNote(id, { ...deps, summarize: null })
  expect(done).toMatchObject({
    status: 'ready',
    transcript: 'we agreed to ship on friday',
    summary: null
  })
  expect(done.warnings).toContain('Add a Groq key')
})

test('a provider error keeps the transcript and records the error; Regenerate can fix it', async () => {
  const { id } = await meeting()
  const failed = await processNote(id, {
    ...deps,
    summarize: async () => {
      throw new Error('Groq rejected the key (401)')
    }
  })
  expect(failed).toMatchObject({
    status: 'ready',
    transcript: 'we agreed to ship on friday',
    summary: null,
    error: 'Groq rejected the key (401)'
  })
  const fixed = await summarizeNote(id, deps)
  expect(fixed).toMatchObject({ summary: '## Summary\nShip Friday.' })
  expect(fixed.error).toBeUndefined()
})

test('a transcription failure marks the note as failed but keeps the audio and notes', async () => {
  const { id } = await meeting()
  await store.saveUser(id, { notes: 'mine' })
  const failed = await processNote(id, {
    ...deps,
    transcribe: async () => {
      throw new Error('Install the local speech engine')
    }
  })
  expect(failed).toMatchObject({
    status: 'error',
    error: 'Install the local speech engine',
    notes: 'mine'
  })
})

test('nothing said → no summary call', async () => {
  const { id } = await meeting()
  let asked = false
  const done = await processNote(id, {
    ...deps,
    transcribe: async () => '  ',
    summarize: async () => {
      asked = true
      return '{}'
    }
  })
  expect(asked).toBe(false)
  expect(done.warnings).toContain('No speech was recognised.')
})

test('nothing of substance → a short note instead of an invented summary', async () => {
  const { id } = await meeting()
  const done = await processNote(id, { ...deps, summarize: async () => '{"nothing":true}' })
  expect(done.summary).toMatch(/nothing to summarise/i)
})

test('mixArgs: one track is converted; two are mixed without halving the volume', () => {
  expect(mixArgs(['mic.webm'], 'out.wav', 'wav16k')).toEqual([
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    'mic.webm',
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    'out.wav'
  ])
  const two = mixArgs(['mic.webm', 'system.webm'], 'out.mp3', 'mp3')
  expect(two).toEqual(
    expect.arrayContaining(['-i', 'mic.webm', '-i', 'system.webm', '-map', '[m]', 'libmp3lame'])
  )
  expect(two[two.indexOf('-filter_complex') + 1]).toBe(
    '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[m]'
  )
})
