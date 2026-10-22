import { test, expect } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchIsolated } from './launch'

test('dragging a region on the overlay records with a matching crop', async () => {
  const library = join(mkdtempSync(join(tmpdir(), 'lev-region-')), 'Library')
  const { app } = await launchIsolated()
  const page = await app.firstWindow()
  await page.evaluate(async (libraryDir) => {
    const s = await window.leverage['settings:get']()
    await window.leverage['settings:set']({ ...s, libraryDir, countdownSec: 0 })
  }, library)

  await page.getByRole('button', { name: 'Studio' }).click()
  await expect(page.locator('.source').first()).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Camera').selectOption('')
  await page.getByLabel('Microphone').selectOption('')
  await page.getByLabel('System audio').uncheck()

  const overlayPromise = app.waitForEvent('window', (w) => w.url().includes('overlay.html'))
  await page.getByRole('button', { name: 'Region…' }).click()
  const overlay = await overlayPromise
  await overlay.waitForLoadState('domcontentloaded')
  await expect(overlay.getByText('Drag to select')).toBeVisible()

  const scale = await app.evaluate(({ screen }) => {
    const d = screen.getPrimaryDisplay()
    return { factor: d.scaleFactor, x: d.bounds.x, y: d.bounds.y }
  })
  await overlay.mouse.move(100, 80)
  await overlay.mouse.down()
  await overlay.mouse.move(250, 160, { steps: 5 })
  await expect(overlay.getByText('150 × 80')).toBeVisible()
  await overlay.mouse.up()

  await expect(page.getByRole('heading', { name: 'Recording', exact: true })).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('heading', { name: 'Recording saved' })).toBeVisible({ timeout: 30_000 })

  const [folder] = readdirSync(library)
  const manifest = JSON.parse(readFileSync(join(library, folder, 'recording.json'), 'utf8'))
  const sx = manifest.videoSize.width / manifest.source.displayBoundsDip.width
  const expected = (n: number): number => Math.floor((n * sx) / 2) * 2
  expect(manifest.crop.width).toBe(expected(150))
  expect(manifest.crop.height).toBe(expected(80))
  expect(manifest.crop.x).toBe(Math.round(100 * sx))
  expect(scale.factor).toBeGreaterThan(0)

  await app.close()
})

test('Esc on the overlay cancels without recording', async () => {
  const { app } = await launchIsolated()
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Studio' }).click()
  await expect(page.locator('.source').first()).toBeVisible({ timeout: 15_000 })
  const overlayPromise = app.waitForEvent('window', (w) => w.url().includes('overlay.html'))
  await page.getByRole('button', { name: 'Region…' }).click()
  const overlay = await overlayPromise
  await overlay.waitForLoadState('domcontentloaded')
  await expect(overlay.getByText('Drag to select')).toBeVisible()
  // The overlay closes on keydown, so the keyup half of press() may find it gone.
  await overlay.keyboard.press('Escape').catch(() => undefined)
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(1)
  await expect(page.getByRole('heading', { name: 'New recording' })).toBeVisible()
  await app.close()
})
