import { spawn } from 'child_process'

export type PasteDeps = {
  /** Snapshot of whatever is on the clipboard now (any formats). */
  save: () => Promise<unknown>
  restore: (saved: unknown) => Promise<void>
  writeText: (text: string) => Promise<void>
  readText: () => Promise<string>
  /** Ctrl+V into the focused app. */
  sendPaste: () => Promise<void>
  sleep: (ms: number) => Promise<void>
}

// OpenWhispr's PowerShell timings: let the clipboard settle before Ctrl+V; give the target app time
// to read it before putting the user's clipboard back.
const PASTE_DELAY_MS = 40
const RESTORE_DELAY_MS = 500

/**
 * Paste via the clipboard, then put the user's clipboard back — only if it still holds our text, so a
 * copy they made meanwhile is never undone. `restored` settles after the restore delay.
 */
export async function pasteText(
  text: string,
  paste: boolean,
  deps: PasteDeps
): Promise<{ pasted: boolean; restored: Promise<boolean> }> {
  if (!paste) {
    await deps.writeText(text)
    return { pasted: false, restored: Promise.resolve(false) }
  }
  const saved = await deps.save()
  await deps.writeText(text)
  await deps.sleep(PASTE_DELAY_MS)
  try {
    await deps.sendPaste()
  } catch {
    // Leave the text on the clipboard so the user can paste it themselves.
    return { pasted: false, restored: Promise.resolve(false) }
  }
  const restored = (async () => {
    await deps.sleep(RESTORE_DELAY_MS)
    if ((await deps.readText()) !== text) return false
    await deps.restore(saved)
    return true
  })()
  return { pasted: true, restored }
}

/** Ctrl+V with PowerShell SendKeys (no native helper). Windows only. */
export function sendCtrlV(): Promise<void> {
  if (process.platform !== 'win32')
    return Promise.reject(new Error('Automatic paste needs Windows'))
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');[System.Windows.Forms.SendKeys]::SendWait('^v')"
      ],
      { windowsHide: true }
    )
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Paste timed out'))
    }, 5000)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`Paste failed (${code})`))
    })
  })
}
