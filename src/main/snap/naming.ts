const pad = (n: number): string => String(n).padStart(2, '0')

/** `2026-10-22_14-05-09` — seconds included so a burst of shots rarely needs a suffix. */
export function snapBaseName(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  )
}

/** Candidate ids in order: `base`, `base (2)`, `base (3)`, … */
export function* snapIdCandidates(base: string): Generator<string> {
  yield base
  for (let n = 2; ; n++) yield `${base} (${n})`
}
