import { test, expect, type Page } from '@playwright/test'
import { openEditor } from './editorHelpers'

const clips = (page: Page) => page.getByTestId('clip')
const seekTo = async (page: Page, ms: number): Promise<void> => {
  await page.getByLabel('Playhead').fill(String(ms))
  await page.locator('.preview-frame').click({ position: { x: 5, y: 5 } }) // focus off the slider
}

test('S splits at the playhead into two clips', async () => {
  const { app, page } = await openEditor()
  await expect(clips(page)).toHaveCount(1)
  await seekTo(page, 1000)
  await page.keyboard.press('s')
  await expect(clips(page)).toHaveCount(2)
  await expect(clips(page).first()).toContainText('00:00.0–00:01.0')
  await app.close()
})

test('I, O, X cuts the marked range and the duration drops by it', async () => {
  const { app, page } = await openEditor()
  const time = page.getByTestId('time')
  await expect(time).toHaveText(/ \/ 00:03\.1$/)
  await seekTo(page, 1000)
  await page.keyboard.press('i')
  await seekTo(page, 2000)
  await page.keyboard.press('o')
  await expect(page.getByTestId('mark')).toBeVisible()
  await page.keyboard.press('x')
  await expect(time).toHaveText(/ \/ 00:02\.1$/)
  await expect(clips(page)).toHaveCount(2)
  await app.close()
})

test('Delete removes the selected clip; the last clip cannot be deleted', async () => {
  const { app, page } = await openEditor()
  await seekTo(page, 1000)
  await page.keyboard.press('s')
  await clips(page).first().click()
  await page.keyboard.press('Delete')
  await expect(clips(page)).toHaveCount(1)
  await clips(page).first().click()
  await page.keyboard.press('Delete')
  await expect(clips(page)).toHaveCount(1)
  await app.close()
})

test('dragging a clip reorders it', async () => {
  const { app, page } = await openEditor()
  await seekTo(page, 1000)
  await page.keyboard.press('s')
  await clips(page).nth(1).dragTo(clips(page).first(), { targetPosition: { x: 2, y: 10 } })
  await expect(clips(page).first()).toContainText('00:01.0–')
  await app.close()
})

test('Ctrl+Z restores, Ctrl+Y re-applies', async () => {
  const { app, page } = await openEditor()
  await seekTo(page, 1000)
  await page.keyboard.press('s')
  await expect(clips(page)).toHaveCount(2)
  await page.keyboard.press('Control+z')
  await expect(clips(page)).toHaveCount(1)
  await page.keyboard.press('Control+y')
  await expect(clips(page)).toHaveCount(2)
  await app.close()
})

test('edits survive reopening', async () => {
  const { app, page } = await openEditor()
  await seekTo(page, 1000)
  await page.keyboard.press('s')
  await expect(clips(page)).toHaveCount(2)
  await page.waitForTimeout(900) // autosave is debounced 500 ms
  await page.getByRole('button', { name: '← Library' }).click()
  await page.getByTestId('library-item').getByRole('button', { name: 'Edit' }).click()
  await expect(clips(page)).toHaveCount(2)
  await app.close()
})

test('zoom controls change the clip width', async () => {
  const { app, page } = await openEditor()
  const width = async (): Promise<number> => (await clips(page).first().boundingBox())!.width
  const fit = await width()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  expect(await width()).toBeGreaterThan(fit)
  await page.getByRole('button', { name: 'Fit' }).click()
  expect(Math.abs((await width()) - fit)).toBeLessThan(2)
  await app.close()
})
