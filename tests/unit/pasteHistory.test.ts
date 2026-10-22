import { describe, test, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pasteText, type PasteDeps } from '../../src/main/listen/paste'
import { HistoryStore } from '../../src/main/listen/history'
import type { DictationEntry } from '../../src/shared/listen'

function fakeClipboard(initial: string): {
  deps: PasteDeps
  log: string[]
  board: { text: string }
} {
  const board = { text: initial }
  const log: string[] = []
  const deps: PasteDeps = {
    save: async () => board.text,
    restore: async (saved) => {
      log.push(`restore:${saved}`)
      board.text = saved as string
    },
    writeText: async (t) => {
      log.push(`write:${t}`)
      board.text = t
    },
    readText: async () => board.text,
    sendPaste: async () => void log.push('ctrl+v'),
    sleep: async (ms) => void log.push(`sleep:${ms}`)
  }
  return { deps, log, board }
}

describe('pasteText', () => {
  test('writes, waits, pastes, then restores the old clipboard', async () => {
    const { deps, log, board } = fakeClipboard('old')
    const r = await pasteText('Hello.', true, deps)
    expect(r.pasted).toBe(true)
    expect(await r.restored).toBe(true)
    expect(log).toEqual(['write:Hello.', 'sleep:40', 'ctrl+v', 'sleep:500', 'restore:old'])
    expect(board.text).toBe('old')
  })

  test('does not restore if something else changed the clipboard meanwhile', async () => {
    const { deps, board } = fakeClipboard('old')
    deps.sleep = async (ms) => {
      if (ms === 500) board.text = 'user copied this'
    }
    const r = await pasteText('Hello.', true, deps)
    expect(await r.restored).toBe(false)
    expect(board.text).toBe('user copied this')
  })

  test('paste off: only copies, never restores', async () => {
    const { deps, log, board } = fakeClipboard('old')
    const r = await pasteText('Hello.', false, deps)
    expect(r.pasted).toBe(false)
    expect(await r.restored).toBe(false)
    expect(log).toEqual(['write:Hello.'])
    expect(board.text).toBe('Hello.')
  })

  test('if the keystroke fails the text stays on the clipboard', async () => {
    const { deps, board } = fakeClipboard('old')
    deps.sendPaste = async () => {
      throw new Error('no powershell')
    }
    const r = await pasteText('Hello.', true, deps)
    expect(r.pasted).toBe(false)
    expect(await r.restored).toBe(false)
    expect(board.text).toBe('Hello.')
  })
})

describe('HistoryStore', () => {
  let file: string
  const entry = (id: string): DictationEntry => ({
    id,
    createdAt: new Date(2026, 0, Number(id) || 1).toISOString(),
    durationMs: 1000,
    engine: 'groq',
    raw: `raw ${id}`,
    text: `text ${id}`,
    cleaned: false,
    pasted: true
  })
  beforeEach(() => {
    file = join(mkdtempSync(join(tmpdir(), 'lev-hist-')), 'listen', 'history.json')
  })

  test('add puts newest first and survives reload; capped', async () => {
    const h = new HistoryStore(file, 3)
    for (const id of ['1', '2', '3', '4']) await h.add(entry(id))
    expect((await new HistoryStore(file, 3).list()).map((e) => e.id)).toEqual(['4', '3', '2'])
  })

  test('update, remove, clear', async () => {
    const h = new HistoryStore(file)
    await h.add(entry('1'))
    await h.add(entry('2'))
    await h.update('1', { text: 'fixed', error: undefined })
    expect((await h.list()).find((e) => e.id === '1')?.text).toBe('fixed')
    await h.remove('2')
    expect((await h.list()).map((e) => e.id)).toEqual(['1'])
    await h.clear()
    expect(await h.list()).toEqual([])
  })

  test('a corrupt or invalid file reads as empty, keeping valid entries only', async () => {
    const h = new HistoryStore(file)
    await h.add(entry('1'))
    writeFileSync(file, '{broken')
    expect(await h.list()).toEqual([])
    writeFileSync(file, JSON.stringify([entry('5'), { id: 'bad' }]))
    expect((await h.list()).map((e) => e.id)).toEqual(['5'])
  })
})
