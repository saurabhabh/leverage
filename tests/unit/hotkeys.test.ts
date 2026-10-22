import { test, expect } from 'vitest'
import { registerHotkeys, type RecorderCommand } from '../../src/main/hotkeys'

const hotkeys = {
  toggle: 'CommandOrControl+Shift+R',
  pause: 'CommandOrControl+Shift+P',
  abort: 'CommandOrControl+Shift+X'
}

test('registerHotkeys registers three accelerators and maps each to its command', () => {
  const callbacks = new Map<string, () => void>()
  const sent: RecorderCommand[] = []
  const failed = registerHotkeys(hotkeys, (c) => sent.push(c), (acc, cb) => {
    callbacks.set(acc, cb)
    return true
  })
  expect(failed).toEqual([])
  expect([...callbacks.keys()]).toEqual(Object.values(hotkeys))
  callbacks.get('CommandOrControl+Shift+R')!()
  callbacks.get('CommandOrControl+Shift+P')!()
  callbacks.get('CommandOrControl+Shift+X')!()
  expect(sent).toEqual(['toggle', 'pause', 'abort'])
})

test('returns accelerators whose register() returned false or threw', () => {
  const failed = registerHotkeys(hotkeys, () => undefined, (acc) => {
    if (acc.endsWith('X')) throw new Error('bad accelerator')
    return !acc.endsWith('P')
  })
  expect(failed).toEqual(['CommandOrControl+Shift+P', 'CommandOrControl+Shift+X'])
})
