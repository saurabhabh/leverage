import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import ffmpeg from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchIsolated } from './launch'

const probeDuration = (file: string): string =>
  execFileSync(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
    .toString()
    .trim()

test('renderer can create, stream and finalize a recording through the bridge', async () => {
  const work = mkdtempSync(join(tmpdir(), 'lev-lib-'))
  const library = join(work, 'Library')
  // Live-mode WebM has no duration or cues — the same shape MediaRecorder produces.
  const sample = join(work, 'live.webm')
  execFileSync(ffmpeg!, [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=15', '-t', '1',
    '-c:v', 'libvpx', '-f', 'webm', '-live', '1', sample
  ])
  expect(probeDuration(sample)).toBe('N/A')
  const bytes = [...readFileSync(sample)]

  const { app } = await launchIsolated()
  const page = await app.firstWindow()

  const result = await page.evaluate(
    async ({ libraryDir, bytes }) => {
      const api = window.leverage
      const settings = await api['settings:get']()
      await api['settings:set']({ ...settings, libraryDir })

      const { id, dir } = await api['rec:create']({
        source: { kind: 'screen', name: 'Test', scaleFactor: 1 },
        videoSize: { width: 64, height: 64 },
        tracks: ['screen', 'mic'],
        mimes: { screen: 'video/webm' }
      })
      const data = new Uint8Array(bytes)
      const half = Math.floor(data.length / 2)
      await api['rec:chunk'](id, 'screen', data.slice(0, half).buffer)
      await api['rec:chunk'](id, 'screen', data.slice(half).buffer)
      await api['rec:disable'](id, 'mic', 'Microphone off')
      const manifest = await api['rec:finalize'](id, 1000)
      const listed = await api['rec:list']()
      return { dir, manifest, listedIds: listed.map((m) => m.id) }
    },
    { libraryDir: library, bytes }
  )

  expect(result.manifest.status).toBe('complete')
  expect(Object.keys(result.manifest.tracks)).toEqual(['screen'])
  expect(result.manifest.disabledTracks.mic).toBe('Microphone off')
  expect(result.listedIds).toEqual([result.manifest.id])
  expect(existsSync(join(result.dir, 'screen.fixed.webm'))).toBe(false)
  // finalize's stream-copy remux adds the duration MediaRecorder output lacks.
  expect(Number(probeDuration(join(result.dir, 'screen.webm')))).toBeGreaterThan(0.5)

  await app.close()
})
