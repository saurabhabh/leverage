import { test, expect } from 'vitest'
import { pickMimeType } from '../../src/renderer/src/studio/mime'

test('pickMimeType prefers vp9 for video', () => {
  expect(pickMimeType('video', () => true)).toBe('video/webm;codecs=vp9')
})

test('pickMimeType falls back to vp8 when vp9 unsupported', () => {
  expect(pickMimeType('video', (m) => m !== 'video/webm;codecs=vp9')).toBe('video/webm;codecs=vp8')
})

test('pickMimeType uses opus for audio and plain webm as last resort', () => {
  expect(pickMimeType('audio', () => true)).toBe('audio/webm;codecs=opus')
  expect(pickMimeType('audio', (m) => m === 'audio/webm')).toBe('audio/webm')
})

test('pickMimeType returns empty string when nothing is supported (browser default)', () => {
  expect(pickMimeType('video', () => false)).toBe('')
})
