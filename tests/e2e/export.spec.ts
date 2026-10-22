import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import ffmpeg from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchIsolated } from './launch'

const live = (out: string, input: string[], codec: string[]): void => {
  execFileSync(ffmpeg!, ['-v', 'error', ...input, '-t', '3', ...codec, '-f', 'webm', '-live', '1', out])
}

const probe = (file: string): { streams: string[]; width: number; duration: number } => {
  const out = JSON.parse(
    execFileSync(ffprobe.path, [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width', '-of', 'json', file
    ]).toString()
  )
  const video = out.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
  return {
    streams: out.streams.map((s: { codec_type: string; codec_name: string }) => `${s.codec_type}:${s.codec_name}`).sort(),
    width: video?.width ?? 0,
    duration: Number(out.format.duration)
  }
}

/** A recording interrupted by a crash: raw live-mode WebM (no duration/cues), status "recording". */
function seedCrashedRecording(library: string): string {
  const dir = join(library, '2026-10-22 10-00-00')
  mkdirSync(dir, { recursive: true })
  live(join(dir, 'screen.webm'), ['-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30'], ['-c:v', 'libvpx', '-b:v', '1M'])
  live(join(dir, 'camera.webm'), ['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=30'], ['-c:v', 'libvpx', '-b:v', '500k'])
  live(join(dir, 'mic.webm'), ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'], ['-c:a', 'libopus'])
  live(join(dir, 'system.webm'), ['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000'], ['-c:a', 'libopus'])
  const t = (file: string, offsetMs = 0): { file: string; mime: string; offsetMs: number } => ({ file, mime: 'x', offsetMs })
  writeFileSync(
    join(dir, 'recording.json'),
    JSON.stringify({
      version: 1,
      id: 'crashed-1',
      title: 'Crashed demo',
      createdAt: '2026-10-22T10:00:00.000Z',
      status: 'recording',
      durationMs: 0,
      source: { kind: 'screen', name: 'Screen 1', scaleFactor: 1, displayBoundsDip: { x: 0, y: 0, width: 1280, height: 720 } },
      videoSize: { width: 1280, height: 720 },
      // Odd-sized region and a bubble hanging off the right edge.
      crop: { x: 100, y: 50, width: 801, height: 451 },
      bubble: { xDip: 850, yDip: 300, sizeDip: 200 },
      tracks: { screen: t('screen.webm'), camera: t('camera.webm', 100), mic: t('mic.webm', 50), system: t('system.webm') },
      disabledTracks: {}
    })
  )
  return dir
}

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
