import { describe, test, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { defaultSettings, loadSettings, saveSettings } from '../../src/main/settings'

const HOME = 'C:\Users\tester'
let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lev-settings-'))
  file = join(dir, 'settings.json')
})

describe('settings', () => {
  test('defaults when file missing', () => {
    const s = loadSettings(file, HOME)
    expect(s).toEqual(defaultSettings(HOME))
    expect(s.libraryDir).toBe(join(HOME, 'Videos', 'Leverage'))
    expect(s.countdownSec).toBe(3)
    expect(s.confirmAbort).toBe(true)
    expect(s.hotkeys).toEqual({
      toggle: 'CommandOrControl+Shift+R',
      pause: 'CommandOrControl+Shift+P',
      abort: 'CommandOrControl+Shift+X'
    })
    expect(s.snap).toEqual({ dir: join(HOME, 'Pictures', 'Leverage'), hotkey: 'CommandOrControl+Shift+2' })
  })

  test('defaults when file is invalid JSON', () => {
    writeFileSync(file, '{not json')
    expect(loadSettings(file, HOME)).toEqual(defaultSettings(HOME))
  })

  test('merges partial file over defaults', () => {
    writeFileSync(file, JSON.stringify({ countdownSec: 5, bogus: 1 }))
    const s = loadSettings(file, HOME)
    expect(s.countdownSec).toBe(5)
    expect(s.confirmAbort).toBe(true)
    expect('bogus' in s).toBe(false)
  })

  test('a settings file from before Snap existed gets Snap defaults', () => {
    writeFileSync(file, JSON.stringify({ libraryDir: 'D:\\Rec' }))
    const s = loadSettings(file, HOME)
    expect(s.libraryDir).toBe('D:\\Rec')
    expect(s.snap).toEqual(defaultSettings(HOME).snap)
  })

  test('invalid field values fall back to defaults', () => {
    writeFileSync(file, JSON.stringify({ countdownSec: 'ten', confirmAbort: false }))
    const s = loadSettings(file, HOME)
    expect(s.countdownSec).toBe(3)
    expect(s.confirmAbort).toBe(false)
  })

  test('round-trips save/load', () => {
    const s = { ...defaultSettings(HOME), libraryDir: 'D:\Rec', countdownSec: 0 }
    saveSettings(file, s)
    expect(loadSettings(file, HOME)).toEqual(s)
  })
})
