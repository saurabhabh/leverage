import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { openEditor } from './editorHelpers'

const savedEdit = async (dir: string): Promise<{ camera: { x: number; y: number; size: number; visible: boolean }; muted: { mic: boolean }; gains: { mic: number } }> => {
  await new Promise((r) => setTimeout(r, 900))
  return JSON.parse(readFileSync(join(dir, 'edit.json'), 'utf8'))
}

test('dragging the camera circle moves it and the edit saves the new position', async () => {
  const { app, page, dir } = await openEditor()
  const cam = page.getByTestId('preview-camera')
  const box = (await cam.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2 - 100, { steps: 6 })
  await page.mouse.up()
  const after = (await cam.boundingBox())!
  expect(after.x).toBeLessThan(box.x - 150)
  const edit = await savedEdit(dir)
  // Started at the recorded bubble (clamped to the frame's right edge); now well left of it.
  expect(edit.camera.x).toBeLessThan(400)
  expect(edit.camera.visible).toBe(true)
  await app.close()
})

test('hiding the camera hides it in the preview and saves it', async () => {
  const { app, page, dir } = await openEditor()
  await page.getByRole('tab', { name: 'Properties' }).click()
  await page.getByLabel('Show camera').uncheck()
  await expect(page.getByTestId('preview-camera')).toBeHidden()
  expect((await savedEdit(dir)).camera.visible).toBe(false)
  await app.close()
})

test('camera size presets resize the circle', async () => {
  const { app, page, dir } = await openEditor()
  await page.getByRole('tab', { name: 'Properties' }).click()
  await page.getByRole('button', { name: 'Camera size L' }).click()
  // L = 30 % of the 800 px frame width.
  expect((await savedEdit(dir)).camera.size).toBe(240)
  await app.close()
})

test('muting mic saves it and mutes the preview element; volume saves the gain', async () => {
  const { app, page, dir } = await openEditor()
  await page.getByRole('button', { name: 'Mute mic' }).click()
  await expect(page.getByRole('button', { name: 'Unmute mic' })).toBeVisible()
  await expect.poll(() => page.getByTestId('preview-mic').evaluate((a: HTMLAudioElement) => a.muted)).toBe(true)
  await page.getByLabel('Mic volume').fill('150')
  const edit = await savedEdit(dir)
  expect(edit.muted.mic).toBe(true)
  expect(edit.gains.mic).toBe(1.5)
  await app.close()
})
