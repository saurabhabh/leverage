# Leverage Studio — Plan A: App Shell + Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Electron app where Saurabh picks a screen/window/region, records screen + camera + mic + system audio as separate tracks with a Loom-style camera bubble, controls it from a floating toolbar or global hotkeys, and exports MP4 or GIF from a Library.

**Architecture:** electron-vite app (main / preload / renderer). The main window's renderer owns the media streams and one `MediaRecorder` per track; chunks stream over IPC to the main process, which appends them to per-track files inside a new recording folder with a `recording.json` manifest (crash-safe: whatever arrived is on disk). Small always-on-top windows (toolbar, camera bubble, region overlay) use `setContentProtection(true)` so they never appear in the capture. Export is ffmpeg, driven by a pure argument builder.

**Tech Stack:** Electron (latest stable), electron-vite, React 18, TypeScript, zod, vitest, @playwright/test (Electron smoke), ffmpeg-static + ffprobe-static.

**Spec:** `docs/superpowers/specs/2026-10-22-leverage-design.md`; evidence: `docs/reverse-engineering/01-sharex.md`.

**Out of scope here (Plans B/C):** timeline editor, cuts, blur, callouts, lower-thirds, transcription, AI cuts. Snap-to-window during region selection and moving the region while paused are deferred.

## Global Constraints

- Windows 11 desktop app; Electron; Node 24.
- Tracks are **separate files**: screen video, camera video, mic audio, system audio. Never mix at record time.
- **Never overwrite** an existing file or folder; every recording gets a new folder.
- Default library folder: `%USERPROFILE%\Videos\Leverage` (user-changeable in Settings).
- Export: MP4 = H.264 (`libx264 -preset veryfast -crf 23`, `yuv420p`, even dimensions) + AAC 192 kbps; GIF = 15 fps via `palettegen`/`paletteuse`.
- Countdown default 3 s; prepare all streams *before* the countdown ends (ShareX pattern).
- Default hotkeys: start/stop `Ctrl+Shift+R`, pause/resume `Ctrl+Shift+P`, abort `Ctrl+Shift+X`.
- Abort asks for confirmation (default on).
- No network calls in Plan A.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for all renderers; renderer talks to main only via the typed preload API.

## Review Focus

1. **Camera or mic missing / permission denied** → recording still starts with the remaining tracks and the UI says which track is off (test in Task 5).
2. **App crash or power loss mid-recording** → chunks already on disk; on next launch the recording shows as "incomplete" and still exports (tests in Tasks 3 and 8).
3. **150 % display scaling / second monitor** → a region drawn in the overlay crops the same pixels in the export (test in Task 6).
4. **Library folder deleted, unwritable, or same-second name collision** → recreated or a suffixed folder is used, nothing overwritten (test in Task 3).
5. **Odd-sized region or camera bubble partly off-screen** → export still succeeds (dimensions forced even, overlay clamped) (test in Task 8).

## File Structure

```
package.json, electron.vite.config.ts, vitest.config.ts, playwright.config.ts, tsconfig*.json
src/shared/types.ts            Rect, Size, TrackKind, RecordingManifest (zod schema + type), Settings
src/shared/ipc.ts              channel names + request/response types (single source of truth)
src/shared/region.ts           DIP ↔ video-pixel mapping, even-size clamping
src/main/index.ts              app bootstrap, main window, permission handlers
src/main/settings.ts           load/save settings.json in userData, defaults
src/main/ipc.ts                registers all ipcMain handlers
src/main/recording/naming.ts   unique folder naming
src/main/recording/store.ts    RecordingStore: create, appendChunk, finalize, abort, list, recover
src/main/capture/sources.ts    listSources() via desktopCapturer + screen
src/main/capture/displayMedia.ts  setDisplayMediaRequestHandler with chosen source + loopback audio
src/main/windows/toolbar.ts    recording toolbar window
src/main/windows/bubble.ts     camera bubble window
src/main/windows/overlay.ts    region-selection overlay window(s)
src/main/hotkeys.ts            globalShortcut registration
src/main/tray.ts               tray icon + menu
src/main/media/ffmpeg.ts       runFfmpeg(args, durationMs, onProgress) using ffmpeg-static
src/main/media/exportArgs.ts   buildMp4Args / buildGifArgs (pure)
src/preload/index.ts           contextBridge `window.leverage` API
src/renderer/index.html, toolbar.html, bubble.html, overlay.html
src/renderer/src/App.tsx       left nav: Studio / Snap / Listen / Library / Settings
src/renderer/src/studio/RecordSetup.tsx  source picker, camera/mic selects, toggles, Record button
src/renderer/src/studio/recorder.ts      RecorderSession (streams + MediaRecorders)
src/renderer/src/studio/mime.ts          pickMimeType
src/renderer/src/library/Library.tsx     list, export MP4/GIF, show in Explorer
src/renderer/src/settings/Settings.tsx   library folder, countdown, hotkeys display
src/renderer/toolbar/Toolbar.tsx, bubble/Bubble.tsx, overlay/Overlay.tsx
tests/unit/*.test.ts           vitest
tests/e2e/smoke.spec.ts        Playwright Electron
```

---

### Task 1: Scaffold app shell

**Files:**
- Create: project scaffold via `npm create @quick-start/electron@latest . -- --template react-ts` (answer "no" to updater plugin), then `src/renderer/src/App.tsx`, `vitest.config.ts`, `playwright.config.ts`, `tests/e2e/smoke.spec.ts`, `tests/unit/sanity.test.ts`
- Modify: `package.json` scripts: `test` = `vitest run`, `test:e2e` = `npm run build && playwright test`

**Interfaces:**
- Produces: `App` renders `<nav>` with buttons labelled exactly `Studio`, `Snap`, `Listen`, `Library`, `Settings`; Snap and Listen show "Coming soon". Window title `Leverage`.

- [ ] **Step 1:** Scaffold into the repo root (keep existing `docs/`, `.claude/`, `.gitignore`; merge gitignore). Install `zod`, dev: `vitest`, `@playwright/test`.
- [ ] **Step 2: Write the failing smoke test** `tests/e2e/smoke.spec.ts`: launch with `_electron.launch({ args: ['.'] })`, assert `await page.title() === 'Leverage'` and `getByRole('button', { name: 'Studio' })` visible; click `Snap` → text `Coming soon` visible.
- [ ] **Step 3:** Run `npm run test:e2e` → FAIL (title is the template's).
- [ ] **Step 4:** Implement `App.tsx` nav + placeholder panes; set `<title>Leverage</title>`; main window 1280×800, `backgroundThrottling: false`, `sandbox: true`.
- [ ] **Step 5:** Run `npm run test:e2e` and `npm test` → PASS.
- [ ] **Step 6:** Commit `feat: Leverage Electron shell with module nav`.

### Task 2: Shared types, typed IPC bridge, settings

**Files:**
- Create: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/main/settings.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/settings/Settings.tsx`
- Test: `tests/unit/settings.test.ts`

**Interfaces:**
- Produces:
  - `type Rect = { x: number; y: number; width: number; height: number }`, `type Size = { width: number; height: number }`
  - `type TrackKind = 'screen' | 'camera' | 'mic' | 'system'`
  - `Settings = { libraryDir: string; countdownSec: number; confirmAbort: boolean; hotkeys: { toggle: string; pause: string; abort: string } }`
  - `defaultSettings(home: string): Settings` → libraryDir `path.join(home, 'Videos', 'Leverage')`, countdownSec `3`, confirmAbort `true`, hotkeys `CommandOrControl+Shift+R|P|X`
  - `loadSettings(file: string, home: string): Settings` (missing/corrupt file → defaults, unknown keys dropped, partial file merged over defaults); `saveSettings(file: string, s: Settings): void` (write temp + rename)
  - `window.leverage` API object; every method name equals its channel in `ipc.ts` (e.g. `settings:get`, `settings:set`, `dialog:pickFolder`). Later tasks add methods here.

- [ ] **Step 1: Write failing tests:** `defaults when file missing`, `defaults when file is invalid JSON`, `merges partial file over defaults` (file `{"countdownSec":5}` → countdownSec 5, confirmAbort true), `round-trips save/load`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement with a zod schema (`.partial()` merge over defaults).
- [ ] **Step 4:** `npm test` → PASS. Settings page shows library folder with "Change…" (folder dialog), countdown number input, confirm-abort checkbox, read-only hotkey list.
- [ ] **Step 5:** Commit `feat: settings store and typed IPC bridge`.

### Task 3: Recording store (folders, manifest, chunk files, recovery)

**Files:**
- Create: `src/main/recording/naming.ts`, `src/main/recording/store.ts`; add `RecordingManifest` schema to `src/shared/types.ts`
- Test: `tests/unit/naming.test.ts`, `tests/unit/store.test.ts` (use a temp dir)

**Interfaces:**
- Produces:
  - `RecordingManifest = { version: 1; id: string; title: string; createdAt: string; status: 'recording' | 'complete' | 'incomplete'; durationMs: number; source: { kind: 'screen' | 'window'; name: string; displayBoundsDip?: Rect; scaleFactor: number }; videoSize: Size; crop?: Rect; bubble?: { xDip: number; yDip: number; sizeDip: number }; tracks: Partial<Record<TrackKind, { file: string; mime: string; offsetMs: number }>>; disabledTracks: Partial<Record<TrackKind, string>> }` (disabled value = human reason)
  - `recordingDirName(d: Date): string` → `2026-10-22 14-05-09`
  - `uniqueDir(root: string, base: string): string` → `base`, else `base (2)`, `base (3)` …
  - `class RecordingStore(root: string)`: `create(init: Omit<RecordingManifest,'version'|'id'|'status'|'durationMs'|'createdAt'|'title'|'tracks'> & { tracks: TrackKind[]; mimes: Partial<Record<TrackKind,string>> }): Promise<{ id: string; dir: string }>`; `appendChunk(id, track: TrackKind, data: Uint8Array): Promise<void>`; `setTrackOffset(id, track, offsetMs)`; `disableTrack(id, track, reason)`; `finalize(id, durationMs): Promise<RecordingManifest>`; `abort(id): Promise<void>`; `list(): Promise<RecordingManifest[]>` (newest first); `recover(): Promise<string[]>` (ids changed to incomplete)
  - Track files: `screen.webm`, `camera.webm`, `mic.webm`, `system.webm`; manifest `recording.json` written temp+rename on every change.
  - `finalize` remuxes each track with ffmpeg `-c copy` to `<track>.fixed.webm` then renames over the original (fixes missing WebM duration/cues); a remux failure keeps the raw file and still finalizes.

- [ ] **Step 1: Write failing tests:**
  - `recordingDirName formats local time as YYYY-MM-DD HH-mm-ss`
  - `uniqueDir returns "<base> (2)" when base exists and "<base> (3)" when both exist`
  - `create makes root if missing and writes manifest with status "recording"`
  - `appendChunk appends bytes in order` (append `[1,2]`, `[3]` → file bytes `[1,2,3]`)
  - `abort deletes only that recording's folder`
  - `recover marks status "recording" manifests as "incomplete" and keeps their files`
  - `list skips folders without a valid recording.json`
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement; serialize writes per (id, track) with a promise chain so chunks never interleave. Inject the remux function (`remux: (inFile, outFile) => Promise<void>`) into the constructor so tests pass a stub.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Wire IPC: `rec:create`, `rec:chunk` (ArrayBuffer), `rec:offset`, `rec:disable`, `rec:finalize`, `rec:abort`, `rec:list`; call `recover()` on app start.
- [ ] **Step 6:** Commit `feat: crash-safe recording store`.

### Task 4: Capture sources and source picker

**Files:**
- Create: `src/main/capture/sources.ts`, `src/main/capture/displayMedia.ts`, `src/renderer/src/studio/RecordSetup.tsx`
- Test: `tests/unit/sources.test.ts`

**Interfaces:**
- Produces:
  - `type CaptureSource = { id: string; kind: 'screen' | 'window'; name: string; thumbnailDataUrl: string; displayId?: string; displayBoundsDip?: Rect; scaleFactor: number }`
  - `toCaptureSources(sources: DesktopCapturerSourceLike[], displays: DisplayLike[]): CaptureSource[]` (pure; matches `source.display_id` to `display.id`; windows get the primary display's scaleFactor; excludes Leverage's own windows by name `Leverage`)
  - IPC `capture:list` → `CaptureSource[]` (thumbnail 320×180); `capture:select(sourceId)` stores the choice used by the display-media handler.
  - `installDisplayMediaHandler(session)` → `setDisplayMediaRequestHandler((req, cb) => cb({ video: chosenSource, audio: 'loopback' }))`.

- [ ] **Step 1: Write failing tests** for `toCaptureSources`: screen gets matching display bounds + scaleFactor 1.5; window gets primary scaleFactor; a source named `Leverage` is excluded.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `RecordSetup`: tabs "Screens" / "Windows" with thumbnail grid; a third choice "Region…" (wired in Task 6); camera select + mic select (from `enumerateDevices`, each with "Off"); "System audio" toggle (default on); big **Record** button. Persist last choices in `localStorage` (try/catch).
- [ ] **Step 6:** Commit `feat: capture source picker`.

### Task 5: Recorder session (streams, MediaRecorders, countdown, pause/stop/abort)

**Files:**
- Create: `src/renderer/src/studio/mime.ts`, `src/renderer/src/studio/recorder.ts`, countdown overlay in `RecordSetup.tsx`
- Test: `tests/unit/mime.test.ts`, `tests/unit/recorder.test.ts` (fake MediaRecorder/streams)

**Interfaces:**
- Consumes: `window.leverage.rec*` (Task 3), `capture:select` (Task 4).
- Produces:
  - `pickMimeType(kind: 'video' | 'audio', isSupported: (m: string) => boolean): string` — video preference `video/webm;codecs=vp9`, `video/webm;codecs=vp8`, `video/webm`; audio `audio/webm;codecs=opus`, `audio/webm`.
  - `class RecorderSession` with `constructor(deps: { getDisplayMedia, getUserMedia, MediaRecorder, api, now })`; `prepare(opts: { sourceId: string; cameraId?: string; micId?: string; systemAudio: boolean; crop?: Rect; source: CaptureSource }): Promise<PrepareResult>`; `start(): void`; `pause(): void`; `resume(): void`; `stop(): Promise<RecordingManifest>`; `abort(): Promise<void>`; `state: 'idle'|'prepared'|'recording'|'paused'|'stopped'`.
  - `PrepareResult = { id: string; disabled: Partial<Record<TrackKind, string>> }`.
  - Video bitrate 8 Mbps screen, 2.5 Mbps camera; timeslice 1000 ms; each `dataavailable` → `rec:chunk`.
  - `offsetMs` per track = time of that recorder's `start` event − session t0.

- [ ] **Step 1: Write failing tests:**
  - `pickMimeType falls back to vp8 when vp9 unsupported`
  - `prepare with denied camera disables camera with reason and still prepares screen+mic` (fake `getUserMedia` rejects `NotAllowedError` for video → `disabled.camera === 'Camera permission denied'`)
  - `prepare with no system audio track disables system with reason "No system audio available"`
  - `start starts every recorder in the same tick`; `pause/resume call pause/resume on every recorder`
  - `stop flushes the last chunk before rec:finalize` (finalize called after final `dataavailable`)
  - `a track ending mid-recording (camera unplugged) disables only that track`
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** In `RecordSetup`: Record → `prepare()` → show countdown (`countdownSec`) → `start()`; minimize main window on start; show disabled-track warnings as a banner.
- [ ] **Step 6: Manual check:** record 10 s of a screen with mic + system audio (play a YouTube video); folder contains 3 playable `.webm` files of ~10 s; `recording.json` status `complete`.
- [ ] **Step 7:** Commit `feat: multi-track recorder session`.

### Task 6: Region selection overlay

**Files:**
- Create: `src/shared/region.ts`, `src/main/windows/overlay.ts`, `src/renderer/overlay.html`, `src/renderer/overlay/Overlay.tsx`
- Test: `tests/unit/region.test.ts`

**Interfaces:**
- Produces:
  - `dipRectToVideoRect(r: Rect, displayBoundsDip: Rect, videoSize: Size): Rect` — maps a rect in global DIP coords to pixel coords in that display's captured video (scale = videoSize.width / displayBoundsDip.width), clamps to video bounds, rounds, and forces even width/height (floor to even, min 2).
  - IPC `region:pick(displayId?)` → `{ displayId: string; rectDip: Rect } | null` (null on Esc/right-click). Opens one transparent, frameless, always-on-top, content-protected overlay per display; 20 % dim; drag rectangle with live `W × H` readout; minimum 5 px; last region remembered in settings.

- [ ] **Step 1: Write failing tests:** `150% display: rect {x:100,y:100,w:201,h:101} on display {0,0,1280,720} with video 1920×1080 → {150,150,300,150}` (301.5→300 even, 151.5→150); `second monitor offset: display {x:1920,...} subtracts origin`; `clamps rect overflowing the right edge`.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** "Region…" in `RecordSetup` calls `region:pick`, then selects that display's screen source and passes `crop = dipRectToVideoRect(...)` (videoSize from the stream's track settings after prepare) into the manifest.
- [ ] **Step 6:** Commit `feat: region selection overlay`.

### Task 7: Camera bubble, recording toolbar, tray, global hotkeys

**Files:**
- Create: `src/main/windows/bubble.ts`, `src/main/windows/toolbar.ts`, `src/main/tray.ts`, `src/main/hotkeys.ts`, `src/renderer/bubble.html`, `src/renderer/bubble/Bubble.tsx`, `src/renderer/toolbar.html`, `src/renderer/toolbar/Toolbar.tsx`
- Test: `tests/unit/hotkeys.test.ts`

**Interfaces:**
- Produces:
  - Bubble: 200×200 DIP circular, transparent, frameless, always-on-top, draggable, `setContentProtection(true)`; shows the selected camera; default bottom-left of the recorded display with 24 DIP margin; sizes S/M/L (150/200/280) via hover buttons. On stop, its bounds are written to manifest `bubble` (relative to the recorded display's DIP origin).
  - Toolbar: 300×56 DIP, always-on-top, content-protected, bottom-centre of the recorded display; shows `mm:ss` timer, Pause/Resume, Stop, Abort (confirm dialog when `confirmAbort`). Sends `recorder:command` (`'toggle' | 'pause' | 'abort'`) to the main window renderer.
  - `registerHotkeys(hotkeys: Settings['hotkeys'], send: (cmd: 'toggle'|'pause'|'abort') => void, register = globalShortcut.register): string[]` → returns the accelerators that failed to register (shown as a warning in Settings).
  - Tray: icon with menu Start/Stop recording, Pause, Open Leverage, Quit.

- [ ] **Step 1: Write failing tests:** `registerHotkeys registers three accelerators and maps each to its command`; `returns accelerators whose register() returned false`.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Manual check:** during a recording the bubble and toolbar are visible on screen but absent from `screen.webm`; `Ctrl+Shift+P` pauses from another app; `Ctrl+Shift+R` stops; after stop the main window is restored and Library shows the new recording.
- [ ] **Step 6:** Commit `feat: camera bubble, toolbar, tray and hotkeys`.

### Task 8: Export (MP4, GIF) and Library

**Files:**
- Create: `src/main/media/exportArgs.ts`, `src/main/media/ffmpeg.ts`, `src/renderer/src/library/Library.tsx`
- Test: `tests/unit/exportArgs.test.ts`, `tests/unit/ffmpegProgress.test.ts`

**Interfaces:**
- Consumes: `RecordingManifest` (Task 3), `dipRectToVideoRect` (Task 6).
- Produces:
  - `buildMp4Args(m: RecordingManifest, dir: string, out: string, opts: { micGain: number; systemGain: number; includeCamera: boolean }): string[]`
    - inputs in order screen, camera?, mic?, system?, each with `-itsoffset <offsetMs/1000>` when offset > 0
    - screen: `crop=` from `m.crop` when present, then `scale=trunc(iw/2)*2:trunc(ih/2)*2`
    - camera (when present and `includeCamera`): centre square crop, scale to bubble size in output pixels (bubble DIP × video/display scale, relative to crop origin), circular alpha mask (`geq` alpha), `overlay` clamped inside the frame; default bubble = bottom-left, 20 % of output width, 24 px margin when `m.bubble` absent
    - audio: `volume=` per track, `amix=inputs=N:normalize=0` when N>1; no audio when none
    - `-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart -n`
  - `buildGifArgs(m, dir, out, opts: { fps: 15; width: number }): string[]` — crop as above, `fps=15,scale=<width>:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a`
  - `parseFfmpegProgress(line: string, totalMs: number): number | null` — from `out_time_ms=` lines (`-progress pipe:1`) → 0–100.
  - `runFfmpeg(args: string[], totalMs: number, onProgress: (pct: number) => void): Promise<void>` using `ffmpeg-static` path; rejects with the last 20 stderr lines.
  - IPC `export:mp4(id)`, `export:gif(id)` (save dialog defaulting to the recording folder; never overwrite — `-n` plus dialog), `shell:showInFolder(path)`.

- [ ] **Step 1: Write failing tests:**
  - `screen-only manifest → single input, no -filter_complex audio, has -an`
  - `crop {150,150,300,150} appears as crop=300:150:150:150`
  - `mic+system → amix=inputs=2:normalize=0 with volume=<gain> per input`
  - `camera offset 120ms → -itsoffset 0.12 before the camera -i`
  - `bubble partly off-frame is clamped so overlay x,y ≥ 0 and x+size ≤ width`
  - `incomplete manifest still builds args from the tracks present`
  - `parseFfmpegProgress("out_time_ms=5000000", 10000) === 50`; non-progress line → null
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `Library.tsx`: list (title, date, duration, status badge incl. "incomplete"), buttons **Export MP4**, **Export GIF**, **Show in Explorer**, **Delete** (confirm; moves folder to Recycle Bin via `shell.trashItem`); progress bar during export.
- [ ] **Step 6: Manual check:** record 20 s with camera bubble moved to top-right and a region; export MP4 → plays in Windows Media Player with the bubble top-right, mic + system audible, region cropped; export GIF plays.
- [ ] **Step 7:** `npm test && npm run test:e2e` → PASS. Commit `feat: MP4/GIF export and library`.

---

## Self-review notes

- Spec coverage (Plan A slice): screen/window/region ✔ T4/T6; camera bubble ✔ T7; three separate tracks ✔ T3/T5; hotkeys + countdown ✔ T5/T7; GIF ✔ T8; MP4 export to local folder ✔ T8; abort/confirm ✔ T7. Editor + AI → Plans B/C.
- Deferred knowingly: snap-to-window in the overlay, delayed screenshot capture (belongs to Snap), move region while paused.
