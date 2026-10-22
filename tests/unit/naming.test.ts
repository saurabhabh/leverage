import { test, expect } from 'vitest'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { recordingDirName, uniqueDir } from '../../src/main/recording/naming'

test('recordingDirName formats local time as YYYY-MM-DD HH-mm-ss', () => {
  expect(recordingDirName(new Date(2026, 9, 22, 14, 5, 9))).toBe('2026-10-22 14-05-09')
})

test('uniqueDir returns base when free, "<base> (2)" when base exists and "<base> (3)" when both exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'lev-naming-'))
  expect(uniqueDir(root, 'rec')).toBe(join(root, 'rec'))
  mkdirSync(join(root, 'rec'))
  expect(uniqueDir(root, 'rec')).toBe(join(root, 'rec (2)'))
  mkdirSync(join(root, 'rec (2)'))
  expect(uniqueDir(root, 'rec')).toBe(join(root, 'rec (3)'))
})
