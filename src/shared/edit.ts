import { z } from 'zod'
import type { RecordingManifest } from './types'

/**
 * Non-destructive edit of one recording. Everything is in integer milliseconds on the SOURCE
 * timeline: 0 = the earliest track's start, every track aligned by its offset relative to it.
 * Clips are source ranges played in order; overlays are anchored to source time so they follow
 * their content through cuts and moves.
 */

export const MIN_CLIP_MS = 100

const RectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const Span = { id: z.string(), srcStartMs: z.number(), srcEndMs: z.number() }

export const ClipSchema = z.object(Span)
export const BlurOverlaySchema = z.object({
  ...Span,
  kind: z.literal('blur'),
  rect: RectSchema,
  strength: z.number().min(1).max(20)
})
export const CalloutOverlaySchema = z.object({
  ...Span,
  kind: z.enum(['arrow', 'box', 'text']),
  /** Output-frame px. For arrows: tail at (x,y), head at (x+width, y+height); sizes may be negative. */
  rect: RectSchema,
  text: z.string(),
  color: z.string()
})
export const LowerThirdSchema = z.object({
  ...Span,
  kind: z.literal('lowerThird'),
  title: z.string(),
  subtitle: z.string()
})
export const OverlaySchema = z.union([BlurOverlaySchema, CalloutOverlaySchema, LowerThirdSchema])
export const CameraSettingsSchema = z.object({
  visible: z.boolean(),
  x: z.number(),
  y: z.number(),
  size: z.number().positive()
})
export const EditDocSchema = z.object({
  version: z.literal(1),
  clips: z.array(ClipSchema).min(1),
  overlays: z.array(OverlaySchema),
  camera: CameraSettingsSchema.nullable(),
  gains: z.object({ mic: z.number().min(0).max(4), system: z.number().min(0).max(4) }),
  muted: z.object({ mic: z.boolean(), system: z.boolean() })
})

export type Clip = z.infer<typeof ClipSchema>
export type BlurOverlay = z.infer<typeof BlurOverlaySchema>
export type CalloutOverlay = z.infer<typeof CalloutOverlaySchema>
export type LowerThird = z.infer<typeof LowerThirdSchema>
export type Overlay = z.infer<typeof OverlaySchema>
export type CameraSettings = z.infer<typeof CameraSettingsSchema>
export type EditDoc = z.infer<typeof EditDocSchema>

export const newId = (): string => globalThis.crypto.randomUUID()
const SAFE_ID = /^[A-Za-z0-9-]+$/

const len = (c: Clip): number => c.srcEndMs - c.srcStartMs

/** Offsets of each track relative to the earliest one (the Plan A export rule). */
export function relativeOffsets(m: RecordingManifest): Partial<Record<keyof RecordingManifest['tracks'], number>> {
  const entries = Object.entries(m.tracks) as [keyof RecordingManifest['tracks'], { offsetMs: number }][]
  const first = Math.min(...entries.map(([, t]) => t.offsetMs))
  return Object.fromEntries(entries.map(([k, t]) => [k, t.offsetMs - first]))
}

/**
 * Length of the source timeline. durationMs counts from the session start and every track stops at
 * the same moment, so the timeline runs from the earliest track's start to durationMs.
 */
export function sourceDurationMs(m: RecordingManifest): number {
  const offsets = Object.values(m.tracks).map((t) => t.offsetMs)
  return Math.max(0, m.durationMs - (offsets.length ? Math.min(...offsets) : 0))
}

export function defaultEdit(
  _m: RecordingManifest,
  sourceMs: number,
  camera: { x: number; y: number; size: number } | null
): EditDoc {
  return {
    version: 1,
    clips: [{ id: newId(), srcStartMs: 0, srcEndMs: Math.max(MIN_CLIP_MS, Math.round(sourceMs)) }],
    overlays: [],
    camera: camera ? { visible: true, ...camera } : null,
    gains: { mic: 1, system: 1 },
    muted: { mic: false, system: false }
  }
}

export function outputDurationMs(e: EditDoc): number {
  return e.clips.reduce((sum, c) => sum + len(c), 0)
}

export function outputToSource(e: EditDoc, outMs: number): { clipIndex: number; srcMs: number } {
  const t = Math.max(0, outMs)
  let start = 0
  for (let i = 0; i < e.clips.length; i++) {
    const c = e.clips[i]
    if (t < start + len(c)) return { clipIndex: i, srcMs: c.srcStartMs + (t - start) }
    start += len(c)
  }
  const last = e.clips.length - 1
  return { clipIndex: last, srcMs: e.clips[last].srcEndMs }
}

/** Where a source range plays in the output: one interval per clip it survives in, in output order. */
export function sourceToOutput(
  e: EditDoc,
  srcStartMs: number,
  srcEndMs: number
): { outStartMs: number; outEndMs: number }[] {
  const out: { outStartMs: number; outEndMs: number }[] = []
  let start = 0
  for (const c of e.clips) {
    const a = Math.max(c.srcStartMs, srcStartMs)
    const b = Math.min(c.srcEndMs, srcEndMs)
    if (b > a) out.push({ outStartMs: start + (a - c.srcStartMs), outEndMs: start + (b - c.srcStartMs) })
    start += len(c)
  }
  return out
}

export function splitAt(e: EditDoc, outMs: number): EditDoc {
  if (outMs <= 0 || outMs >= outputDurationMs(e)) return e
  const { clipIndex, srcMs } = outputToSource(e, outMs)
  const c = e.clips[clipIndex]
  if (srcMs - c.srcStartMs < MIN_CLIP_MS || c.srcEndMs - srcMs < MIN_CLIP_MS) return e
  const clips = [...e.clips]
  clips.splice(
    clipIndex,
    1,
    { ...c, srcEndMs: srcMs },
    { id: newId(), srcStartMs: srcMs, srcEndMs: c.srcEndMs }
  )
  return { ...e, clips }
}

export function deleteClip(e: EditDoc, clipId: string): EditDoc {
  const clips = e.clips.filter((c) => c.id !== clipId)
  if (clips.length === 0 || clips.length === e.clips.length) return e
  return { ...e, clips }
}

export function cutRange(e: EditDoc, outStartMs: number, outEndMs: number): EditDoc {
  const a = Math.min(outStartMs, outEndMs)
  const b = Math.max(outStartMs, outEndMs)
  if (b - a <= 0) return e
  const clips: Clip[] = []
  let start = 0
  for (const c of e.clips) {
    const end = start + len(c)
    // Keep the part of this clip before the cut and the part after it.
    if (a > start) {
      const keepEnd = c.srcStartMs + (Math.min(a, end) - start)
      clips.push({ ...c, srcEndMs: keepEnd })
    }
    if (b < end) {
      const keepStart = c.srcStartMs + (Math.max(b, start) - start)
      clips.push({ id: a > start ? newId() : c.id, srcStartMs: keepStart, srcEndMs: c.srcEndMs })
    }
    start = end
  }
  const kept = clips.filter((c) => len(c) >= MIN_CLIP_MS)
  if (kept.length === 0) return e
  return { ...e, clips: kept }
}

export function moveClip(e: EditDoc, clipId: string, toIndex: number): EditDoc {
  const from = e.clips.findIndex((c) => c.id === clipId)
  if (from < 0) return e
  const to = Math.max(0, Math.min(e.clips.length - 1, toIndex))
  if (from === to) return e
  const clips = [...e.clips]
  const [c] = clips.splice(from, 1)
  clips.splice(to, 0, c)
  return { ...e, clips }
}

export function addOverlay(e: EditDoc, o: Overlay): EditDoc {
  return { ...e, overlays: [...e.overlays, o] }
}

export function updateOverlay(e: EditDoc, id: string, patch: Partial<Overlay>): EditDoc {
  return { ...e, overlays: e.overlays.map((o) => (o.id === id ? ({ ...o, ...patch, id, kind: o.kind } as Overlay) : o)) }
}

export function removeOverlay(e: EditDoc, id: string): EditDoc {
  return { ...e, overlays: e.overlays.filter((o) => o.id !== id) }
}

export function setCamera(e: EditDoc, patch: Partial<CameraSettings>): EditDoc {
  if (!e.camera) return e
  return { ...e, camera: { ...e.camera, ...patch } }
}

export function setGain(e: EditDoc, track: 'mic' | 'system', gain: number): EditDoc {
  return { ...e, gains: { ...e.gains, [track]: Math.min(4, Math.max(0, gain)) } }
}

export function setMuted(e: EditDoc, track: 'mic' | 'system', muted: boolean): EditDoc {
  return { ...e, muted: { ...e.muted, [track]: muted } }
}

/** Make a loaded edit safe to use against this recording; anything unusable falls back. */
export function repairEdit(raw: unknown, sourceMs: number, fallback: EditDoc): { edit: EditDoc; repaired: boolean } {
  const parsed = EditDocSchema.safeParse(raw)
  if (!parsed.success) return { edit: fallback, repaired: true }
  const e = parsed.data
  let repaired = false
  const clips = e.clips.flatMap((c) => {
    const s = Math.max(0, Math.round(c.srcStartMs))
    const t = Math.min(sourceMs, Math.round(c.srcEndMs))
    if (s !== c.srcStartMs || t !== c.srcEndMs) repaired = true
    if (t - s < MIN_CLIP_MS) {
      repaired = true
      return []
    }
    return [{ ...c, srcStartMs: s, srcEndMs: t }]
  })
  const overlays = e.overlays.filter((o) => {
    const ok = o.srcEndMs > o.srcStartMs
    if (!ok) repaired = true
    return ok
  })
  if (clips.length === 0) return { edit: fallback, repaired: true }
  // Ids must be unique (selection, delete) and file-safe (overlay PNG names).
  const seen = new Set<string>()
  const unique = <T extends { id: string }>(x: T): T => {
    if (seen.has(x.id) || !SAFE_ID.test(x.id)) {
      repaired = true
      x = { ...x, id: newId() }
    }
    seen.add(x.id)
    return x
  }
  const fixedClips = clips.map(unique)
  const fixedOverlays = overlays.map(unique)
  return { edit: repaired ? { ...e, clips: fixedClips, overlays: fixedOverlays } : e, repaired }
}
