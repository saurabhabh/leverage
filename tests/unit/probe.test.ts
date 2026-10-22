import { test, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync } from 'fs'
import ffmpeg from 'ffmpeg-static'
import { tmpdir } from 'os'
import { join } from 'path'
import { lastPacketEndSeconds, probeDurationSeconds } from '../../src/main/media/probe'

test('lastPacketEndSeconds takes the latest pts + duration, ignoring N/A lines', () => {
  expect(lastPacketEndSeconds('0.000000,0.033000\n2.900000,0.033000\nN/A,N/A\n1.000000,0.020000\n')).toBeCloseTo(2.933)
  expect(lastPacketEndSeconds('')).toBe(0)
})

test('probeDurationSeconds measures a live WebM that has no stored duration', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'lev-probe-')), 'live.webm')
  execFileSync(ffmpeg!, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=15', '-t', '3', '-c:v', 'libvpx', '-f', 'webm', '-live', '1', file])
  expect(await probeDurationSeconds(file)).toBeGreaterThan(2.8)
}, 30_000)
