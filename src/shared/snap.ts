import { z } from 'zod'

/** Snap shots: a frozen image plus a list of shapes drawn on it. All coordinates are image pixels. */

const PointSchema = z.object({ x: z.number(), y: z.number() })
const RectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const base = { id: z.string(), color: z.string(), size: z.number().positive() }

export const ShapeSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.enum(['pen', 'marker']), points: z.array(PointSchema).min(1) }),
  z.object({ ...base, kind: z.enum(['line', 'arrow']), a: PointSchema, b: PointSchema }),
  z.object({ ...base, kind: z.enum(['rect', 'ellipse']), rect: RectSchema, filled: z.boolean() }),
  z.object({
    ...base,
    kind: z.literal('text'),
    at: PointSchema,
    text: z.string(),
    bold: z.boolean()
  }),
  z.object({ ...base, kind: z.literal('counter'), at: PointSchema }),
  /** size = block size in image pixels. */
  z.object({ ...base, kind: z.literal('pixelate'), rect: RectSchema }),
  z.object({ ...base, kind: z.literal('redact'), rect: RectSchema })
])

export type Point = z.infer<typeof PointSchema>
export type Shape = z.infer<typeof ShapeSchema>
export type ShapeKind = Shape['kind']
export type ShapeOf<K extends ShapeKind> = Extract<Shape, { kind: K }>

export const SnapDocSchema = z.object({
  version: z.literal(1),
  /** File name without `.png`; also the sidecar folder name. */
  id: z.string(),
  file: z.string(),
  createdAt: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Stored, not applied, so it can be changed or undone later. */
  crop: RectSchema.optional(),
  shapes: z.array(ShapeSchema)
})

export type SnapDoc = z.infer<typeof SnapDocSchema>

export type SnapEntry = Pick<SnapDoc, 'id' | 'file' | 'createdAt' | 'width' | 'height'>

export type SnapMode = 'region' | 'full'
/** What the user asked for from the region overlay. */
export type SnapAction = 'edit' | 'copy' | 'save'
