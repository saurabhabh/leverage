const PREFERENCES = {
  video: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
  audio: ['audio/webm;codecs=opus', 'audio/webm']
} as const

/** First supported container/codec; '' lets MediaRecorder pick its default. */
export function pickMimeType(kind: 'video' | 'audio', isSupported: (mime: string) => boolean): string {
  return PREFERENCES[kind].find((m) => isSupported(m)) ?? ''
}
