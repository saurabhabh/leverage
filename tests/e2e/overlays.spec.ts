import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { openEditor } from './editorHelpers'

const seekTo = async (page: Page, ms: number): Promise<void> => {
  await page.getByLabel('Playhead').fill(String(ms))
  await page.locator('.preview-frame').click({ position: { x: 5, y: 5 } })
}

/** Drag on the preview stage from/to fractions of its size. */
async function dragOnStage(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await page.locator('.preview-stage').boundingBox())!
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 5 })
  await page.mouse.up()
}

const savedEdit = async (dir: string): Promise<{ overlays: Record<string, unknown>[] }> => {
  await new Promise((r) => setTimeout(r, 900))
  return JSON.parse(readFileSync(join(dir, 'edit.json'), 'utf8'))
}

test('adding a blur shows it in its lane and on the preview only during its span', async () => {
  const { app, page } = await openEditor()
  await seekTo(page, 1000)
  await page.getByRole('button', { name: 'Blur', exact: true }).click()
  await dragOnStage(page, [0.2, 0.2], [0.5, 0.5])
  await expect(page.getByTestId('overlay-bar')).toHaveCount(1)
  await expect(page.getByTestId('preview-blur')).toHaveCount(1)
  await seekTo(page, 500)
  await expect(page.getByTestId('preview-blur')).toHaveCount(0)
  await app.close()
})

test('a text callout is editable in the inspector and saved', async () => {
  const { app, page, dir } = await openEditor()
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await dragOnStage(page, [0.3, 0.3], [0.3, 0.3])
  const field = page.getByLabel('Text', { exact: true })
  await expect(field).toHaveValue('Text')
  await field.fill('Hello there')
  const edit = await savedEdit(dir)
  expect(edit.overlays).toEqual([expect.objectContaining({ kind: 'text', text: 'Hello there' })])
  await app.close()
})

test('a lower third is added with editable title and subtitle', async () => {
  const { app, page, dir } = await openEditor()
  await page.getByRole('button', { name: 'Lower third' }).click()
  await page.getByLabel('Title', { exact: true }).fill('Saurabh')
  await page.getByLabel('Subtitle').fill('Leverage')
  const edit = await savedEdit(dir)
  expect(edit.overlays).toEqual([expect.objectContaining({ kind: 'lowerThird', title: 'Saurabh', subtitle: 'Leverage' })])
  await app.close()
})

test('Delete removes the selected overlay', async () => {
  const { app, page } = await openEditor()
  await page.getByRole('button', { name: 'Box', exact: true }).click()
  await dragOnStage(page, [0.2, 0.2], [0.4, 0.4])
  await expect(page.getByTestId('overlay-bar')).toHaveCount(1)
  await page.getByRole('button', { name: 'Delete overlay' }).click()
  await expect(page.getByTestId('overlay-bar')).toHaveCount(0)
  await app.close()
})

test('an overlay whose span is cut out disappears from the lane', async () => {
  const { app, page } = await openEditor()
  await seekTo(page, 1000)
  await page.getByRole('button', { name: 'Blur', exact: true }).click()
  await dragOnStage(page, [0.2, 0.2], [0.5, 0.5])
  await expect(page.getByTestId('overlay-bar')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await seekTo(page, 500)
  await page.keyboard.press('i')
  await seekTo(page, 3100)
  await page.keyboard.press('o')
  await page.keyboard.press('x')
  await expect(page.getByTestId('overlay-bar')).toHaveCount(0)
  await app.close()
})

test('overlapping overlays get their own rows in the lane', async () => {
  const { app, page } = await openEditor()
  await page.getByRole('button', { name: 'Blur', exact: true }).click()
  await dragOnStage(page, [0.1, 0.1], [0.3, 0.3])
  await page.getByRole('button', { name: 'Box', exact: true }).click()
  await dragOnStage(page, [0.5, 0.5], [0.7, 0.7])
  const bars = page.getByTestId('overlay-bar')
  await expect(bars).toHaveCount(2)
  const [a, b] = [(await bars.nth(0).boundingBox())!, (await bars.nth(1).boundingBox())!]
  expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(a.height)
  await app.close()
})
