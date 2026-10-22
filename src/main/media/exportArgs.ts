import { join } from 'path'
import type { RecordingManifest, Size, TrackKind } from '../../shared/types'

export type Mp4Options = { micGain: number; systemGain: number; includeCamera: boolean }
export type GifOptions = { fps: number; width: number }

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)
const DEFAULT_BUBBLE_FRACTION = 0.2
const DEFAULT_BUBBLE_MARGIN = 24

/** Size of the exported frame: the crop if any, else the captured video; always even. */
export function frameSize(m: RecordingManifest): Size {
  const s = m.crop ?? m.videoSize
  return { width: even(s.width), height: even(s.height) }
}

function cropFilter(m: RecordingManifest): string {
  const c = m.crop
  return c ? `crop=${c.width}:${c.height}:${c.x}:${c.y},` : ''
}

/**
 * Where the camera circle goes in the exported frame (pixels): the recorded bubble position
 * mapped from DIP to video pixels and shifted by the crop, clamped inside the frame.
 * Without a recorded bubble (or for window capture) it defaults to bottom-left.
 */
export function bubbleOverlayBox(m: RecordingManifest, frame: Size): { x: number; y: number; size: number } {
  const bounds = m.source.displayBoundsDip
  const maxSize = even(Math.min(frame.width, frame.height))
  if (m.bubble && bounds) {
    const scale = m.videoSize.width / bounds.width
    const size = Math.min(even(Math.round(m.bubble.sizeDip * scale)), maxSize)
    const x = Math.round(m.bubble.xDip * scale - (m.crop?.x ?? 0))
    const y = Math.round(m.bubble.yDip * scale - (m.crop?.y ?? 0))
    return {
      x: Math.min(Math.max(0, x), frame.width - size),
      y: Math.min(Math.max(0, y), frame.height - size),
      size
    }
  }
  const size = Math.min(even(Math.round(frame.width * DEFAULT_BUBBLE_FRACTION)), maxSize)
  return {
    x: Math.min(DEFAULT_BUBBLE_MARGIN, frame.width - size),
    y: Math.max(0, frame.height - DEFAULT_BUBBLE_MARGIN - size),
    size
  }
}

type Input = { kind: TrackKind; file: string; offsetMs: number }

/** Inputs in a fixed order, with offsets relative to whichever included track started first. */
function collectInputs(m: RecordingManifest, dir: string, kinds: TrackKind[]): Input[] {
  const present = kinds.flatMap((kind) => {
    const t = m.tracks[kind]
    return t ? [{ kind, file: join(dir, t.file), offsetMs: t.offsetMs }] : []
  })
  const first = Math.min(...present.map((p) => p.offsetMs))
  return present.map((p) => ({ ...p, offsetMs: p.offsetMs - first }))
}

const isAudio = (k: TrackKind): boolean => k === 'mic' || k === 'system'

/**
 * Video inputs are shifted with -itsoffset. Audio is delayed inside the graph instead (adelay):
 * amix ignores input timestamps, so an -itsoffset on audio would be lost in the mix.
 */
function inputArgs(inputs: Input[]): string[] {
  return inputs.flatMap((i) =>
    i.offsetMs > 0 && !isAudio(i.kind) ? ['-itsoffset', String(i.offsetMs / 1000), '-i', i.file] : ['-i', i.file]
  )
}

export function buildMp4Args(m: RecordingManifest, dir: string, out: string, opts: Mp4Options): string[] {
  if (!m.tracks.screen) throw new Error('This recording has no screen track to export.')
  const kinds: TrackKind[] = ['screen', ...(opts.includeCamera ? (['camera'] as const) : []), 'mic', 'system']
  const inputs = collectInputs(m, dir, kinds)
  const index = (k: TrackKind): number => inputs.findIndex((i) => i.kind === k)
  const frame = frameSize(m)

  const filters: string[] = [`[0:v]${cropFilter(m)}scale=${frame.width}:${frame.height},setsar=1[base]`]
  let video = '[base]'
  const cam = index('camera')
  if (cam >= 0) {
    const box = bubbleOverlayBox(m, frame)
    filters.push(
      `[${cam}:v]crop='min(iw,ih)':'min(iw,ih)',scale=${box.size}:${box.size},format=yuva420p,` +
        `geq=lum='p(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lte(hypot(X-W/2,Y-H/2),W/2),255,0)'[cam]`,
      `[base][cam]overlay=${box.x}:${box.y}:shortest=0:eof_action=pass[v]`
    )
    video = '[v]'
  }

  const audio: string[] = []
  const gains: Partial<Record<TrackKind, number>> = { mic: opts.micGain, system: opts.systemGain }
  for (const k of ['mic', 'system'] as const) {
    const i = index(k)
    if (i < 0) continue
    const delay = inputs[i].offsetMs > 0 ? `adelay=${Math.round(inputs[i].offsetMs)}:all=1,` : ''
    filters.push(`[${i}:a]${delay}volume=${gains[k]}[a${k}]`)
    audio.push(`[a${k}]`)
  }
  let audioLabel: string | null = null
  if (audio.length === 1) audioLabel = audio[0]
  if (audio.length > 1) {
    filters.push(`${audio.join('')}amix=inputs=${audio.length}:normalize=0:duration=longest[a]`)
    audioLabel = '[a]'
  }

  return [
    '-hide_banner',
    ...inputArgs(inputs),
    '-filter_complex',
    filters.join(';'),
    '-map',
    video,
    ...(audioLabel ? ['-map', audioLabel, '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-n',
    out
  ]
}

export function buildGifArgs(m: RecordingManifest, dir: string, out: string, opts: GifOptions): string[] {
  if (!m.tracks.screen) throw new Error('This recording has no screen track to export.')
  const filter =
    `[0:v]${cropFilter(m)}fps=${opts.fps},scale=${opts.width}:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a[g]`
  return ['-hide_banner', '-i', join(dir, m.tracks.screen.file), '-filter_complex', filter, '-map', '[g]', '-n', out]
}

/** `-progress pipe:1` reports out_time_ms (in microseconds, despite the name). */
export function parseFfmpegProgress(line: string, totalMs: number): number | null {
  const match = /^out_time_ms=(\d+)$/.exec(line.trim())
  if (!match || totalMs <= 0) return null
  return Math.min(100, Math.round((Number(match[1]) / 1000 / totalMs) * 100))
}
