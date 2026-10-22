import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchIsolated } from './launch'
import { seedCrashedRecording, type SeedOptions } from './fixtures'

/** Launch with one seeded 3 s recording (screen, camera, mic, system) and open it in the editor. */
export async function openEditor(
  opts: SeedOptions = {},
  launch: { settings?: Record<string, unknown>; env?: Record<string, string>; prepare?: (userData: string) => void } = {}
): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const library = join(mkdtempSync(join(tmpdir(), 'lev-editor-')), 'Library')
  const dir = seedCrashedRecording(library, opts)
  const { app } = await launchIsolated({ libraryDir: library, ...launch.settings }, { env: launch.env, prepare: launch.prepare })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Library' }).click()
  await page.getByTestId('library-item').getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByRole('heading', { name: 'Crashed demo' })).toBeVisible()
  return { app, page, dir }
}

