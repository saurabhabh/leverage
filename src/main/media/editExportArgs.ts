import { join } from 'path'
import { relativeOffsets, sourceToOutput, type Clip, type EditDoc } from '../../shared/edit'
import type { RecordingManifest, TrackKind } from '../../shared/types'
import { cropFilter, frameSize } from './exportArgs'

/**
 * Export is done per clip ("segment"), then the segments are joined. Each segment seeks every
 * input straight to its clip, so ffmpeg never decodes and buffers video that plays later; memory
 * stays flat however clips are ordered and the work is linear in the number of clips.
 */

export type Segment = { index: number; clip: Clip; outStartMs: number; lenMs: number }
export type GifOptions = { fps: number; width: number }

const sec = (ms: number): string => String(Math.round(ms) / 1000)
const even = (n: number): number => Math.floor(n / 2) * 2
const FPS = 30

export function planSegments(e: EditDoc): Segment[] {
  let out = 0
  return e.clips.map((clip, index) => {
    const seg = { index, clip, outStartMs: out, lenMs: clip.srcEndMs - clip.srcStartMs }
    out += seg.lenMs
    return seg
  })
}

/** Whether exports of this edit carry audio (some recorded audio track that isn't muted). */
export const hasExportAudio = (m: RecordingManifest, e: EditDoc): boolean =>
  (['mic', 'system'] as const).some((k) => m.tracks[k] && !e.muted[k])

/** Where (in segment-local ms) a source range shows within this segment. */
function localWindows(e: EditDoc, seg: Segment, srcStartMs: number, srcEndMs: number): { a: number; b: number }[] {
  const end = seg.outStartMs + seg.lenMs
  return sourceToOutput(e, srcStartMs, srcEndMs)
    .map((iv) => ({ a: Math.max(iv.outStartMs, seg.outStartMs), b: Math.min(iv.outEndMs, end) }))
    .filter((w) => w.b > w.a)
    .map((w) => ({ a: w.a - seg.outStartMs, b: w.b - seg.outStartMs }))
}

const enable = (ws: { a: number; b: number }[]): string =>
  `enable='${ws.map((w) => `between(t,${sec(w.a)},${sec(w.b)})`).join('+')}'`

type Graph = { inputs: string[]; filters: string[]; next: number; label: number }
const fresh = (g: Graph, p: string): string => `[${p}${g.label++}]`

function addInput(g: Graph, file: string, seek?: { from: number; len: number }): number {
  if (seek) g.inputs.push('-ss', sec(seek.from), '-t', sec(seek.len))
  g.inputs.push('-i', file)
  return g.next++
}

/**
 * How a track lines up with a segment: `pre` ms of padding before the track has started, then read
 * `read` ms from `seek` in the track's own time. read <= 0 means the track plays no part.
 */
function windowFor(m: RecordingManifest, k: TrackKind, seg: Segment): { pre: number; seek: number; read: number } {
  const local = seg.clip.srcStartMs - (relativeOffsets(m)[k] ?? 0)
  const pre = Math.max(0, -local)
  return { pre, seek: Math.max(0, local), read: seg.lenMs - pre }
}

function clampRect(r: { x: number; y: number; width: number; height: number }, frame: { width: number; height: number }) {
  const x0 = Math.max(0, Math.min(frame.width, Math.min(r.x, r.x + r.width)))
  const y0 = Math.max(0, Math.min(frame.height, Math.min(r.y, r.y + r.height)))
  const x1 = Math.max(0, Math.min(frame.width, Math.max(r.x, r.x + r.width)))
  const y1 = Math.max(0, Math.min(frame.height, Math.max(r.y, r.y + r.height)))
  return { x: Math.round(x0), y: Math.round(y0), width: even(x1 - x0), height: even(y1 - y0) }
}

/** Video for one track in one segment: aligned, padded and cut to exactly the segment length. */
function videoTrack(g: Graph, m: RecordingManifest, k: 'screen' | 'camera', dir: string, seg: Segment): string | null {
  const t = m.tracks[k]
  if (!t) return null
  const w = windowFor(m, k, seg)
  if (w.read <= 0) return null
  const input = addInput(g, join(dir, t.file), { from: w.seek, len: w.read })
  const out = fresh(g, k === 'screen' ? 's' : 'c')
  const pad = w.pre > 0 ? `start_duration=${sec(w.pre)}:color=black:` : ''
  g.filters.push(
    `[${input}:v]setpts=PTS-STARTPTS,tpad=${pad}stop_mode=clone:stop_duration=${sec(seg.lenMs)},trim=duration=${sec(seg.lenMs)}${out}`
  )
  return out
}

export function buildSegmentArgs(
  m: RecordingManifest,
  e: EditDoc,
  seg: Segment,
  dir: string,
  out: string,
  pngs: Record<string, string>,
  maskPath: string | null,
  opts: { audio: boolean }
): string[] {
  if (!m.tracks.screen) throw new Error('This recording has no screen track to export.')
  const g: Graph = { inputs: [], filters: [], next: 0, label: 0 }
  const frame = frameSize(m)
  const len = sec(seg.lenMs)

  let raw = videoTrack(g, m, 'screen', dir, seg)
  if (!raw) {
    raw = fresh(g, 's')
    g.filters.push(`color=c=black:s=${m.videoSize.width}x${m.videoSize.height}:r=${FPS}:d=${len}${raw}`)
  }
  let base = fresh(g, 'b')
  g.filters.push(`${raw}${cropFilter(m)}scale=${frame.width}:${frame.height},setsar=1${base}`)

  for (const o of e.overlays) {
    if (o.kind !== 'blur') continue
    const ws = localWindows(e, seg, o.srcStartMs, o.srcEndMs)
    const r = clampRect(o.rect, frame)
    // boxblur's radius must fit the half-size chroma planes: radius <= min(w,h)/4, so need >= 4 px.
    const fits = Math.floor(Math.min(r.width, r.height) / 4)
    if (ws.length === 0 || fits < 1) continue
    const [keep, take, blurred, next] = [fresh(g, 'k'), fresh(g, 't'), fresh(g, 'z'), fresh(g, 'b')]
    g.filters.push(
      `${base}split${keep}${take}`,
      `${take}crop=${r.width}:${r.height}:${r.x}:${r.y},boxblur=${Math.min(o.strength, fits)}${blurred}`,
      `${keep}${blurred}overlay=${r.x}:${r.y}:${enable(ws)}${next}`
    )
    base = next
  }

  const cam = e.camera?.visible && maskPath ? e.camera : null
  const camStream = cam ? videoTrack(g, m, 'camera', dir, seg) : null
  if (cam && camStream) {
    const maskIn = addInput(g, maskPath!)
    const size = even(Math.min(cam.size, frame.width, frame.height))
    const x = Math.round(Math.min(Math.max(0, cam.x), frame.width - size))
    const y = Math.round(Math.min(Math.max(0, cam.y), frame.height - size))
    const [sq, mask, circle, next] = [fresh(g, 'q'), fresh(g, 'm'), fresh(g, 'r'), fresh(g, 'b')]
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
    const ws = localWindows(e, seg, o.srcStartMs, o.srcEndMs)
    if (ws.length === 0) continue
    const pngIn = addInput(g, pngs[o.id])
    const next = fresh(g, 'b')
    g.filters.push(`${base}[${pngIn}:v]overlay=0:0:${enable(ws)}${next}`)
    base = next
  }

  let audio: string | null = null
  if (opts.audio && hasExportAudio(m, e)) {
    const levels: string[] = []
    for (const k of ['mic', 'system'] as const) {
      const t = m.tracks[k]
      if (!t || e.muted[k]) continue
      const w = windowFor(m, k, seg)
      if (w.read <= 0) continue
      const input = addInput(g, join(dir, t.file), { from: w.seek, len: w.read })
      const level = fresh(g, 'l')
      const delay = w.pre > 0 ? `adelay=${Math.round(w.pre)}:all=1,` : ''
      g.filters.push(`[${input}:a]asetpts=PTS-STARTPTS,${delay}apad=whole_dur=${len},atrim=duration=${len},volume=${e.gains[k]}${level}`)
      levels.push(level)
    }
    audio = fresh(g, 'a')
    if (levels.length === 0) g.filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${len}${audio}`)
    else if (levels.length === 1) g.filters.push(`${levels[0]}anull${audio}`)
    else g.filters.push(`${levels.join('')}amix=inputs=${levels.length}:normalize=0:duration=longest${audio}`)
  }

  return [
    '-hide_banner',
    ...g.inputs,
    '-filter_complex',
    g.filters.join(';'),
    '-map',
    base,
    ...(audio ? ['-map', audio, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2'] : ['-an']),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-fps_mode',
    'cfr',
    '-r',
    String(FPS),
    '-t',
    len,
    '-f',
    'matroska',
    '-y',
    out
  ]
}

/** Join the segments: video is copied, audio encoded once (sample-exact, no seams). */
export function buildConcatMp4Args(listFile: string, out: string, audio: boolean): string[] {
  return [
    '-hide_banner',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-map',
    '0:v',
    ...(audio ? ['-map', '0:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k'] : ['-c:v', 'copy', '-an']),
    '-movflags',
    '+faststart',
    '-n',
    out
  ]
}

export function buildConcatGifArgs(listFile: string, out: string, opts: GifOptions): string[] {
  const f =
    `[0:v]fps=${opts.fps},scale=${opts.width}:-1:flags=lanczos,split[ga][gb];` +
    '[ga]palettegen=stats_mode=full[gp];[gb][gp]paletteuse=dither=sierra2_4a[gif]'
  return ['-hide_banner', '-f', 'concat', '-safe', '0', '-i', listFile, '-filter_complex', f, '-map', '[gif]', '-n', out]
}

/** Overlays that need a rendered PNG for export. */
export const pngOverlays = (e: EditDoc): EditDoc['overlays'] => e.overlays.filter((o) => o.kind !== 'blur')
