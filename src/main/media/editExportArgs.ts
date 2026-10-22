import { join } from 'path'
import {
  outputDurationMs,
  relativeOffsets,
  sourceDurationMs,
  sourceToOutput,
  type EditDoc,
  type Overlay
} from '../../shared/edit'
import type { RecordingManifest, Size, TrackKind } from '../../shared/types'
import { cropFilter, frameSize } from './exportArgs'

/**
 * ffmpeg arguments for exporting an edit. Every track is first padded onto the full source timeline
 * (start offset + tail), so trimming the same source range from each track gives equal-length
 * pieces; those are concatenated in clip order. Then: crop/scale, blur, camera circle, rendered
 * callout/lower-third PNGs, and the audio mix.
 */

export type GifOptions = { fps: number; width: number }

const sec = (ms: number): string => String(Math.round(ms) / 1000)
const even = (n: number): number => Math.floor(n / 2) * 2
const between = (ivs: { outStartMs: number; outEndMs: number }[]): string =>
  `enable='${ivs.map((iv) => `between(t,${sec(iv.outStartMs)},${sec(iv.outEndMs)})`).join('+')}'`

type Graph = { inputs: string[]; filters: string[]; next: number; label: number }

function addInput(g: Graph, file: string): number {
  g.inputs.push('-i', file)
  return g.next++
}

const fresh = (g: Graph, prefix: string): string => `[${prefix}${g.label++}]`

/** Source length that every track is padded to. */
function sourceLength(m: RecordingManifest, e: EditDoc): number {
  const stored = m.durationMs > 0 ? sourceDurationMs(m) : 0
  return Math.max(stored, ...e.clips.map((c) => c.srcEndMs))
}

/**
 * Pad, then cut each clip and join them in order. `input` is an input index or a filter label.
 * Returns the label of the edited stream.
 */
function cutAndJoin(g: Graph, input: number | string, kind: 'v' | 'a', pad: string, e: EditDoc): string {
  const from = typeof input === 'number' ? `[${input}:${kind}]` : input
  const n = e.clips.length
  const trim = kind === 'v' ? 'trim' : 'atrim'
  const setpts = kind === 'v' ? 'setpts' : 'asetpts'
  const piece = (c: EditDoc['clips'][number]): string =>
    `${trim}=start=${sec(c.srcStartMs)}:end=${sec(c.srcEndMs)},${setpts}=PTS-STARTPTS`
  const out = fresh(g, kind === 'v' ? 'v' : 'a')
  if (n === 1) {
    g.filters.push(`${from}${pad},${piece(e.clips[0])}${out}`)
    return out
  }
  const parts = e.clips.map(() => fresh(g, 'p'))
  const pieces = e.clips.map(() => fresh(g, 'q'))
  g.filters.push(`${from}${pad},${kind === 'v' ? 'split' : 'asplit'}=${n}${parts.join('')}`)
  e.clips.forEach((c, i) => g.filters.push(`${parts[i]}${piece(c)}${pieces[i]}`))
  g.filters.push(`${pieces.join('')}concat=n=${n}:v=${kind === 'v' ? 1 : 0}:a=${kind === 'a' ? 1 : 0}${out}`)
  return out
}

function videoPad(offsetMs: number, lengthMs: number): string {
  const start = offsetMs > 0 ? `start_duration=${sec(offsetMs)}:color=black:` : ''
  return `tpad=${start}stop_mode=clone:stop_duration=${sec(lengthMs)}`
}

function audioPad(offsetMs: number, lengthMs: number): string {
  const delay = offsetMs > 0 ? `adelay=${Math.round(offsetMs)}:all=1,` : ''
  return `${delay}apad=whole_dur=${sec(lengthMs)}`
}

function clampRect(r: { x: number; y: number; width: number; height: number }, frame: Size) {
  const x0 = Math.max(0, Math.min(frame.width, Math.min(r.x, r.x + r.width)))
  const y0 = Math.max(0, Math.min(frame.height, Math.min(r.y, r.y + r.height)))
  const x1 = Math.max(0, Math.min(frame.width, Math.max(r.x, r.x + r.width)))
  const y1 = Math.max(0, Math.min(frame.height, Math.max(r.y, r.y + r.height)))
  return { x: Math.round(x0), y: Math.round(y0), width: even(x1 - x0), height: even(y1 - y0) }
}

/** The finished picture: edited screen with blur, camera and PNG overlays. Returns its label. */
function buildVideo(
  g: Graph,
  m: RecordingManifest,
  e: EditDoc,
  dir: string,
  pngs: Record<string, string>,
  maskPath: string | null
): string {
  if (!m.tracks.screen) throw new Error('This recording has no screen track to export.')
  const offsets = relativeOffsets(m)
  const length = sourceLength(m, e)
  const frame = frameSize(m)

  const screenIn = addInput(g, join(dir, m.tracks.screen.file))
  const cam = e.camera?.visible && m.tracks.camera && maskPath ? e.camera : null
  const camIn = cam ? addInput(g, join(dir, m.tracks.camera!.file)) : -1

  const screen = cutAndJoin(g, screenIn, 'v', videoPad(offsets.screen ?? 0, length), e)
  let base = fresh(g, 'b')
  g.filters.push(`${screen}${cropFilter(m)}scale=${frame.width}:${frame.height},setsar=1${base}`)

  for (const o of e.overlays) {
    if (o.kind !== 'blur') continue
    const ivs = sourceToOutput(e, o.srcStartMs, o.srcEndMs)
    const r = clampRect(o.rect, frame)
    if (ivs.length === 0 || r.width < 2 || r.height < 2) continue
    const radius = Math.max(1, Math.min(o.strength, Math.floor(Math.min(r.width, r.height) / 4)))
    const [keep, take, blurred, next] = [fresh(g, 'k'), fresh(g, 't'), fresh(g, 'z'), fresh(g, 'b')]
    g.filters.push(
      `${base}split${keep}${take}`,
      `${take}crop=${r.width}:${r.height}:${r.x}:${r.y},boxblur=${radius}${blurred}`,
      `${keep}${blurred}overlay=${r.x}:${r.y}:${between(ivs)}${next}`
    )
    base = next
  }

  if (cam && camIn >= 0) {
    const camStream = cutAndJoin(g, camIn, 'v', videoPad(offsets.camera ?? 0, length), e)
    const maskIn = addInput(g, maskPath!)
    const size = even(Math.min(cam.size, frame.width, frame.height))
    const x = Math.round(Math.min(Math.max(0, cam.x), frame.width - size))
    const y = Math.round(Math.min(Math.max(0, cam.y), frame.height - size))
    const [sq, mask, circle, next] = [fresh(g, 'c'), fresh(g, 'm'), fresh(g, 'r'), fresh(g, 'b')]
    g.filters.push(
      `${camStream}crop='min(iw,ih)':'min(iw,ih)',scale=${size}:${size},format=yuva420p${sq}`,
      `[${maskIn}:v]scale=${size}:${size},format=gray${mask}`,
      `${sq}${mask}alphamerge${circle}`,
      `${base}${circle}overlay=${x}:${y}${next}`
    )
    base = next
  }

  for (const o of e.overlays) {
    if (o.kind === 'blur' || !pngs[o.id]) continue
    const ivs = sourceToOutput(e, o.srcStartMs, o.srcEndMs)
    if (ivs.length === 0) continue
    const pngIn = addInput(g, pngs[o.id])
    const next = fresh(g, 'b')
    g.filters.push(`${base}[${pngIn}:v]overlay=0:0:${between(ivs)}${next}`)
    base = next
  }
  return base
}

export function buildEditedMp4Args(
  m: RecordingManifest,
  e: EditDoc,
  dir: string,
  out: string,
  pngs: Record<string, string>,
  maskPath: string | null
): string[] {
  const g: Graph = { inputs: [], filters: [], next: 0, label: 0 }
  const video = buildVideo(g, m, e, dir, pngs, maskPath)
  const offsets = relativeOffsets(m)
  const length = sourceLength(m, e)

  // Mix on the source timeline first, then cut once: amix after per-track cut/concat chains is
  // sensitive to ffmpeg's input scheduling and can drop a track's later pieces.
  const levels: string[] = []
  for (const k of ['mic', 'system'] as const) {
    const t = m.tracks[k]
    if (!t || e.muted[k]) continue
    const input = addInput(g, join(dir, t.file))
    const level = fresh(g, 'l')
    g.filters.push(`[${input}:a]${audioPad(offsets[k as TrackKind] ?? 0, length)},volume=${e.gains[k]}${level}`)
    levels.push(level)
  }
  let audio: string | null = null
  if (levels.length > 0) {
    let source = levels[0]
    if (levels.length > 1) {
      source = fresh(g, 'x')
      g.filters.push(`${levels.join('')}amix=inputs=${levels.length}:normalize=0:duration=longest${source}`)
    }
    audio = cutAndJoin(g, source, 'a', `apad=whole_dur=${sec(length)}`, e)
  }

  return [
    '-hide_banner',
    ...g.inputs,
    '-filter_complex',
    g.filters.join(';'),
    '-map',
    video,
    ...(audio ? ['-map', audio, '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
    '-t',
    sec(outputDurationMs(e)),
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

export function buildEditedGifArgs(
  m: RecordingManifest,
  e: EditDoc,
  dir: string,
  out: string,
  pngs: Record<string, string>,
  maskPath: string | null,
  opts: GifOptions
): string[] {
  const g: Graph = { inputs: [], filters: [], next: 0, label: 0 }
  const video = buildVideo(g, m, e, dir, pngs, maskPath)
  g.filters.push(
    `${video}fps=${opts.fps},scale=${opts.width}:-1:flags=lanczos,split[ga][gb]`,
    '[ga]palettegen=stats_mode=full[gp]',
    '[gb][gp]paletteuse=dither=sierra2_4a[gif]'
  )
  return ['-hide_banner', ...g.inputs, '-filter_complex', g.filters.join(';'), '-map', '[gif]', '-t', sec(outputDurationMs(e)), '-n', out]
}

/** Overlays that need a rendered PNG for export. */
export const pngOverlays = (e: EditDoc): Overlay[] => e.overlays.filter((o) => o.kind !== 'blur')
