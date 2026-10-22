# Leverage Studio — Plan B: Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open any recording from the Library in an editor that previews all tracks in sync. In the editor, Saurabh can split, delete, cut a range and reorder clips, add blur, callouts (arrow, box, text) and lower-thirds, move, resize or hide the camera circle, and set mic and system-audio levels. The edited version exports as MP4 or GIF.

**Architecture:**
- **Edit model.** Edits are non-destructive. An `edit.json` sits next to `recording.json` and holds:
  - the ordered clips, as ranges of the *source timeline*;
  - overlays anchored to source time, so cuts and moves carry them along;
  - camera placement and audio gains.
- **Pure core.** All timeline maths and edit operations live in one pure module, `src/shared/edit.ts`, so they can be unit tested.
- **Preview.** A playback controller drives one `<video>` or `<audio>` element per track along the clip list. Overlays are drawn on a canvas layered over the preview, using the same drawing code that renders them for export.
- **Export.** The renderer rasterizes each callout and lower-third to a PNG, and main writes it into the recording folder. A pure ffmpeg-args builder then aligns the tracks, trims and concatenates the clips, applies blur and the PNG overlays at their output times, composites the camera and mixes the audio.

**Tech Stack:** Same as Plan A (Electron 44, React 19, TypeScript, zod, vitest, Playwright, ffmpeg-static). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-22-leverage-design.md` (the Studio "Edit" section). It builds on Plan A, `docs/superpowers/plans/2026-10-22-studio-a-recorder.md`.

**Out of scope (Plan C):** transcript-based editing, silence/filler removal, AI-suggested cuts, local Whisper. The edit model must leave room for them, because Plan C only adds new ways of producing clip lists.

## Global Constraints

- **Source timeline.** All times are integer milliseconds on the **source timeline**: 0 = the earliest track's start, and every track is aligned by its `offsetMs` relative to the earliest one (the same rule as Plan A export).
- **Never modify recorded files.** Edits live only in `edit.json`, which is written temp+rename. A missing, corrupt or old-version `edit.json` → the default edit (one clip covering the whole recording) and never blocks opening.
- **Minimum clip length:** 100 ms. Operations that would create a shorter clip are no-ops.
- **Undo/redo:** at least 100 steps; `Ctrl+Z` / `Ctrl+Y` (and `Ctrl+Shift+Z`).
- **Editor shortcuts:**
  - `Space` play/pause
  - `S` split at playhead
  - `Delete` delete selected clip or overlay
  - `I` / `O` mark in / out
  - `X` cut marked range
  - `←` / `→` step 1 s
- **Export:** same codecs and naming rules as Plan A (H.264 CRF 23 veryfast, AAC 192k, never overwrite). The exported edit plays exactly the clips in order, with overlays only where their source range survives.
- **Camera mask:** a precomputed circular mask PNG combined with `alphamerge`. The per-pixel `geq` from Plan A goes; it was too slow (deferred minor from Plan A).
- **Paths:** all overlay PNGs live in `<recording>/overlays/<overlayId>.png`.
- **Renderer security** is unchanged: no Node in renderers, and everything goes through the typed preload API.

## Review Focus

1. **Cutting until nothing is left, or splitting exactly on a clip edge.** At least one clip always remains, and a split at an edge is a no-op. *(Tests in Task 1.)*
2. **An overlay whose source range is entirely cut out, or only partly.** It is skipped, or trimmed to the surviving parts, in both preview and export, and is never an ffmpeg error. *(Tests in Tasks 1 and 7.)*
3. **A recording without camera, mic or system audio, or an "incomplete" one.** The editor opens and the missing lanes are hidden. *(Tests in Tasks 3 and 7.)*
4. **A long recording (30+ min).** The timeline zooms (fit / 1 s per 10 px … 1 min per 10 px), and the export filtergraph stays linear in the number of clips. *(Test in Task 7: 50 clips.)*
5. **A corrupt or hand-edited `edit.json`** (bad JSON, clips out of range, negative times). It is repaired or reset to the default with a visible notice, never a crash. *(Test in Task 2.)*

## File Structure

```
src/shared/edit.ts                 EditDoc schema, defaultEdit, pure ops, timeline maths
src/shared/history.ts              generic undo/redo stack
src/renderer/src/editor/drawOverlay.ts   canvas drawing for callouts + lower-thirds (preview AND export PNGs)
src/renderer/src/editor/player.ts  PlaybackController (multi-element sync along clips)
src/renderer/src/editor/Editor.tsx       page: preview + transport + timeline + inspector
src/renderer/src/editor/Preview.tsx      video stack + overlay canvas + direct manipulation (blur/callout rects, camera circle)
src/renderer/src/editor/Timeline.tsx     ruler, clip strip, overlay lanes, audio lanes, zoom
src/renderer/src/editor/Inspector.tsx    properties of the selected clip/overlay; camera + audio controls
src/renderer/src/editor/editor.css
src/main/edit/store.ts             loadEdit / saveEdit (+ overlay PNG writes)
src/main/edit/ipc.ts               edit:* channels
src/main/media/editExportArgs.ts   buildEditedMp4Args / buildEditedGifArgs (pure)
src/main/media/mask.ts             ensureCircleMask(dir, size) → PNG path (ffmpeg-generated, cached)
tests/unit/edit.test.ts, history.test.ts, player.test.ts, drawOverlay.test.ts, editExportArgs.test.ts, editExportReal.test.ts
tests/e2e/editor.spec.ts
```

---

### Task 1: Edit model and timeline maths

**Files:**
- Create: `src/shared/edit.ts`, `src/shared/history.ts`
- Test: `tests/unit/edit.test.ts`, `tests/unit/history.test.ts`

**Interfaces:**
- **Produces types:**
  - `Clip = { id: string; srcStartMs: number; srcEndMs: number }`
  - `BlurOverlay = { id: string; kind: 'blur'; srcStartMs: number; srcEndMs: number; rect: Rect; strength: number }`. `rect` is in output-frame px; `strength` 1–20, default 10.
  - `CalloutOverlay = { id: string; kind: 'arrow' | 'box' | 'text'; srcStartMs: number; srcEndMs: number; rect: Rect; text: string; color: string }`.
    - For arrows, `rect` is spanned from tail (x,y) to head (x+w, y+h), so w and h may be negative.
    - `color` defaults to `#ff3b30`.
  - `LowerThird = { id: string; kind: 'lowerThird'; srcStartMs: number; srcEndMs: number; title: string; subtitle: string }`
  - `Overlay = BlurOverlay | CalloutOverlay | LowerThird`
  - `CameraSettings = { visible: boolean; x: number; y: number; size: number }`, in output-frame px.
  - `EditDoc = { version: 1; clips: Clip[]; overlays: Overlay[]; camera: CameraSettings | null; gains: { mic: number; system: number }; muted: { mic: boolean; system: boolean } }`
  - `EditDocSchema` (zod).
- **Produces functions:**
  - `sourceDurationMs(m: RecordingManifest): number`: the latest track end on the source timeline. Track durations come from `m.durationMs` plus each track's relative offset. If `durationMs` is 0, the caller passes a probed duration (see Task 2).
  - `defaultEdit(m: RecordingManifest, sourceMs: number, frame: Size, camera: { x; y; size } | null): EditDoc`. One clip `[0, sourceMs]`. Gains are 1, nothing is muted, and the camera is `visible: true` at the given box (or null without a camera track).
  - `outputDurationMs(e: EditDoc): number`
  - `outputToSource(e: EditDoc, outMs: number): { clipIndex: number; srcMs: number }`. `outMs` is clamped to `[0, outputDuration]`; at the very end it returns the last clip's end.
  - `sourceToOutput(e: EditDoc, srcStartMs: number, srcEndMs: number): { outStartMs: number; outEndMs: number }[]`. Every output interval where that source range plays, in output order. A range spanning two clips gives two intervals; a range that is cut out gives `[]`.
  - `splitAt(e: EditDoc, outMs: number): EditDoc`. A no-op within 100 ms of a clip edge.
  - `deleteClip(e: EditDoc, clipId: string): EditDoc`. A no-op if it is the last remaining clip.
  - `cutRange(e: EditDoc, outStartMs: number, outEndMs: number): EditDoc`. Removes that output range across clips and keeps at least one clip of ≥100 ms. If the range covers everything, it is a no-op.
  - `moveClip(e: EditDoc, clipId: string, toIndex: number): EditDoc`
  - `addOverlay(e: EditDoc, o: Overlay): EditDoc`, `updateOverlay(e: EditDoc, id: string, patch: Partial<Overlay>): EditDoc`, `removeOverlay(e: EditDoc, id: string): EditDoc`
  - `setCamera(e: EditDoc, patch: Partial<CameraSettings>): EditDoc`, `setGain(e: EditDoc, track: 'mic' | 'system', gain: number /* 0–4 */): EditDoc`, `setMuted(e: EditDoc, track: 'mic' | 'system', muted: boolean): EditDoc`
  - `repairEdit(raw: unknown, sourceMs: number, fallback: EditDoc): { edit: EditDoc; repaired: boolean }`. It clamps clips into `[0, sourceMs]`, drops clips shorter than 100 ms and overlays with end ≤ start, and falls back if no clip survives or the schema fails.
  - `newId(): string` (crypto.randomUUID).
  - `class History<T> { constructor(initial: T, limit = 100); get present(): T; push(next: T): void; undo(): T; redo(): T; canUndo; canRedo }`. `push` with an identical reference is a no-op; push clears the redo stack.

- [ ] **Step 1: Write failing tests** (`edit.test.ts`). The fixture is clips `A[0,10000]`; then split at 4000 → `A[0,4000] B[4000,10000]`.
  - `outputDurationMs sums clip lengths`
  - `outputToSource maps across a reordered clip list`: clips `[5000,8000],[0,2000]` → `outputToSource(3500)` = `{ clipIndex: 1, srcMs: 500 }`.
  - `splitAt in the middle creates two clips covering the same source`
  - `splitAt within 100 ms of an edge is a no-op`
  - `deleteClip removes it and later clips shift earlier in output time`
  - `deleteClip on the last remaining clip is a no-op`
  - `cutRange across two clips trims both`: clips `[0,4000],[4000,10000]`, cut output `[3000,5000]` → `[0,3000],[5000,10000]`.
  - `cutRange of the whole output is a no-op`
  - `moveClip reorders`
  - `sourceToOutput: range inside one clip → one interval`, `spanning a cut → two intervals`, `fully cut → []`, `after reorder follows the content`.
  - `repairEdit clamps out-of-range clips, drops zero-length ones, falls back on garbage`.
  - `history.test.ts`:
    - `undo/redo round-trips`
    - `push after undo clears redo`
    - `limit drops oldest`
- [ ] **Step 2:** `npx vitest run tests/unit/edit.test.ts tests/unit/history.test.ts` → FAIL (modules missing).
- [ ] **Step 3:** Implement. All ops return new objects and never mutate their input.
- [ ] **Step 4:** Same command → PASS; `npm test` → all green.
- [ ] **Step 5:** Commit `feat: non-destructive edit model and timeline maths`.

### Task 2: Edit persistence and opening the editor

**Files:**
- Create: `src/main/edit/store.ts`, `src/main/edit/ipc.ts`
- Modify:
  - `src/shared/ipc.ts`: add the channels below.
  - `src/main/index.ts`: register.
  - `src/renderer/src/library/Library.tsx`: add an **Edit** button.
  - `src/renderer/src/App.tsx`: add an editor route. It is a full-page view with a back button and is not in the nav.
- Test: `tests/unit/editStore.test.ts`, `tests/e2e/editor.spec.ts` (first test)

**Interfaces:**
- **Consumes:** `EditDoc`, `repairEdit`, `defaultEdit` (Task 1); `libraryStore().find` (Plan A); `bubbleOverlayBox`, `frameSize` (Plan A `exportArgs.ts`).
- **Produces:**
  - `loadEdit(dir: string, m: RecordingManifest, probeMs: () => Promise<number>): Promise<{ edit: EditDoc; repaired: boolean; sourceMs: number }>`
    - `sourceMs` = `m.durationMs` if it is > 0, else `probeMs()`. The probe uses ffprobe on the screen track, falling back to the longest track.
    - The default camera comes from `bubbleOverlayBox(m, frameSize(m))`.
  - `saveEdit(dir: string, e: EditDoc): Promise<void>`: temp+rename, validated by schema.
  - `writeOverlayPng(dir: string, overlayId: string, png: Uint8Array): Promise<string>`. It writes `overlays/<id>.png` (creating the folder) and returns the path.
  - IPC:
    - `edit:open(id) → { manifest, edit, repaired, sourceMs, dir }`
    - `edit:save(id, edit) → void`
    - `edit:overlayPng(id, overlayId, data: ArrayBuffer) → void`
    - `edit:mediaUrl(id, track: TrackKind) → string`. Returns a `leverage-media://<id>/<track>` URL served by a protocol handler (below). Renderers never get raw file paths.
  - **Protocol handler:**
    - `protocol.handle('leverage-media', …)` streams the track file with Range support (`net.fetch(pathToFileURL(file))` handles ranges).
    - It is registered as privileged (`stream: true, supportFetchAPI: true`) before app ready.
    - It only serves files that belong to a known recording.
    - CSP `media-src` adds `leverage-media:`.

- [ ] **Step 1: Write failing tests** (`editStore.test.ts`, temp dir, stub probe):
  - `missing edit.json → default edit, repaired false`
  - `corrupt edit.json → default edit, repaired true`
  - `durationMs 0 uses the probe`
  - `save then load round-trips`
  - `writeOverlayPng creates overlays/<id>.png`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: E2E (write first, watch it fail):** `editor.spec.ts › opens a recording from the Library in the editor`.
  - Reuse the Plan A `seedCrashedRecording` helper; move it to `tests/e2e/fixtures.ts`.
  - Click **Edit** → a heading with the recording title is visible, and a `<video>` whose `src` starts with `leverage-media://` reaches `readyState ≥ 1`.
  - Click **Back** → the Library is visible.
- [ ] **Step 6:** Implement the route, the button and the protocol until it passes. Then commit `feat: edit persistence and editor route`.

### Task 3: Playback controller and preview

**Files:**
- Create: `src/renderer/src/editor/player.ts`, `src/renderer/src/editor/Preview.tsx`, `src/renderer/src/editor/editor.css`
- Test: `tests/unit/player.test.ts`

**Interfaces:**
- **Consumes:** `EditDoc`, `outputToSource`, `outputDurationMs` (Task 1); track `offsetMs` (relative to the earliest track, same rule as Plan A `collectInputs`).
- **Produces:**
  - `type MediaLike = { currentTime: number; paused: boolean; play(): Promise<void>; pause(): void; volume: number; muted: boolean }`
  - `class PlaybackController`, constructed with `(deps: { media: Partial<Record<TrackKind, MediaLike>>; offsetsMs: Partial<Record<TrackKind, number>>; now: () => number; raf: (cb: () => void) => number; cancelRaf: (h: number) => void })`. Members:
    - `setEdit(e: EditDoc): void`
    - `play(): void` / `pause(): void` / `seek(outMs: number): void`
    - `get timeMs(): number`, which is output time
    - `onTime: ((outMs: number) => void) | null`
    - `onEnded: (() => void) | null`
  - **Rules:**
    - Each element's `currentTime` = `(srcMs - offsetMs[track]) / 1000`, clamped at 0. A track whose local time is < 0 is paused until it starts.
    - At a clip boundary, every element is seeked to the next clip's source start.
    - Drift > 150 ms against the master clock forces a re-seek.
    - Mic and system `volume` = clamp(gain, 0, 1) for preview, and `muted` follows the edit. The preview can't amplify above 1; export applies the real gain.
  - `Preview.tsx` renders:
    - the screen `<video>` with the crop applied via CSS `object-view-box`, falling back to a scaled wrapper;
    - the camera `<video>` clipped to a circle at `edit.camera`, scaled from frame px to displayed px;
    - an overlay `<canvas>` (Task 5 draws on it).

- [ ] **Step 1: Write failing tests** (`player.test.ts`, fake media and a manual clock):
  - `seek maps output time to each element through the clip list and offsets`
  - `playing across a clip boundary jumps every element to the next clip`
  - `a track with a positive offset stays paused until its start`
  - `drift over 150 ms is corrected`
  - `reaching the end pauses and fires onEnded`
  - `muted and gain are applied to mic and system elements`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Wire `Preview.tsx` into `Editor.tsx` with a transport: play/pause button, `mm:ss.s / mm:ss.s`, scrubber, and the `Space`/`←`/`→` shortcuts. Missing tracks render no element (Review Focus 3).
- [ ] **Step 6: E2E:**
  - `editor.spec.ts › play advances time and Space toggles playback`: the time text changes after 1 s of play, then is stable after Space.
  - `› recording without camera hides the camera circle`.
- [ ] **Step 7:** Commit `feat: synced multi-track preview`.

### Task 4: Timeline — clips, split, delete, cut range, reorder, zoom, undo

**Files:**
- Create: `src/renderer/src/editor/Timeline.tsx`
- Modify: `Editor.tsx`: `History<EditDoc>`, keyboard shortcuts, autosave (debounced 500 ms via `edit:save`).

**Interfaces:**
- **Consumes:** Task 1 ops and `History`; Task 3 `PlaybackController.seek/timeMs`.
- **Produces:**
  - `Timeline` props: `{ edit; sourceMs; timeMs; selection: { kind: 'clip' | 'overlay'; id } | null; mark: { inMs?: number; outMs?: number }; zoomMsPerPx: number; onSeek(outMs); onSelect(sel); onMoveClip(clipId, toIndex); onOverlayTime(id, srcStartMs, srcEndMs); onZoom(msPerPx) }`
  - **Clip strip:** each clip is a block whose width = duration / zoom, labelled `mm:ss–mm:ss` (source).
    - Click selects it.
    - Drag reorders it, via HTML5 drag-and-drop with a drop indicator.
  - **Ruler:** shows output time. Clicking it seeks; the playhead is a red line.
  - **In/out marks:** a shaded range between `I` and `O`.
  - **Zoom:** `Ctrl+wheel` and a −/fit/+ control. `fit` = timeline width / output duration; the levels go from 1 s per 10 px to 1 min per 10 px.
  - **Lanes:** the overlay lanes (Task 5) and audio lanes (Task 6) render below the clips, at the same scale.

- [ ] **Step 1: E2E (write first, watch it fail):**
  - `› S splits at the playhead into two clips`: seek to 1.0 s, press S → 2 clip blocks.
  - `› I, O, X cuts the marked range and the duration drops by it`: on the 3 s fixture, mark 1.0–2.0 s and press X → total shows `00:02.0`.
  - `› Delete removes the selected clip; the last clip cannot be deleted`.
  - `› dragging a clip reorders it`: the first block's label changes.
  - `› Ctrl+Z restores, Ctrl+Y re-applies`.
  - `› edits survive reopening`: Back, then Edit again → still 2 clips.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `npm test` green.
- [ ] **Step 5:** Commit `feat: timeline editing with undo and autosave`.

### Task 5: Overlays — blur, callouts, lower-thirds

**Files:**
- Create: `src/renderer/src/editor/drawOverlay.ts`, `src/renderer/src/editor/Inspector.tsx`
- Modify: `Preview.tsx` (drawing tools and drag/resize handles), `Timeline.tsx` (overlay lanes), `Editor.tsx` (toolbar: Blur / Arrow / Box / Text / Lower third)
- Test: `tests/unit/drawOverlay.test.ts`

**Interfaces:**
- **Consumes:** the overlay types and `add/update/removeOverlay`, `sourceToOutput` (Task 1).
- **Produces:**
  - `drawOverlay(ctx: CanvasRenderingContext2D, o: CalloutOverlay | LowerThird, frame: Size): void`. Draws in **output-frame pixels**. The preview passes a context scaled frame → display; the export uses a full-frame canvas.
    - Arrow: line width `max(4, frame.width/240)`, a filled triangular head of length 5× the width, in `color`.
    - Box: a stroked rounded rect (radius 8, same width), in `color`.
    - Text: bold `round(frame.height/24)px` Segoe UI, white text on `rgba(0,0,0,0.7)` with 0.4 em padding, `rect.x,rect.y` = top-left.
    - Lower third: a bar at the bottom-left, at a 5 % margin of frame height and 45 % of frame width. Accent strip 6 px `#ff3b30`. Title is bold at `frame.height/22`, subtitle regular at `frame.height/34`, background `rgba(20,20,22,0.85)`.
  - `renderOverlayPng(o, frame): Promise<Uint8Array>`: an OffscreenCanvas of `frame` size, transparent, with `drawOverlay`, encoded with `convertToBlob({ type: 'image/png' })`.
  - `blurPreviewStyle(o: BlurOverlay, scale: number): React.CSSProperties`: an absolutely positioned div with `backdrop-filter: blur(<strength>px)` at the scaled rect.
  - New overlays:
    - They span the source time at the playhead + 3 s, clamped to the clip.
    - They are created by dragging on the preview (for text, a click), and their timeline lane bars can be dragged or resized to change the source span.
    - Rects can be moved or resized on the preview while selected.
  - **Inspector:** for the selected overlay, text, colour (5 swatches), blur strength (1–20), start/end (read-only output times) and Delete.
  - **Visibility:** overlays draw only while `outputToSource(timeMs)` falls inside their source span.

- [ ] **Step 1: Write failing tests** (`drawOverlay.test.ts`, fake 2D context recording calls):
  - `arrow draws a line and a filled head in its colour`
  - `box strokes a rounded rect at the rect`
  - `text draws background then text at the rect's top-left`
  - `lower third scales with frame height`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: E2E:**
  - `› adding a blur shows it in its lane and on the preview only during its span`
  - `› a text callout is editable in the inspector`
  - `› an overlay whose span is cut out disappears from the lane` (Review Focus 2)
- [ ] **Step 6:** Implement → PASS. Commit `feat: blur, callouts and lower-thirds`.

### Task 6: Camera and audio controls

**Files:**
- Modify: `Preview.tsx` (drag and resize the camera circle; corner handle keeps it square), `Inspector.tsx` (camera visible toggle, size S/M/L presets = 12 / 20 / 30 % of frame width), `Timeline.tsx` (audio lanes: mute toggle + gain slider 0–200 % per mic/system, shown only when the track exists)

**Interfaces:**
- **Consumes:** `setCamera`, `setGain`, `setMuted` (Task 1); `PlaybackController.setEdit` (Task 3).
- **Produces:** UI only. The camera is clamped inside the frame on every change (same rule as Plan A `bubbleOverlayBox`).

- [ ] **Step 1: E2E (write first):**
  - `› dragging the camera circle moves it and the edit saves the new x,y`. Read `edit.json` on disk after autosave.
  - `› hiding the camera hides it in the preview`.
  - `› muting mic sets muted in edit.json and mutes the preview element`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: camera and audio controls in the editor`.

### Task 7: Export with edits

**Files:**
- Create: `src/main/media/editExportArgs.ts`, `src/main/media/mask.ts`
- Modify:
  - `src/main/media/exportIpc.ts`: export uses the edit when `edit.json` exists, rendering overlay PNGs first via a renderer round-trip. Main asks the main window with the event `edit:needPngs` and an id; the renderer calls `edit:overlayPng` for each callout or lower-third, then `edit:pngsReady`.
  - Editor: an **Export MP4** / **Export GIF** button with progress, reusing the Library job UI.
- Test: `tests/unit/editExportArgs.test.ts`, `tests/unit/editExportReal.test.ts` (runs ffmpeg)

**Interfaces:**
- **Consumes:** `EditDoc`, `sourceToOutput` (Task 1); Plan A `collectInputs` rules (relative offsets; video via `-itsoffset`, audio via `adelay`), `frameSize`, `cropFilter`.
- **Produces:**
  - `buildEditedMp4Args(m: RecordingManifest, e: EditDoc, dir: string, out: string, pngs: Record<string, string>, maskPath: string | null): string[]`. The filtergraph, in order:
    1. Align each input: video tracks with `-itsoffset`; audio with `adelay=<ms>:all=1`, then `aresample=async=1`.
    2. Per clip *k* and per track, trim the same source range:
       - video: `trim=start=<s>:end=<e>,setpts=PTS-STARTPTS`
       - audio: `atrim=…,asetpts=PTS-STARTPTS`
       - **A track with no data in that range** gets a black or silent filler of the clip's length. The filler is `color=black:s=WxH:d=<len>` (with format `yuva420p` and alpha 0 for the camera) or `anullsrc=r=48000:cl=stereo,atrim=duration=<len>`. This keeps every concat input the same length.
    3. `concat=n=<clips>:v=1:a=0` for screen, and the same for camera. Mic and system each use `concat=…:v=0:a=1`.
    4. Screen: crop, then scale to the frame.
    5. Blur, for each output interval of each blur overlay: `split` the base, `crop=w:h:x:y,boxblur=<strength>`, then `overlay=x:y:enable='between(t,<a>,<b>)'`.
    6. Camera, when `edit.camera.visible` and a camera track exist: centre-square crop, scale to `size`, `alphamerge` with the mask PNG (input `-loop 1 -i mask.png`, scaled to size), then `overlay=x:y`.
    7. Callouts and lower-thirds: each PNG is a `-loop 1 -i` input, applied with `overlay=0:0:enable='between(t,a,b)+between(t,c,d)…'` over all of that overlay's output intervals. An overlay with no intervals is not added as an input.
    8. Audio: `volume=<gain>` per track (muted tracks are left out), then `amix=inputs=N:normalize=0:duration=first`, or `-an` if there is none.
    9. Output: `-t <outputDuration/1000>` plus Plan A's codec flags and `-n out`.
  - `buildEditedGifArgs(m, e, dir, out, opts: { fps: 15; width: number }): string[]`: steps 2–5 for the screen only, then the Plan A palette chain.
  - `ensureCircleMask(dir: string): Promise<string>`. Writes `<dir>/overlays/mask.png`, a 512×512 white circle on black, via ffmpeg `geq` **once**, and reuses it on later calls.
  - **Without an `edit.json`:** export is unchanged from Plan A, but switches to the mask approach.

- [ ] **Step 1: Write failing tests** (`editExportArgs.test.ts`):
  - `two clips → trim per clip and concat n=2 for each present track`
  - `reordered clips trim in clip order`
  - `blur fully cut out is not in the graph; partly cut → enable covers only surviving output time`
  - `callout PNG input appears once with an enable over all its intervals; a callout with no intervals adds no input`
  - `muted mic is not mixed`
  - `camera hidden → no camera input`
  - `missing camera track with camera settings → no camera input`
  - `50 clips build without error and the graph has exactly 50 trim filters per present track` (Review Focus 4)
- [ ] **Step 2: Write the failing real-ffmpeg test** (`editExportReal.test.ts`, reusing the Plan A `exportAudioSync` generators):
  - Source 6 s: a screen with a `drawtext` timestamp, a mic tone at 0–1 s, a system tone at 4–5 s.
  - Edit: clips `[3000,6000]`, then `[0,1000]`.
  - Assert the output duration is ≈4.0 s (±0.15).
  - Assert, via silencedetect, tone at 1–2 s (system), silence at 0–1 s and 2–3 s, and tone at 3–4 s (mic).
- [ ] **Step 3:** Run both → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6: E2E:**
  - `› export from the editor applies cuts`: cut 1–2 s of the 3 s fixture, export MP4 to a test path via `export:mp4(id, outPath)`, ffprobe duration ≈2.0 s.
  - `› export of an incomplete recording with edits works` (Review Focus 3).
- [ ] **Step 7:** `npm test && npm run test:e2e` → green. Commit `feat: export edited recordings`.

---

## Self-review notes

- **Spec coverage, Studio Edit section:**

| Spec item | Task |
|---|---|
| Timeline with separate tracks | T3, T4, T6 |
| Cut range | T4 |
| Move clips | T4 |
| Blur | T5, T7 |
| Callouts | T5, T7 |
| Lower-thirds | T5, T7 |
| Reposition and resize camera | T6, T7 |
| Export | T7 |

  Transcript cutting, silence and filler removal, and AI cuts are Plan C. They only produce `Clip[]`, which this model accepts.
- **Types are consistent across tasks:**
  - `EditDoc`, `Clip`, `Overlay` come from Task 1.
  - `sourceToOutput` is used by Tasks 5 and 7.
  - Track offsets use the Plan A relative-offset rule everywhere (`collectInputs` and the player).
- **Deferred knowingly:** keyframed camera moves; per-clip speed; transitions; multiple lower-third styles.
