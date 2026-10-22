import { test, expect } from 'vitest'
import { parseMarkdown, inline } from '../../src/renderer/src/listen/markdown'

test('headings, paragraphs, bullets and task items group into blocks', () => {
  const md =
    '## Summary\nShipped it.\nAll good.\n\n## Action items\n- [ ] Send deck — Asha (Fri)\n- [x] Book room\n- plain point'
  expect(parseMarkdown(md)).toEqual([
    { kind: 'heading', text: 'Summary' },
    { kind: 'paragraph', text: 'Shipped it. All good.' },
    { kind: 'heading', text: 'Action items' },
    {
      kind: 'list',
      items: [
        { task: true, done: false, text: 'Send deck — Asha (Fri)' },
        { task: true, done: true, text: 'Book room' },
        { task: false, done: false, text: 'plain point' }
      ]
    }
  ])
})

test('# and ### are headings too; * bullets work', () => {
  expect(parseMarkdown('# A\n### B\n* c')).toEqual([
    { kind: 'heading', text: 'A' },
    { kind: 'heading', text: 'B' },
    { kind: 'list', items: [{ task: false, done: false, text: 'c' }] }
  ])
})

test('inline bold is split out; anything else stays plain text (no HTML)', () => {
  expect(inline('a **b** <img src=x>')).toEqual([
    { bold: false, text: 'a ' },
    { bold: true, text: 'b' },
    { bold: false, text: ' <img src=x>' }
  ])
})
