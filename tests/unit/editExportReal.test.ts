import { test, expect } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync } from 'fs'
import ffmpeg from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildEditedMp4Args } from '../../src/main/media/editExportArgs'
import type { EditDoc } from '../../src/shared/edit'
import type { RecordingManifest } from '../../src/shared/types'

const run = (args: string[]): void => void execFileSync(ffmpeg!, args, { stdio: ['ignore', 'pipe', 'pipe'] })

function silences(file: string): { start: number; end: number }[] {
  const { stderr } = spawnSync(ffmpeg!, ['-hide_banner', '-i', file, '-af', 'silencedetect=n=-40dB:d=0.3', '-f', 'null', '-'], {
    encoding: 'utf8'
  })
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
  return starts.map((s, i) => ({ start: s, end: ends[i] ?? Infinity }))
}

test('reordered clips play the right audio at the right output time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lev-editreal-'))
  // Live-mode WebM, like real recordings: no stored duration.
  const live = (name: string, input: string[], codec: string[]): void =>
    run(['-v', 'error', ...input, ...codec, '-f', 'webm', '-live', '1', join(dir, name)])
  live('screen.webm', ['-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=15', '-t', '6'], ['-c:v', 'libvpx'])
  live('mic.webm', ['-f', 'lavfi', '-i', 'sine=f=440:r=48000', '-t', '1'], ['-c:a', 'libopus'])
  // System audio started 4 s into the recording and is a 1 s tone.
  live('system.webm', ['-f', 'lavfi', '-i', 'sine=f=880:r=48000', '-t', '1'], ['-c:a', 'libopus'])
  const m: RecordingManifest = {
    version: 1,
    id: 'x',
    title: 'x',
    createdAt: '2026-10-22T00:00:00.000Z',
    status: 'complete',
    durationMs: 6000,
    source: { kind: 'screen', name: 's', scaleFactor: 1 },
    videoSize: { width: 320, height: 240 },
    tracks: {
      screen: { file: 'screen.webm', mime: 'x', offsetMs: 0 },
      mic: { file: 'mic.webm', mime: 'x', offsetMs: 0 },
      system: { file: 'system.webm', mime: 'x', offsetMs: 4000 }
    },
    disabledTracks: {}
  }
  const e: EditDoc = {
    version: 1,
    clips: [
      { id: 'a', srcStartMs: 3000, srcEndMs: 6000 },
      { id: 'b', srcStartMs: 0, srcEndMs: 1000 }
    ],
    overlays: [],
    camera: null,
    gains: { mic: 1, system: 1 },
    muted: { mic: false, system: false }
  }
  const out = join(dir, 'out.mp4')
  run(['-v', 'error', ...buildEditedMp4Args(m, e, dir, out, {}, null)])

  const duration = Number(
    execFileSync(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString()
  )
  expect(duration).toBeGreaterThan(3.85)
  expect(duration).toBeLessThan(4.15)

  // Expect: silence 0–1 s, system tone 1–2 s, silence 2–3 s, mic tone 3–4 s.
  const s = silences(out)
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.2
  expect(s.some((x) => near(x.start, 0) && near(x.end, 1)), JSON.stringify(s)).toBe(true)
  expect(s.some((x) => near(x.start, 2) && near(x.end, 3)), JSON.stringify(s)).toBe(true)
  expect(s.some((x) => x.start > 3.1 && x.start < 3.9), JSON.stringify(s)).toBe(false)
}, 60_000)
