/** `mm:ss.t` (tenths), e.g. 00:03.1. */
export const clock = (ms: number): string => {
  const tenths = Math.floor(Math.max(0, ms) / 100)
  const s = Math.floor(tenths / 10)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`
}
