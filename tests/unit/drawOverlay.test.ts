import { test, expect } from 'vitest'
import { drawOverlay } from '../../src/renderer/src/editor/drawOverlay'
import type { CalloutOverlay, LowerThird } from '../../src/shared/edit'

/** Records every method call and property assignment, in order. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = []
  const target: Record<string, unknown> = {
    measureText: (t: string) => ({ width: t.length * 10 })
  }
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop]
      return (...args: unknown[]) => log.push(`${prop}(${args.map((a) => JSON.stringify(a)).join(',')})`)
    },
    set(t, prop: string, value) {
      log.push(`${prop}=${JSON.stringify(value)}`)
      t[prop] = value
      return true
    }
  }) as unknown as CanvasRenderingContext2D
  return { ctx, log }
}

const frame = { width: 1920, height: 1080 }
const base = { id: 'o', srcStartMs: 0, srcEndMs: 1000, text: '', color: '#00ff00' }

test('arrow draws a line and a filled head in its colour', () => {
  const { ctx, log } = fakeCtx()
  drawOverlay(ctx, { ...base, kind: 'arrow', rect: { x: 100, y: 100, width: 300, height: 0 } } as CalloutOverlay, frame)
  expect(log).toContain('strokeStyle="#00ff00"')
  expect(log).toContain('fillStyle="#00ff00"')
  expect(log).toContain('lineWidth=8')
  expect(log.some((l) => l.startsWith('stroke('))).toBe(true)
  expect(log.some((l) => l.startsWith('fill('))).toBe(true)
  // The head's tip is exactly at the arrow's end point.
  expect(log).toContain('lineTo(400,100)')
})

test('box strokes a rounded rect at the rect, normalising negative sizes', () => {
  const { ctx, log } = fakeCtx()
  drawOverlay(ctx, { ...base, kind: 'box', rect: { x: 500, y: 400, width: -200, height: -100 } } as CalloutOverlay, frame)
  expect(log).toContain('roundRect(300,300,200,100,8)')
  expect(log.some((l) => l.startsWith('stroke('))).toBe(true)
})

test('text draws its background before the text, at the rect top-left', () => {
  const { ctx, log } = fakeCtx()
  drawOverlay(ctx, { ...base, kind: 'text', text: 'Hi', rect: { x: 50, y: 60, width: 0, height: 0 } } as CalloutOverlay, frame)
  const bg = log.findIndex((l) => l.startsWith('fillRect(50,60,'))
  const text = log.findIndex((l) => l.startsWith('fillText("Hi"'))
  expect(bg).toBeGreaterThan(-1)
  expect(text).toBeGreaterThan(bg)
  expect(log).toContain('font="bold 45px Segoe UI, sans-serif"')
})

test('lower third scales with frame height and draws title and subtitle', () => {
  const lt: LowerThird = { id: 'l', kind: 'lowerThird', srcStartMs: 0, srcEndMs: 1, title: 'Saurabh', subtitle: 'Founder' }
  const { ctx, log } = fakeCtx()
  drawOverlay(ctx, lt, frame)
  expect(log).toContain('font="bold 49px Segoe UI, sans-serif"')
  expect(log).toContain('font="32px Segoe UI, sans-serif"')
  expect(log.some((l) => l.startsWith('fillText("Saurabh"'))).toBe(true)
  expect(log.some((l) => l.startsWith('fillText("Founder"'))).toBe(true)
  const small = fakeCtx()
  drawOverlay(small.ctx, lt, { width: 960, height: 540 })
  expect(small.log).toContain('font="bold 25px Segoe UI, sans-serif"')
})
