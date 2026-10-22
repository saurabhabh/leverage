import { execFileSync } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import ffmpeg from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'
import { join } from 'path'

export const live = (out: string, input: string[], codec: string[]): void => {
  execFileSync(ffmpeg!, ['-v', 'error', ...input, '-t', '3', ...codec, '-f', 'webm', '-live', '1', out])
}

export const probe = (file: string): { streams: string[]; width: number; duration: number } => {
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

/** Generated once per test process and copied into each seeded recording. */
const MEDIA_CACHE = join(tmpdir(), 'lev-fixture-media-v1')
const MEDIA: Record<string, [string[], string[]]> = {
  'screen.webm': [['-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30'], ['-c:v', 'libvpx', '-b:v', '1M']],
  'camera.webm': [['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=30'], ['-c:v', 'libvpx', '-b:v', '500k']],
  'mic.webm': [['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'], ['-c:a', 'libopus']],
  'system.webm': [['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000'], ['-c:a', 'libopus']]
}

function copyMedia(name: string, dir: string): void {
  const cached = join(MEDIA_CACHE, name)
  if (!existsSync(cached)) {
    mkdirSync(MEDIA_CACHE, { recursive: true })
    const tmp = cached + '.part.webm'
    live(tmp, ...MEDIA[name])
    copyFileSync(tmp, cached)
  }
  copyFileSync(cached, join(dir, name))
}

/** A recording interrupted by a crash: raw live-mode WebM (no duration/cues), status "recording". */
export function seedCrashedRecording(library: string, opts: { camera?: boolean } = {}): string {
  const withCamera = opts.camera ?? true
  const dir = join(library, '2026-10-22 10-00-00')
  mkdirSync(dir, { recursive: true })
  for (const name of ['screen.webm', ...(withCamera ? ['camera.webm'] : []), 'mic.webm', 'system.webm']) copyMedia(name, dir)
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
      tracks: { screen: t('screen.webm'), ...(withCamera ? { camera: t('camera.webm', 100) } : {}), mic: t('mic.webm', 50), system: t('system.webm') },
      disabledTracks: {}
    })
  )
  return dir
}

