import type { RecorderCommand } from '../shared/ipc'
import type { Settings } from '../shared/types'

export type { RecorderCommand }

type Register = (accelerator: string, callback: () => void) => boolean

/** Register the three recorder hotkeys; returns the accelerators that could not be registered. */
export function registerHotkeys(
  hotkeys: Settings['hotkeys'],
  send: (command: RecorderCommand) => void,
  register: Register
): string[] {
  const failed: string[] = []
  for (const command of ['toggle', 'pause', 'abort'] as const) {
    const accelerator = hotkeys[command]
    let ok = false
    try {
      ok = register(accelerator, () => send(command))
    } catch {
      ok = false
    }
    if (!ok) failed.push(accelerator)
  }
  return failed
}
