import { test, expect } from '@playwright/test'
import { launchIsolated } from './launch'

test('Studio lists capture sources with thumbnails and device pickers', async () => {
  const { app } = await launchIsolated()
  const page = await app.firstWindow()

  await page.getByRole('button', { name: 'Studio' }).click()
  await expect(page.getByRole('heading', { name: 'New recording' })).toBeVisible()
  const firstScreen = page.locator('.source').first()
  await expect(firstScreen).toBeVisible({ timeout: 15_000 })
  await expect(firstScreen.locator('img')).toHaveAttribute('src', /^data:image\/png/)
  await expect(page.getByLabel('Camera')).toBeVisible()
  await expect(page.getByLabel('Microphone')).toBeVisible()
  await expect(page.getByLabel('System audio')).toBeChecked()
  await expect(page.getByRole('button', { name: '● Record' })).toBeEnabled()

  await page.getByRole('tab', { name: 'Windows' }).click()
  await expect(page.locator('.source', { hasText: /^Leverage$/ })).toHaveCount(0)

  await app.close()
})
