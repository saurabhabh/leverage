import { test, expect } from 'vitest'
import { drawShape, renderDoc, textFont } from '../../src/renderer/src/snap/draw'
import type { Shape, SnapDoc } from '../../src/shared/snap'

/** Records every method call and property assignment, in order. */
function fakeCtx(width = 100, height = 100): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = []
  const target: Record<string, unknown> = {
    canvas: { width, height },
    measureText: (t: string) => ({ width: t.length * 10 }),
    getImageData: (x: number, y: number, w: number, h: number) => {
      log.push(`getImageData(${x},${y},${w},${h})`)
      return { data: new Uint8ClampedArray(w * h * 4).fill(200), width: w, height: h }
    },
    putImageData: (img: ImageData, x: number, y: number) =>
      log.push(`putImageData(${img.width}x${img.height},${x},${y})`)
  }
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop]
      return (...args: unknown[]) =>
        log.push(`${prop}(${args.map((a) => JSON.stringify(a)).join(',')})`)
    },
    set(t, prop: string, value) {
      log.push(`${prop}=${JSON.stringify(value)}`)
      t[prop] = value
      return true
    }
  }) as unknown as CanvasRenderingContext2D
  return { ctx, log }
}

// jsdom-free stand-in for ImageData.
;(globalThis as Record<string, unknown>).ImageData ??= class {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number
  ) {}
}

const red = { color: '#ff0000' }

test('arrow strokes the shaft and fills a head whose tip is the end point', () => {
  const { ctx, log } = fakeCtx()
  drawShape(ctx, {
    id: 'a',
    kind: 'arrow',
    ...red,
    size: 3,
    a: { x: 0, y: 0 },
    b: { x: 200, y: 0 }
  })
  expect(log).toContain('strokeStyle="#ff0000"')
  expect(log).toContain('fillStyle="#ff0000"')
  expect(log).toContain('lineWidth=3')
  expect(log).toContain('lineTo(200,0)')
  expect(log.some((l) => l.startsWith('fill('))).toBe(true)
})

test('highlighter multiplies at 35 % and restores the context', () => {
  const { ctx, log } = fakeCtx()
  drawShape(ctx, {
    id: 'm',
    kind: 'marker',
    color: '#ffff00',
    size: 5,
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 0 }
    ]
  })
  expect(log).toContain('globalCompositeOperation="multiply"')
  expect(log).toContain('globalAlpha=0.35')
  expect(log).toContain('lineWidth=19')
  expect(log.indexOf('save()')).toBeLessThan(log.indexOf('restore()'))
})

test('filled vs outlined rectangles, normalised', () => {
  const r = { x: 50, y: 50, width: -20, height: 10 }
  const filled = fakeCtx()
  drawShape(filled.ctx, { id: 'r', kind: 'rect', ...red, size: 2, rect: r, filled: true })
  expect(filled.log).toContain('fillRect(30,50,20,10)')
  const outlined = fakeCtx()
  drawShape(outlined.ctx, { id: 'r', kind: 'rect', ...red, size: 2, rect: r, filled: false })
  expect(outlined.log).toContain('strokeRect(30,50,20,10)')
})

test('redact paints a solid box', () => {
  const { ctx, log } = fakeCtx()
  drawShape(ctx, {
    id: 'x',
    kind: 'redact',
    color: '#000000',
    size: 1,
    rect: { x: 1, y: 2, width: 3, height: 4 }
  })
  expect(log).toContain('fillStyle="#000000"')
  expect(log).toContain('fillRect(1,2,3,4)')
})

test('counter draws its step number', () => {
  const { ctx, log } = fakeCtx()
  drawShape(ctx, { id: 'c', kind: 'counter', ...red, size: 3, at: { x: 40, y: 40 } }, { number: 7 })
  expect(log.some((l) => l.startsWith('arc(40,40,16'))).toBe(true)
  expect(log.some((l) => l.startsWith('fillText("7",40,40'))).toBe(true)
})

test('text uses a bold font when asked and draws each line', () => {
  expect(textFont(20, true)).toMatch(/^bold 20px /)
  const { ctx, log } = fakeCtx()
  drawShape(ctx, {
    id: 't',
    kind: 'text',
    ...red,
    size: 20,
    at: { x: 5, y: 6 },
    text: 'one\ntwo',
    bold: false
  })
  expect(log).toContain(`font=${JSON.stringify(textFont(20, false))}`)
  expect(log).toContain('fillText("one",5,6)')
  expect(log).toContain('fillText("two",5,31)')
})

test('pixelate reads the area plus a 1-px fringe, clamped to the canvas, and writes only the area', () => {
  const { ctx, log } = fakeCtx(100, 100)
  drawShape(ctx, {
    id: 'p',
    kind: 'pixelate',
    ...red,
    size: 8,
    rect: { x: 0, y: 10, width: 30, height: 20 }
  })
  expect(log).toContain('getImageData(0,9,31,22)')
  expect(log).toContain('putImageData(30x20,0,10)')
})

test('renderDoc draws the original then each shape in order, numbering counters', () => {
  const { ctx, log } = fakeCtx()
  const c = (id: string): Shape => ({ id, kind: 'counter', ...red, size: 3, at: { x: 0, y: 0 } })
  const doc: SnapDoc = {
    version: 1,
    id: 's',
    file: 's.png',
    createdAt: '',
    width: 100,
    height: 100,
    shapes: [c('a'), c('b')]
  }
  renderDoc(ctx, doc, 'IMG' as unknown as CanvasImageSource)
  expect(log[0]).toBe('clearRect(0,0,100,100)')
  expect(log[1]).toBe('drawImage("IMG",0,0)')
  const texts = log.filter((l) => l.startsWith('fillText('))
  expect(texts.map((t) => t.split(',')[0])).toEqual(['fillText("1"', 'fillText("2"'])
})
