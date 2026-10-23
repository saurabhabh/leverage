/** How long a meeting's claim waits for its getDisplayMedia() request before it lapses. */
const MEETING_CLAIM_MS = 10_000

export type RequestChoice = { kind: 'studio'; sourceId: string | null } | { kind: 'meeting' }

/**
 * Which source answers a getDisplayMedia() request. Studio picks a screen or window and keeps it
 * (its no-system-audio fallback asks again); a meeting only wants the PC's sound, so it claims the
 * next audio request once instead of overwriting Studio's pick.
 */
export function createCaptureChoice(now: () => number = Date.now): {
  selectStudio(sourceId: string): void
  armMeeting(): void
  forRequest(audioRequested: boolean): RequestChoice
} {
  let studio: string | null = null
  let meetingUntil = -1
  return {
    selectStudio(sourceId) {
      studio = sourceId
    },
    armMeeting() {
      meetingUntil = now() + MEETING_CLAIM_MS
    },
    forRequest(audioRequested) {
      if (audioRequested && now() <= meetingUntil) {
        meetingUntil = -1
        return { kind: 'meeting' }
      }
      return { kind: 'studio', sourceId: studio }
    }
  }
}

/** The primary display's screen source, else the first screen; never a window. */
export function primaryScreenId(
  sources: { id: string; display_id: string }[],
  primaryDisplayId: number
): string | null {
  const screens = sources.filter((s) => s.id.startsWith('screen:'))
  return (screens.find((s) => s.display_id === String(primaryDisplayId)) ?? screens[0])?.id ?? null
}
