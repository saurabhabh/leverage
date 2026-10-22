import { test, expect } from 'vitest'
import { toCaptureSources, type DesktopSourceLike, type DisplayLike } from '../../src/main/capture/sources'

const displays: DisplayLike[] = [
  { id: 1, bounds: { x: 0, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5, primary: true },
  { id: 2, bounds: { x: 1280, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, primary: false }
]

const thumb = { toDataURL: () => 'data:image/png;base64,AAA' }

test('screen gets matching display bounds and its scale factor', () => {
  const out = toCaptureSources(
    [{ id: 'screen:2:0', name: 'Screen 2', display_id: '2', thumbnail: thumb }],
    displays
  )
  expect(out).toEqual([
    {
      id: 'screen:2:0',
      kind: 'screen',
      name: 'Screen 2',
      thumbnailDataUrl: 'data:image/png;base64,AAA',
      displayId: '2',
      displayBoundsDip: { x: 1280, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1
    }
  ])
})

test('window gets the primary display scale factor and no bounds', () => {
  const [w] = toCaptureSources([{ id: 'window:42:0', name: 'Notepad', display_id: '', thumbnail: thumb }], displays)
  expect(w.kind).toBe('window')
  expect(w.scaleFactor).toBe(1.5)
  expect(w.displayBoundsDip).toBeUndefined()
})

test("Leverage's own windows are excluded", () => {
  const sources: DesktopSourceLike[] = [
    { id: 'window:1:0', name: 'Leverage', display_id: '', thumbnail: thumb },
    { id: 'window:2:0', name: 'Notepad', display_id: '', thumbnail: thumb }
  ]
  expect(toCaptureSources(sources, displays).map((s) => s.name)).toEqual(['Notepad'])
})

test('screens are listed before windows', () => {
  const out = toCaptureSources(
    [
      { id: 'window:2:0', name: 'Notepad', display_id: '', thumbnail: thumb },
      { id: 'screen:1:0', name: 'Screen 1', display_id: '1', thumbnail: thumb }
    ],
    displays
  )
  expect(out.map((s) => s.kind)).toEqual(['screen', 'window'])
})
