import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'fs'
import ffprobe from 'ffprobe-static'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchIsolated } from './launch'

const probe = (file: string): { duration: number; streams: string[] } => {
  const out = JSON.parse(
    execFileSync(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', file]).toString()
  )
  return {
    duration: Number(out.format.duration),
    streams: out.streams.map((s: { codec_type: string; codec_name: string }) => `${s.codec_type}:${s.codec_name}`)
  }
}

test('records the real screen and system audio into separate playable tracks', async () => {
  const library = join(mkdtempSync(join(tmpdir(), 'lev-real-')), 'Library')
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
  await page.getByRole('button', { name: '● Record' }).click()

  await expect(page.getByRole('heading', { name: 'Recording', exact: true })).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(3500)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('heading', { name: 'Recording saved' })).toBeVisible({ timeout: 30_000 })

  const [folder] = readdirSync(library)
  const dir = join(library, folder)
  const manifest = JSON.parse(readFileSync(join(dir, 'recording.json'), 'utf8'))
  expect(manifest.status).toBe('complete')
  expect(manifest.durationMs).toBeGreaterThan(3000)
  expect(manifest.videoSize.width).toBeGreaterThan(0)

  const screen = probe(join(dir, 'screen.webm'))
  expect(screen.streams).toEqual(['video:vp9'])
  expect(screen.duration).toBeGreaterThan(2.5)

  if (manifest.tracks.system) {
    const system = probe(join(dir, 'system.webm'))
    expect(system.streams).toEqual(['audio:opus'])
    expect(system.duration).toBeGreaterThan(2.5)
  } else {
    expect(manifest.disabledTracks.system).toBeTruthy()
  }

  await app.close()
})
