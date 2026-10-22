import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { launchIsolated } from './launch'
import { join } from 'path'

test('settings page loads defaults over the bridge and saves changes', async () => {
  const { app, userData } = await launchIsolated()
  const page = await app.firstWindow()

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('library-dir')).toHaveText(/Videos.Leverage$/)
  await expect(page.getByText('Ctrl+Shift+R')).toBeVisible()

  await page.getByLabel('Countdown (seconds)').fill('5')
  await expect
    .poll(() => {
      try {
        return JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).countdownSec
      } catch {
        return undefined
      }
    })
    .toBe(5)

  await app.close()
})
