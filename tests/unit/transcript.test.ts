import { describe, test, expect } from 'vitest'
import { cutRange, type EditDoc } from '../../src/shared/edit'
import {
  fillerRanges,
  flaggedPhrases,
  isFiller,
  parseSilences,
  toTrackTime,
  wordAtSource,
  wordState,
  type Word
} from '../../src/shared/transcript'

const w = (text: string, startMs: number, endMs: number): Word => ({ text, startMs, endMs })
const words: Word[] = [
  w('Hello', 0, 400),
  w('Um,', 400, 700),
  w('uh', 700, 900),
  w('you', 900, 1100),
  w('Know,', 1100, 1300),
  w('the', 1300, 1500),
  w('umbrella.', 1500, 2000)
]
const doc = (clips: [number, number][]): EditDoc => ({
  version: 1,
  clips: clips.map(([s, e], i) => ({ id: `c${i}`, srcStartMs: s, srcEndMs: e })),
  overlays: [],
  camera: null,
  gains: { mic: 1, system: 1 },
  muted: { mic: false, system: false }
})

describe('fillers', () => {
  test('isFiller matches "Um," "UH." "hmm" but not "umbrella"', () => {
    expect(isFiller('Um,')).toBe(true)
    expect(isFiller('UH.')).toBe(true)
    expect(isFiller('hmm')).toBe(true)
    expect(isFiller('umbrella.')).toBe(false)
    expect(isFiller('the')).toBe(false)
  })

  test('fillerRanges merges "um uh" into one range', () => {
    expect(fillerRanges(words)).toEqual([{ startMs: 400, endMs: 900 }])
  })

  test('flaggedPhrases finds "you know" case-insensitively', () => {
    expect(flaggedPhrases(words)).toEqual([3])
  })
})

describe('silences', () => {
  const stderr = [
    '[silencedetect @ 000001] silence_start: 4.88',
    '[silencedetect @ 000001] silence_end: 7.76 | silence_duration: 2.88',
    '[silencedetect @ 000001] silence_start: 9.1',
    '[silencedetect @ 000001] silence_end: 9.5 | silence_duration: 0.4'
  ].join('\n')

  test('parseSilences reads silence_start/silence_end pairs and pads them', () => {
    expect(parseSilences(stderr)[0]).toEqual({ startMs: 5130, endMs: 7510 })
  })

  test('parseSilences drops silences shorter than twice the padding', () => {
    expect(parseSilences(stderr)).toHaveLength(1)
  })

  test('a silence still open at the end of the file runs to the given end', () => {
    expect(parseSilences('silence_start: 2\n', 250, 5000)).toEqual([{ startMs: 2250, endMs: 4750 }])
  })
})

describe('words against an edit', () => {
  test('wordState: kept, cut after cutRange, partial when a cut edge falls inside the word', () => {
    const e = cutRange(doc([[0, 2000]]), 1200, 1500)
    expect(wordState(e, words[0])).toBe('kept')
    expect(wordState(e, words[5])).toBe('cut')
    expect(wordState(e, words[4])).toBe('partial')
  })

  test('wordAtSource finds the word under a source time, or -1', () => {
    expect(wordAtSource(words, 1000)).toBe(3)
    expect(wordAtSource(words, 5000)).toBe(-1)
  })

  test('toTrackTime shifts track-local word times onto the source timeline', () => {
    expect(toTrackTime([w('hi', 0, 300)], 120)).toEqual([w('hi', 120, 420)])
  })
})
