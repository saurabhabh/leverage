import { test, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { KeyStore } from '../../src/main/secrets'
import { defaultSettings, loadSettings } from '../../src/main/settings'

/** Reversible stand-in for safeStorage (XOR), so the file never holds the plain key. */
const fakeCipher = (available = true) => ({
  available: () => available,
  encrypt: (s: string) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decrypt: (b: Buffer) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString()
})

let file: string
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'lev-keys-')), 'keys.json')
})

test('set/get/has round-trip', () => {
  const k = new KeyStore(file, fakeCipher())
  expect(k.has('groq')).toBe(false)
  k.set('groq', '  gsk_test_123  ')
  expect(k.has('groq')).toBe(true)
  expect(k.get('groq')).toBe('gsk_test_123')
  expect(new KeyStore(file, fakeCipher()).get('groq')).toBe('gsk_test_123')
  expect(k.get('openrouter')).toBeNull()
})

test('empty key deletes', () => {
  const k = new KeyStore(file, fakeCipher())
  k.set('openrouter', 'sk-or-test')
  k.set('openrouter', '   ')
  expect(k.has('openrouter')).toBe(false)
})

test('file never contains the plain key', () => {
  new KeyStore(file, fakeCipher()).set('groq', 'gsk_secret_value')
  expect(readFileSync(file, 'utf8')).not.toContain('gsk_secret_value')
})

test('unavailable cipher refuses with a clear message', () => {
  expect(() => new KeyStore(file, fakeCipher(false)).set('groq', 'x')).toThrow('Secure storage is not available on this PC')
})

test('a corrupt keys file reads as no keys', () => {
  writeFileSync(file, '{oops')
  expect(new KeyStore(file, fakeCipher()).has('groq')).toBe(false)
})

test('old settings without ai get defaults', () => {
  const s = join(mkdtempSync(join(tmpdir(), 'lev-set-')), 'settings.json')
  writeFileSync(s, JSON.stringify({ countdownSec: 2 }))
  const loaded = loadSettings(s, 'C:\\Users\\t')
  expect(loaded.ai).toEqual(defaultSettings('C:\\Users\\t').ai)
  expect(loaded.ai).toEqual({
    transcription: 'local',
    suggestions: 'groq',
    groqChatModel: 'openai/gpt-oss-120b',
    openrouterModel: 'anthropic/claude-sonnet-5.5'
  })
})
