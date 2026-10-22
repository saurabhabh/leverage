import { test, expect, type Page } from '@playwright/test'
import { openEditor } from './editorHelpers'

const time = (page: Page) => page.getByTestId('time')

test('Remove pauses cuts the 1.5 s pause (about 1.0 s after padding) and one Ctrl+Z restores it', async () => {
  const { app, page } = await openEditor({ micPause: true })
  await expect(time(page)).toHaveText(/\/ 00:03\.1$/)
  await page.getByRole('button', { name: 'Remove pauses' }).click()
  await expect(page.getByRole('status').filter({ hasText: /Removed 1 pause/ })).toBeVisible()
  // Opus smears the silence edges a little: about 1.0 s comes out.
  await expect(time(page)).toHaveText(/\/ 00:02\.[0-2]$/)
  await page.keyboard.press('Control+z')
  await expect(time(page)).toHaveText(/\/ 00:03\.1$/)
  await app.close()
})

test('Remove pauses reports when there are none', async () => {
  const { app, page } = await openEditor()
  await page.getByRole('button', { name: 'Remove pauses' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'No long pauses found' })).toBeVisible()
  await expect(time(page)).toHaveText(/\/ 00:03\.1$/)
  await app.close()
})

test('Remove filler words cuts "um" from a transcript', async () => {
  const { app, page } = await openEditor({
    transcript: [
      { text: 'Hello', startMs: 100, endMs: 400 },
      { text: 'um,', startMs: 400, endMs: 700 },
      { text: 'world.', startMs: 700, endMs: 1200 }
    ]
  })
  await page.getByRole('button', { name: 'Remove filler words' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Removed 1 filler word' })).toBeVisible()
  await expect(page.getByTestId('word').filter({ hasText: /^um,$/ })).toHaveAttribute('data-state', 'cut')
  await expect(time(page)).toHaveText(/\/ 00:02\.8$/)
  await app.close()
})

test('Remove filler words needs a transcript first', async () => {
  const { app, page } = await openEditor()
  await expect(page.getByRole('button', { name: 'Remove filler words' })).toBeDisabled()
  await app.close()
})
