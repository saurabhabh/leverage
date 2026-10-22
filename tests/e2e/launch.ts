import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** Launch Leverage against a throwaway profile so tests never touch the user's settings or library. */
export async function launchIsolated(): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = mkdtempSync(join(tmpdir(), 'lev-e2e-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, LEVERAGE_USER_DATA: userData } })
  return { app, userData }
}
