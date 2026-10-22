import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchIsolated } from './launch'
import { seedCrashedRecording } from './fixtures'

/** Launch with one seeded 3 s recording (screen, camera, mic, system) and open it in the editor. */
export async function openEditor(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const library = join(mkdtempSync(join(tmpdir(), 'lev-editor-')), 'Library')
  const dir = seedCrashedRecording(library)
  const { app } = await launchIsolated({ libraryDir: library })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Library' }).click()
  await page.getByTestId('library-item').getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByRole('heading', { name: 'Crashed demo' })).toBeVisible()
  return { app, page, dir }
}

test('opens a recording from the Library in the editor', async () => {
  const { app, page } = await openEditor()
  const screen = page.getByTestId('preview-screen')
  await expect(screen).toHaveAttribute('src', /^leverage-media:\/\//)
  await expect.poll(() => screen.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
  await page.getByRole('button', { name: '← Library' }).click()
  await expect(page.getByTestId('library-item')).toHaveCount(1)
  await app.close()
})
