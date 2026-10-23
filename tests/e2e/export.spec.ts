import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchIsolated } from './launch'
import { probe, seedCrashedRecording } from './fixtures'

test('a crash-interrupted recording is recovered as incomplete and still exports MP4 and GIF', async () => {
  const library = join(mkdtempSync(join(tmpdir(), 'lev-export-')), 'Library')
  const dir = seedCrashedRecording(library)
  const { app } = await launchIsolated({ libraryDir: library })
  const page = await app.firstWindow()

  await expect
    .poll(() => page.evaluate(async () => (await window.leverage['rec:list']()).map((m) => m.status)))
    .toEqual(['incomplete'])

  const mp4 = join(dir, 'out.mp4')
  const written = await page.evaluate((out) => window.leverage['export:mp4']('crashed-1', out), mp4)
  expect(written).toBe(mp4)
  const info = probe(mp4)
  expect(info.streams).toEqual(['audio:aac', 'video:h264'])
  expect(info.width).toBe(800)
  expect(info.duration).toBeGreaterThan(2.5)

  // Exporting to the same name again never overwrites.
  const again = await page.evaluate((out) => window.leverage['export:mp4']('crashed-1', out), mp4)
  expect(again).toBe(join(dir, 'out (2).mp4'))

  const gif = await page.evaluate((out) => window.leverage['export:gif']('crashed-1', out), join(dir, 'out.gif'))
  expect(existsSync(gif!)).toBe(true)
  expect(probe(gif!).streams).toEqual(['video:gif'])

  await app.close()
})

test('Library lists recordings with status, tracks and actions', async () => {
  const library = join(mkdtempSync(join(tmpdir(), 'lev-libui-')), 'Library')
  seedCrashedRecording(library)
  const { app } = await launchIsolated({ libraryDir: library })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Library' }).click()
  const item = page.getByTestId('library-item')
  await expect(item).toHaveCount(1)
  await expect(item.getByText('Crashed demo')).toBeVisible()
  await expect(item.getByText('Incomplete')).toBeVisible()
  await expect(item.getByText(/Screen, Camera, Mic, System audio/)).toBeVisible()
  for (const name of ['Export MP4', 'Export GIF', 'Show in Explorer', 'Delete']) {
    await expect(item.getByRole('button', { name })).toBeEnabled()
  }
  await app.close()
})

test('a recording is renamed in place from the Library; Esc cancels and an empty name is ignored', async () => {
  const library = join(mkdtempSync(join(tmpdir(), 'lev-rename-')), 'Library')
  const dir = seedCrashedRecording(library)
  const { app } = await launchIsolated({ libraryDir: library })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Library' }).click()
  const item = page.getByTestId('library-item')
  const name = item.getByRole('textbox', { name: 'Recording name' })

  await item.getByRole('button', { name: 'Rename Crashed demo' }).click()
  await expect(name).toBeFocused()
  await name.fill('Client demo v2')
  await name.press('Enter')
  await expect(item.getByRole('button', { name: 'Rename Client demo v2' })).toBeVisible()
  expect(JSON.parse(readFileSync(join(dir, 'recording.json'), 'utf8')).title).toBe('Client demo v2')

  await item.getByRole('button', { name: 'Rename Client demo v2' }).click()
  await name.fill('Not kept')
  await name.press('Escape')
  await expect(item.getByRole('button', { name: 'Rename Client demo v2' })).toBeVisible()

  await item.getByRole('button', { name: 'Rename Client demo v2' }).click()
  await name.fill('   ')
  await name.press('Enter')
  await expect(item.getByRole('button', { name: 'Rename Client demo v2' })).toBeVisible()
  expect(JSON.parse(readFileSync(join(dir, 'recording.json'), 'utf8')).title).toBe('Client demo v2')
  await app.close()
})
