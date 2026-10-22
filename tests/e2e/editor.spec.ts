import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchIsolated } from './launch'
import { seedCrashedRecording } from './fixtures'

/** Launch with one seeded 3 s recording (screen, camera, mic, system) and open it in the editor. */
export async function openEditor(
  opts: { camera?: boolean } = {}
): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const library = join(mkdtempSync(join(tmpdir(), 'lev-editor-')), 'Library')
  const dir = seedCrashedRecording(library, opts)
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

test('play advances time and Space toggles playback', async () => {
  const { app, page } = await openEditor()
  const time = page.getByTestId('time')
  await expect(time).toHaveText(/^00:00\.0 \/ 00:03\.\d$/)
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1200)
  await expect(time).not.toHaveText(/^00:00\.0/)
  await page.keyboard.press('Space')
  const paused = await time.textContent()
  await page.waitForTimeout(600)
  await expect(time).toHaveText(paused!)
  await app.close()
})

test('the camera circle shows for recordings with a camera and is absent without one', async () => {
  const withCam = await openEditor()
  await expect(withCam.page.getByTestId('preview-camera')).toBeVisible()
  await withCam.app.close()
  const noCam = await openEditor({ camera: false })
  await expect(noCam.page.getByTestId('preview-screen')).toBeVisible()
  await expect(noCam.page.getByTestId('preview-camera')).toHaveCount(0)
  await noCam.app.close()
})
