import { test, expect } from 'vitest'
import { addWindow, gateDecision, newGate, windowLevels } from '../../src/shared/speechGate'

const feed = (windows: [number, number][]): ReturnType<typeof gateDecision> => {
  const g = newGate()
  for (const [rms, peak] of windows) addWindow(g, rms, peak)
  return gateDecision(g)
}

test('nothing measured → not skipped (cannot tell)', () => {
  expect(gateDecision(newGate())).toMatchObject({ skip: false, reason: 'unavailable' })
})

test('room silence is skipped', () => {
  expect(feed(Array(30).fill([0.001, 0.004]))).toMatchObject({ skip: true, reason: 'silence' })
})

test('a lone click (high peak, tiny energy) is not speech', () => {
  expect(feed([...Array(20).fill([0.0015, 0.003]), [0.0025, 0.3]])).toMatchObject({
    skip: true,
    reason: 'insufficient_speech'
  })
})

test('quiet but real speech passes', () => {
  expect(feed([...Array(10).fill([0.001, 0.003]), [0.004, 0.05], [0.005, 0.06]])).toMatchObject({
    skip: false
  })
})

test('a strong window alone counts as speech', () => {
  expect(feed([[0.007, 0.01]])).toMatchObject({ skip: false, reason: 'speech_detected' })
})

test('windowLevels measures RMS and peak of float samples', () => {
  const { rms, peak } = windowLevels(Float32Array.from([0.5, -0.5, 0.5, -0.5]))
  expect(rms).toBeCloseTo(0.5)
  expect(peak).toBeCloseTo(0.5)
})
