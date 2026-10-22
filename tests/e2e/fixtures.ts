import { execFileSync } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import ffmpeg from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'
import { join } from 'path'

export const live = (out: string, input: string[], codec: string[], seconds = 3): void => {
  execFileSync(ffmpeg!, ['-v', 'error', ...input, '-t', String(seconds), ...codec, '-f', 'webm', '-live', '1', out])
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
  'system.webm': [['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000'], ['-c:a', 'libopus']],
  // Real speech (Windows TTS) for transcription tests; ~11 s, so not cut to 3 s.
  'speech.webm': [['-i', join(__dirname, '..', 'fixtures', 'speech.wav')], ['-c:a', 'libopus']],
  // Tone 0–1 s, silence 1–2.5 s, tone 2.5–3 s.
  'pause.webm': [['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'], ['-af', "volume='if(between(t,1,2.5),0,1)':eval=frame", '-c:a', 'libopus']]
}

function copyMedia(name: string, dir: string, as = name): void {
  const cached = join(MEDIA_CACHE, name)
  if (!existsSync(cached)) {
    mkdirSync(MEDIA_CACHE, { recursive: true })
    const tmp = cached + '.part.webm'
    live(tmp, ...MEDIA[name], name === 'speech.webm' ? 20 : 3)
    copyFileSync(tmp, cached)
  }
  copyFileSync(cached, join(dir, as))
}

/** A recording interrupted by a crash: raw live-mode WebM (no duration/cues), status "recording". */
export type SeedOptions = {
  camera?: boolean
  /** false: no mic and no system audio tracks at all. */
  audio?: boolean
  /** Mic track holds real speech instead of a tone. */
  micSpeech?: boolean
  /** Mic track has a 1.5 s pause (1–2.5 s). */
  micPause?: boolean
  /** Pre-made transcript.json (source-timeline words). */
  transcript?: { text: string; startMs: number; endMs: number }[]
}

export function seedCrashedRecording(library: string, opts: SeedOptions = {}): string {
  const withCamera = opts.camera ?? true
  const withAudio = opts.audio ?? true
  const dir = join(library, '2026-10-22 10-00-00')
  mkdirSync(dir, { recursive: true })
  copyMedia('screen.webm', dir)
  if (withCamera) copyMedia('camera.webm', dir)
  if (withAudio) {
    copyMedia(opts.micSpeech ? 'speech.webm' : opts.micPause ? 'pause.webm' : 'mic.webm', dir, 'mic.webm')
    copyMedia('system.webm', dir)
  }
  if (opts.transcript) {
    writeFileSync(
      join(dir, 'transcript.json'),
      JSON.stringify({ version: 1, engine: 'local', language: 'en', track: 'mic', words: opts.transcript, createdAt: '2026-10-22T10:00:00.000Z' })
    )
  }
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
      tracks: {
        screen: t('screen.webm'),
        ...(withCamera ? { camera: t('camera.webm', 100) } : {}),
        ...(withAudio ? { mic: t('mic.webm', 50), system: t('system.webm') } : {})
      },
      disabledTracks: {}
    })
  )
  return dir
}

