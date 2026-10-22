import { test, expect } from 'vitest'
import { buildSuggestPrompt, parseSuggestions } from '../../src/main/ai/suggest'

const words = ['So', 'today', 'I', 'will', 'so', 'today', 'I', 'will', 'show', 'you'].map((text, i) => ({
  text,
  startMs: i * 300,
  endMs: i * 300 + 250
}))

test('the prompt lists every word with its index and asks for JSON cuts only', () => {
  const { system, user } = buildSuggestPrompt(words, {})
  expect(user).toContain('0:So 1:today 2:I 3:will 4:so')
  expect(system).toMatch(/retake/i)
  expect(system).toContain('{"cuts":[{"from":')
  expect(system).not.toMatch(/target/i)
})

test('a target length is passed on when given', () => {
  expect(buildSuggestPrompt(words, { targetSeconds: 90 }).system).toMatch(/about 90 seconds/)
})

test('parseSuggestions accepts fenced JSON', () => {
  const raw = '```json\n{"cuts":[{"from":0,"to":3,"reason":"Retake of the opening"}]}\n```'
  expect(parseSuggestions(raw, words.length)).toEqual({ cuts: [{ from: 0, to: 3, reason: 'Retake of the opening' }], dropped: 0 })
})

test('drops out-of-range, reversed and overlapping items and counts them', () => {
  const raw = JSON.stringify({
    cuts: [
      { from: 0, to: 3, reason: 'a' },
      { from: 2, to: 4, reason: 'overlaps a' },
      { from: 6, to: 5, reason: 'reversed' },
      { from: 8, to: 40, reason: 'out of range' },
      { from: 'x', to: 2, reason: 'not a number' },
      { from: 8, to: 9 }
    ]
  })
  expect(parseSuggestions(raw, words.length)).toEqual({
    cuts: [
      { from: 0, to: 3, reason: 'a' },
      { from: 8, to: 9, reason: '' }
    ],
    dropped: 4
  })
})

test('items are returned in transcript order', () => {
  const raw = JSON.stringify({ cuts: [{ from: 8, to: 9, reason: 'b' }, { from: 0, to: 1, reason: 'a' }] })
  expect(parseSuggestions(raw, words.length).cuts.map((c) => c.from)).toEqual([0, 8])
})

test('non-JSON gives zero cuts and an error', () => {
  expect(parseSuggestions('I think you should cut the intro.', words.length)).toEqual({
    cuts: [],
    dropped: 0,
    error: 'The AI reply could not be read. Try again.'
  })
})
