import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchIsolated } from './launch'

async function useTempLibrary(page: Page): Promise<string> {
  const library = join(mkdtempSync(join(tmpdir(), 'lev-helpers-')), 'Library')
  await page.evaluate(async (libraryDir) => {
    const s = await window.leverage['settings:get']()
    await window.leverage['settings:set']({ ...s, libraryDir, countdownSec: 0 })
  }, library)
  return library
}

test('hotkeys are registered globally', async () => {
  const { app } = await launchIsolated()
  await app.firstWindow()
  const registered = await app.evaluate(({ globalShortcut }) =>
    ['CommandOrControl+Shift+R', 'CommandOrControl+Shift+P', 'CommandOrControl+Shift+X'].map((a) =>
      globalShortcut.isRegistered(a)
    )
  )
  expect(registered).toEqual([true, true, true])
  await app.close()
})

test('toolbar appears while recording and its Pause and Stop control the recorder', async () => {
  const { app } = await launchIsolated()
  const page = await app.firstWindow()
  const library = await useTempLibrary(page)

  await page.getByRole('button', { name: 'Studio' }).click()
  await expect(page.locator('.source').first()).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Camera').selectOption('')
  await page.getByLabel('Microphone').selectOption('')
  await page.getByLabel('System audio').uncheck()

  const toolbarPromise = app.waitForEvent('window', (w) => w.url().includes('toolbar.html'))
  await page.getByRole('button', { name: '● Record' }).click()
  const toolbar = await toolbarPromise
  await expect(toolbar.getByLabel('Elapsed time')).toHaveText(/00:0\d/, { timeout: 10_000 })

  await toolbar.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Resume' })).toBeVisible()
  await toolbar.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByRole('heading', { name: 'Recording', exact: true })).toBeVisible()

  await toolbar.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('heading', { name: 'Recording saved' })).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(1)
  expect(readdirSync(library)).toHaveLength(1)
  await app.close()
})

test('camera bubble shows during recording and its position is saved', async () => {
  const { app } = await launchIsolated()
  const page = await app.firstWindow()
  const library = await useTempLibrary(page)
  await page.getByRole('button', { name: 'Studio' }).click()
  await expect(page.locator('.source').first()).toBeVisible({ timeout: 15_000 })
  const cameras = await page.locator('#camera option').count()
  test.skip(cameras < 2, 'No camera on this machine')

  await page.getByLabel('Camera').selectOption({ index: 1 })
  await page.getByLabel('Microphone').selectOption('')
  await page.getByLabel('System audio').uncheck()
  const bubblePromise = app.waitForEvent('window', (w) => w.url().includes('bubble.html'))
  await page.getByRole('button', { name: '● Record' }).click()
  const bubble = await bubblePromise
  await expect(bubble.locator('video')).toBeVisible({ timeout: 10_000 })
  await bubble.getByRole('button', { name: 'L', exact: true }).click({ force: true })

  await page.waitForTimeout(2000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Leverage')?.restore())
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('heading', { name: 'Recording saved' })).toBeVisible({ timeout: 30_000 })

  const [folder] = readdirSync(library)
  const manifest = JSON.parse(readFileSync(join(library, folder, 'recording.json'), 'utf8'))
  expect(manifest.bubble.sizeDip).toBe(280)
  expect(manifest.tracks.camera).toBeTruthy()
  expect(existsSync(join(library, folder, 'camera.webm'))).toBe(true)
  await app.close()
})
