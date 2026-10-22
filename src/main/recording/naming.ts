import { existsSync } from 'fs'
import { join } from 'path'

const pad = (n: number): string => String(n).padStart(2, '0')

export function recordingDirName(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  )
}

/** First free path among `base`, `base (2)`, `base (3)`, … — never an existing one. */
export function uniqueDir(root: string, base: string): string {
  let candidate = join(root, base)
  for (let n = 2; existsSync(candidate); n++) candidate = join(root, `${base} (${n})`)
  return candidate
}
