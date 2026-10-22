/**
 * Was anything said? Measured per short window while recording; a recording judged silent is never
 * sent to Whisper, which otherwise invents text ("Thank you.") for silence. Thresholds are
 * OpenWhispr's (localSpeechGate.js), on samples in −1…1.
 */
const SILENCE_RMS = 0.002
const SPEECH_RMS = 0.003
const SPEECH_PEAK = 0.02
const STRONG_RMS = 0.006

export type Gate = { windows: number; speechWindows: number; peakRms: number }
export type GateDecision = {
  skip: boolean
  reason: 'unavailable' | 'silence' | 'insufficient_speech' | 'speech_detected'
}

export const newGate = (): Gate => ({ windows: 0, speechWindows: 0, peakRms: 0 })

export function addWindow(g: Gate, rms: number, peak: number): Gate {
  g.windows += 1
  g.peakRms = Math.max(g.peakRms, rms)
  if (rms >= SPEECH_RMS && peak >= SPEECH_PEAK) g.speechWindows += 1
  return g
}

export function gateDecision(g: Gate): GateDecision {
  if (!g.windows) return { skip: false, reason: 'unavailable' }
  if (g.peakRms < SILENCE_RMS) return { skip: true, reason: 'silence' }
  if (g.speechWindows === 0 && g.peakRms < STRONG_RMS)
    return { skip: true, reason: 'insufficient_speech' }
  return { skip: false, reason: 'speech_detected' }
}

export function windowLevels(samples: Float32Array): { rms: number; peak: number } {
  let sum = 0
  let peak = 0
  for (const s of samples) {
    sum += s * s
    peak = Math.max(peak, Math.abs(s))
  }
  return { rms: samples.length ? Math.sqrt(sum / samples.length) : 0, peak }
}
