import type { Rect, Size } from '../../shared/types'

/**
 * Map a selection in global DIP onto one display's captured image. Rounds outward so every pixel the
 * selection touches is kept, and clamps to the image (never empty).
 */
export function dipToImageRect(rectDip: Rect, displayBoundsDip: Rect, image: Size): Rect {
  const sx = image.width / displayBoundsDip.width
  const sy = image.height / displayBoundsDip.height
  const left = Math.min(
    Math.max(0, Math.floor((rectDip.x - displayBoundsDip.x) * sx)),
    image.width - 1
  )
  const top = Math.min(
    Math.max(0, Math.floor((rectDip.y - displayBoundsDip.y) * sy)),
    image.height - 1
  )
  const right = Math.min(
    image.width,
    Math.ceil((rectDip.x - displayBoundsDip.x + rectDip.width) * sx)
  )
  const bottom = Math.min(
    image.height,
    Math.ceil((rectDip.y - displayBoundsDip.y + rectDip.height) * sy)
  )
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

/**
 * Pair each display with its screen source. Windows reports `display_id`; some Linux setups leave it
 * empty, so fall back to order when the counts match.
 */
export function matchSources<S extends { display_id: string }>(
  displays: { id: number }[],
  sources: S[]
): (S | null)[] {
  const byId = displays.map((d) => sources.find((s) => s.display_id === String(d.id)) ?? null)
  if (
    byId.every((s) => s === null) &&
    sources.length === displays.length &&
    sources.every((s) => !s.display_id)
  ) {
    return [...sources]
  }
  return byId
}
