import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Launch Leverage against a throwaway profile so tests never touch the user's settings or library.
 * `settings` is written before launch, so start-up work (like crash recovery) sees it.
 */
export async function launchIsolated(
  settings?: Record<string, unknown>,
  opts: { env?: Record<string, string>; prepare?: (userData: string) => void; args?: string[] } = {}
): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = mkdtempSync(join(tmpdir(), 'lev-e2e-'))
  if (settings) writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings))
  opts.prepare?.(userData)
  // Linux runners have no keyring: a basic store with plain-text "encryption", test-only (see keys.ts).
  const linux = process.platform === 'linux'
  const app = await electron.launch({
    args: ['.', ...(linux ? ['--password-store=basic'] : []), ...(opts.args ?? [])],
    env: {
      ...process.env,
      ...opts.env,
      ...(linux ? { LEVERAGE_TEST_PLAINTEXT_KEYS: '1' } : {}),
      LEVERAGE_USER_DATA: userData
    }
  })
  return { app, userData }
}
