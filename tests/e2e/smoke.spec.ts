import { test, expect, _electron as electron } from '@playwright/test'

test('opens Leverage with module navigation', async () => {
  const app = await electron.launch({ args: ['.'] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  expect(await page.title()).toBe('Leverage')
  await expect(page.getByRole('button', { name: 'Studio' })).toBeVisible()
  for (const name of ['Snap', 'Listen', 'Library', 'Settings']) {
    await expect(page.getByRole('button', { name })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Snap' }).click()
  await expect(page.getByText('Coming soon')).toBeVisible()

  await app.close()
})
