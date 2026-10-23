import { test, expect } from 'vitest'
import { createEscapeOwner } from '../../src/main/escape'

function fakeShortcuts(): {
  owner: ReturnType<typeof createEscapeOwner>
  press: () => void
  registered: () => boolean
  calls: string[]
} {
  let cb: (() => void) | null = null
  const calls: string[] = []
  const owner = createEscapeOwner(
    (fn) => {
      calls.push('register')
      cb = fn
      return true
    },
    () => {
      calls.push('unregister')
      cb = null
    }
  )
  return { owner, press: () => cb?.(), registered: () => cb !== null, calls }
}

test('the latest holder gets Esc; releasing it hands Esc back to the one below', () => {
  const { owner, press } = fakeShortcuts()
  const log: string[] = []
  owner.hold('dictation', () => log.push('dictation'))
  owner.hold('snap', () => log.push('snap'))
  press()
  owner.release('snap')
  press()
  expect(log).toEqual(['snap', 'dictation'])
})

test('releasing a holder below the top does not take Esc from the top', () => {
  const { owner, press } = fakeShortcuts()
  const log: string[] = []
  owner.hold('dictation', () => log.push('dictation'))
  owner.hold('region', () => log.push('region'))
  owner.release('dictation')
  press()
  expect(log).toEqual(['region'])
})

test('Esc is registered once and unregistered only when the last holder releases', () => {
  const { owner, registered, calls } = fakeShortcuts()
  owner.hold('a', () => undefined)
  owner.hold('b', () => undefined)
  owner.release('a')
  expect(registered()).toBe(true)
  owner.release('b')
  expect(registered()).toBe(false)
  expect(calls).toEqual(['register', 'unregister'])
})

test('holding again replaces the callback and moves it to the top; release is idempotent', () => {
  const { owner, press, calls } = fakeShortcuts()
  const log: string[] = []
  owner.hold('a', () => log.push('a1'))
  owner.hold('b', () => log.push('b'))
  owner.hold('a', () => log.push('a2'))
  press()
  owner.release('x')
  owner.release('a')
  owner.release('a')
  press()
  expect(log).toEqual(['a2', 'b'])
  expect(calls).toEqual(['register'])
})

test('a failed registration is retried on the next hold', () => {
  let ok = false
  let cb: (() => void) | null = null
  const owner = createEscapeOwner(
    (fn) => {
      if (ok) cb = fn
      return ok
    },
    () => (cb = null)
  )
  owner.hold('a', () => undefined)
  expect(cb).toBe(null)
  ok = true
  const log: string[] = []
  owner.hold('b', () => log.push('b'))
  cb!()
  expect(log).toEqual(['b'])
})
