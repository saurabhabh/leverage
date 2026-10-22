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
    if (!registerOne(accelerator, () => send(command), register)) failed.push(accelerator)
  }
  return failed
}

/** Register one accelerator; false if it is taken or invalid. */
export function registerOne(accelerator: string, callback: () => void, register: Register): boolean {
  try {
    return register(accelerator, callback)
  } catch {
    return false
  }
}
