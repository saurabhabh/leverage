import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
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

/** A recording interrupted by a crash: raw live-mode WebM (no duration/cues), status "recording". */
export function seedCrashedRecording(library: string): string {
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

