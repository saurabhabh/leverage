import { test, expect } from '@playwright/test'
import { launchIsolated } from './launch'

test('opens Leverage with module navigation', async () => {
  const { app } = await launchIsolated()
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  expect(await page.title()).toBe('Leverage')
  await expect(page.getByRole('button', { name: 'Studio' })).toBeVisible()
  for (const name of ['Snap', 'Listen', 'Library', 'Settings']) {
    await expect(page.getByRole('button', { name })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Snap' }).click()
  await expect(page.getByRole('heading', { name: 'Snap' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Region' })).toBeVisible()
  await page.getByRole('button', { name: 'Listen' }).click()
  await expect(page.getByText('Coming soon')).toBeVisible()

  await app.close()
})

test('the main window cannot be navigated away from Leverage (e.g. by a dropped file)', async () => {
  const { app } = await launchIsolated()
  const page = await app.firstWindow()
  await expect(page.getByRole('button', { name: 'Studio' })).toBeVisible()
  const before = page.url()
  await page.evaluate(() => {
    location.href = 'file:///C:/Windows/win.ini'
  })
  await page.waitForTimeout(1000)
  // Ask Electron directly: Playwright keeps waiting on a navigation that was cancelled.
  const state = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents
    return {
      url: wc.getURL(),
      buttons: await wc.executeJavaScript('document.querySelectorAll(".nav-item").length')
    }
  })
  expect(state).toEqual({ url: before, buttons: 5 })
  await app.close()
})
