import type { RecorderDeps, RecorderLike, StreamLike, TrackLike } from './recorder'

/** Real browser implementations of the recorder's dependencies. */
export function browserDeps(): RecorderDeps {
  return {
    api: window.leverage,
    now: () => performance.now(),
    getDisplayMedia: async (c) =>
      (await navigator.mediaDevices.getDisplayMedia(c as DisplayMediaStreamOptions)) as unknown as StreamLike,
    getUserMedia: async (c) =>
      (await navigator.mediaDevices.getUserMedia(c as MediaStreamConstraints)) as unknown as StreamLike,
    makeStream: (tracks: TrackLike[]) => new MediaStream(tracks as unknown as MediaStreamTrack[]) as unknown as StreamLike,
    createRecorder: (stream, mime, bitsPerSecond) =>
      new MediaRecorder(stream as unknown as MediaStream, {
        ...(mime ? { mimeType: mime } : {}),
        bitsPerSecond
      }) as unknown as RecorderLike,
    isTypeSupported: (mime) => MediaRecorder.isTypeSupported(mime)
  }
}
