import { test, expect } from 'vitest'
import { createCaptureChoice, primaryScreenId } from '../../src/main/capture/choice'

test("a meeting takes the next audio request without touching Studio's pick", () => {
  const choice = createCaptureChoice(() => 0)
  choice.selectStudio('window:42:0')
  choice.armMeeting()
  expect(choice.forRequest(true)).toEqual({ kind: 'meeting' })
  // Studio's own request, and its no-audio fallback, still get the window it picked.
  expect(choice.forRequest(true)).toEqual({ kind: 'studio', sourceId: 'window:42:0' })
  expect(choice.forRequest(false)).toEqual({ kind: 'studio', sourceId: 'window:42:0' })
})

test('a video-only request never consumes the meeting claim', () => {
  const choice = createCaptureChoice(() => 0)
  choice.selectStudio('window:42:0')
  choice.armMeeting()
  expect(choice.forRequest(false)).toEqual({ kind: 'studio', sourceId: 'window:42:0' })
  expect(choice.forRequest(true)).toEqual({ kind: 'meeting' })
})

test('an unused meeting claim expires so it cannot steal a later Studio recording', () => {
  let t = 0
  const choice = createCaptureChoice(() => t)
  choice.selectStudio('screen:1:0')
  choice.armMeeting()
  t = 10_001
  expect(choice.forRequest(true)).toEqual({ kind: 'studio', sourceId: 'screen:1:0' })
})

test('no Studio pick and no meeting claim → nothing', () => {
  expect(createCaptureChoice(() => 0).forRequest(true)).toEqual({ kind: 'studio', sourceId: null })
})

test('primaryScreenId prefers the primary display, else the first screen, never a window', () => {
  const sources = [
    { id: 'window:9:0', display_id: '' },
    { id: 'screen:1:0', display_id: '1' },
    { id: 'screen:2:0', display_id: '2' }
  ]
  expect(primaryScreenId(sources, 2)).toBe('screen:2:0')
  expect(primaryScreenId(sources, 7)).toBe('screen:1:0')
  expect(primaryScreenId([{ id: 'window:9:0', display_id: '' }], 1)).toBe(null)
})
