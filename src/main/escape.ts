import { globalShortcut } from 'electron'

export type EscapeOwner = {
  /** Esc now goes to `cb` until released; holding again replaces the callback and moves it to the top. */
  hold(owner: string, cb: () => void): void
  release(owner: string): void
}

/**
 * One owner for the global Esc. Studio's region picker, Snap's overlay and dictation each hold it
 * while they need it; the latest holder gets the key, and releasing hands it back to the one below,
 * so finishing one never takes Esc away from another.
 */
export function createEscapeOwner(
  register: (cb: () => void) => boolean,
  unregister: () => void
): EscapeOwner {
  const stack: { owner: string; cb: () => void }[] = []
  let registered = false
  const press = (): void => stack[stack.length - 1]?.cb()

  return {
    hold(owner, cb) {
      const i = stack.findIndex((h) => h.owner === owner)
      if (i >= 0) stack.splice(i, 1)
      stack.push({ owner, cb })
      if (!registered) registered = register(press)
    },
    release(owner) {
      const i = stack.findIndex((h) => h.owner === owner)
      if (i < 0) return
      stack.splice(i, 1)
      if (stack.length === 0 && registered) {
        unregister()
        registered = false
      }
    }
  }
}

export const escape = createEscapeOwner(
  (cb) => globalShortcut.register('Escape', cb),
  () => globalShortcut.unregister('Escape')
)
