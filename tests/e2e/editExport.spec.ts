import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { openEditor } from './editorHelpers'
import { probe } from './fixtures'

const seekTo = async (page: Page, ms: number): Promise<void> => {
  await page.getByLabel('Playhead').fill(String(ms))
  await page.locator('.preview-frame').click({ position: { x: 5, y: 5 } })
}

/** Answer the next save dialog with `file` (the real button path, minus the OS dialog). */
async function stubSaveDialog(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
  }, file)
}

test('export from the editor applies cuts and overlays', async () => {
  const { app, page, dir } = await openEditor()
  // Cut 1.0–2.0 s of the 3.1 s recording.
  await seekTo(page, 1000)
  await page.keyboard.press('i')
  await seekTo(page, 2000)
  await page.keyboard.press('o')
  await page.keyboard.press('x')
  // A text callout at the start.
  await seekTo(page, 0)
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  const stage = (await page.locator('.preview-stage').boundingBox())!
  await page.mouse.click(stage.x + 40, stage.y + 40)
  await page.getByLabel('Text', { exact: true }).fill('Look here')

  const out = join(dir, 'edited.mp4')
  await stubSaveDialog(app, out)
  await page.getByRole('button', { name: 'Export MP4' }).click()
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 60_000 })

  const info = probe(out)
  expect(info.streams).toEqual(['audio:aac', 'video:h264'])
  expect(info.duration).toBeGreaterThan(1.95)
  expect(info.duration).toBeLessThan(2.3)
  expect(readdirSync(join(dir, 'overlays')).filter((f) => f !== 'mask.png' && f.endsWith('.png'))).toHaveLength(1)
  expect(existsSync(join(dir, 'overlays', 'mask.png'))).toBe(true)
  await app.close()
})

test('GIF export from the editor works on an incomplete recording with edits', async () => {
  const { app, page, dir } = await openEditor()
  await seekTo(page, 1500)
  await page.keyboard.press('s')
  const out = join(dir, 'edited.gif')
  await stubSaveDialog(app, out)
  await page.getByRole('button', { name: 'Export GIF' }).click()
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 60_000 })
  expect(probe(out).streams).toEqual(['video:gif'])
  await app.close()
})
