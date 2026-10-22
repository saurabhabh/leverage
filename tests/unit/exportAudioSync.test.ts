import { test, expect } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync } from 'fs'
import ffmpeg from 'ffmpeg-static'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildMp4Args } from '../../src/main/media/exportArgs'
import type { RecordingManifest } from '../../src/shared/types'

const run = (args: string[]): string =>
  execFileSync(ffmpeg!, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString()

/** Silent stretches of the output's audio, from ffmpeg's silencedetect (which logs to stderr). */
function silences(file: string): { start: number; end: number }[] {
  const { stderr } = spawnSync(
    ffmpeg!,
    ['-hide_banner', '-i', file, '-af', 'silencedetect=n=-40dB:d=0.3', '-f', 'null', '-'],
    { encoding: 'utf8' }
  )
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
  return starts.map((s, i) => ({ start: s, end: ends[i] ?? Infinity }))
}

test('mixed mic + system audio keep their start offsets in the exported MP4', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lev-sync-'))
  // 4 s of video; a 1 s tone for the mic (starts at t0) and a 1 s tone for system audio that started 2 s later.
  run(['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=15', '-t', '4', '-c:v', 'libvpx', join(dir, 'screen.webm')])
  run(['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:r=48000', '-t', '1', '-c:a', 'libopus', join(dir, 'mic.webm')])
  run(['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=880:r=48000', '-t', '1', '-c:a', 'libopus', join(dir, 'system.webm')])
  const m: RecordingManifest = {
    version: 1,
    id: 'sync',
    title: 'sync',
    createdAt: '2026-10-22T00:00:00.000Z',
    status: 'complete',
    durationMs: 4000,
    source: { kind: 'screen', name: 's', scaleFactor: 1 },
    videoSize: { width: 320, height: 240 },
    tracks: {
      screen: { file: 'screen.webm', mime: 'x', offsetMs: 0 },
      mic: { file: 'mic.webm', mime: 'x', offsetMs: 0 },
      system: { file: 'system.webm', mime: 'x', offsetMs: 2000 }
    },
    disabledTracks: {}
  }
  const out = join(dir, 'out.mp4')
  run(['-v', 'error', ...buildMp4Args(m, dir, out, { micGain: 1, systemGain: 1, includeCamera: false })])

  // Expect: tone 0–1 s, silence 1–2 s, tone 2–3 s.
  const gap = silences(out).find((s) => s.start > 0.8 && s.start < 1.3)
  expect(gap, JSON.stringify(silences(out))).toBeDefined()
  expect(gap!.end).toBeGreaterThan(1.8)
  expect(gap!.end).toBeLessThan(2.3)
}, 30_000)
