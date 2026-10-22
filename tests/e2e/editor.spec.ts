import { test, expect } from '@playwright/test'
import { openEditor } from './editorHelpers'

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
