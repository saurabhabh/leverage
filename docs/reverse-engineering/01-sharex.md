# Reverse engineering report — ShareX → Leverage Studio

Source: github.com/ShareX/ShareX @ `1789741` (2026-10-22), GPL-3. Cloned to `_lab/sharex-src` (git-ignored).
Method: ShareX is open source, so per REA's own guidance ("for ordinary analysis of a complete source
repository, use normal repository tools") the evidence below is read from source, not decompiled.
We re-implement behaviour; no ShareX code is copied into Leverage.

## 1. Recording pipeline (the core)

ShareX has two recorders: a legacy FFmpeg one (`ShareX.ScreenCaptureLib/ScreenRecording/`) and a new
native one (`ShareX.ScreenRecordingLib/`). The native one is the design worth learning from.

| Behaviour | Evidence | How ShareX does it | Leverage (Electron) |
|---|---|---|---|
| Capture source | `ScreenRecordingLib/RecordingOptions.cs` (`Region`, `WindowHandle`) | Windows Graphics Capture of a desktop rectangle or a window (window capture works even when occluded) | `desktopCapturer.getSources` → `getUserMedia` with the chosen screen/window id; region = record the display and store a crop rect |
| Prepare during countdown | `ScreenRecordingLib/ScreenRecorder.cs` (`PrepareAsync` / `StartAsync`, "Prepare during a countdown to remove setup from StartAsync") | All devices, encoder and files are opened *before* the countdown ends, so recording starts instantly | Open screen/cam/mic/system streams and create MediaRecorders during the 3-2-1 countdown; `start()` all at zero |
| Single media clock | `RecordingClock.cs`, `ScreenRecorder.Run` | One clock drives video frames + audio; pause stops the clock | One `t0` (performance.now) shared by every track; pause/resume all recorders together; write a `timeline.json` of pause spans |
| Never speed up to catch up | `ScreenRecorder.Run` ("Skip overdue frame slots. Never accelerate playback") | Late frames are dropped and counted, not burst-written | Rely on MediaRecorder timestamps; report dropped-frame stats if available |
| Pause + move region | `ScreenRecorder.Resume(Rectangle)` | Region can move (even to another monitor) while paused; size must stay the same | v2 — not in first Studio release |
| Camera | `Video/CameraCapture.cs`, `Video/CameraOverlay.cs`, `CameraCircleShader.cs` | Camera is **composited into** the screen video: circle or rectangle, corner position, 5–50 % width, margin | **Different by design:** camera is recorded as its **own track**; a circle bubble window is shown live (excluded from capture) and composited only at export, so it can be moved/resized in the editor |
| Camera failure is non-fatal | `ScreenRecorder.Run` ("Camera overlay disabled; screen and audio recording continue") | | Same: if the camera stream dies, keep recording screen+audio and warn |
| Audio | `Audio/WasapiCapture.cs`, `Audio/AudioMixer.cs`; options `CaptureSystemAudio`, `CaptureMicrophone`, gains 0–4 | WASAPI loopback (system) + mic **mixed into one AAC track** | **Different by design:** system audio (Electron `setDisplayMediaRequestHandler` with `audio: 'loopback'`) and mic are **separate tracks**, each with its own gain in the editor; mixed only at export |
| Output | `RecordingOptions.Validate` | H.264/AAC MP4 or GIF; extension selects format; hardware encoder required by default | Record WebM per track (MediaRecorder), export MP4 (H.264/AAC) or GIF with ffmpeg |
| Safe output file | `ScreenRecorder.Run` ("Never overwrite or delete a pre-existing user file", `FileMode.CreateNew`) | Name reserved atomically; partial file deleted on failure | Each recording gets a new folder; never overwrite; on failure keep what was captured and mark it "incomplete" (we prefer salvage over delete) |
| Abort vs stop | `RequestAbort` / `RequestStop`; `ScreenRecordAskConfirmationOnAbort` (`ShareX/TaskSettings.cs`) | Abort discards; optional confirmation | Same, with confirmation on by default |
| GIF | `Encoding/GifWriter.cs`; `GIFFPS = 15` | Adaptive-palette GIF writer, progress events | ffmpeg `palettegen`/`paletteuse` at 15 fps, progress bar |
| Legacy FFmpeg codecs | `ScreenCaptureLib/Enums.cs` (`FFmpegVideoCodec`), `FFmpegOptions.cs` | x264 ultrafast CRF 28, NVENC/AMF/QSV options | Export uses ffmpeg (already installed); default `libx264 -preset veryfast -crf 23`, auto-use `h264_qsv`/`h264_amf`/`h264_nvenc` if present |

## 2. Recording controls UX

Evidence: `ShareX.ScreenCaptureLib/Presentation/ScreenRecording/ScreenRecordWindow.axaml.cs`,
`ShareX/TaskSettings.cs` (lines ~421–432).

- Floating toolbar with **timer**, Start/Stop, **Pause**, **Restart**, **Abort** (with confirm); tray
  menu mirrors the same actions.
- Optional **start delay** (default 3 s), **fixed duration**, show cursor, 30 fps video / 15 fps GIF.
- Leverage: same toolbar as an always-on-top Electron window with `setContentProtection(true)` so it
  never appears in the recording; tray icon with the same actions.

## 3. Hotkeys

Evidence: `ShareX/Enums.cs` `HotkeyType` — screen record (region / active window / custom region),
GIF variants, `StopScreenRecording`, `PauseScreenRecording`, `AbortScreenRecording`; capture hotkeys
`PrintScreen`, `ActiveWindow`, `ActiveMonitor`, `RectangleRegion`, `LastRegion`, `ScrollingCapture`.
Leverage Studio v1: global hotkeys (Electron `globalShortcut`) for start/stop, pause, abort, GIF.
Screenshot hotkeys belong to **Snap** (module 2).

## 4. Region selection

Evidence: `ShareX.ScreenCaptureLib/RegionCaptureOptions.cs`.
Dimmed background (20 %), **window detection** (snap to window under cursor), magnifier, crosshair,
minimum size 5 px, right-click cancels, "last region" reuse, keyboard nudging.
Leverage Studio v1: transparent overlay window per display, dimmed background, drag a rectangle,
snap-to-window, size readout, Esc/right-click cancels, remember last region.
Magnifier and colour readout → Snap.

## 5. After-capture actions

Evidence: `ShareX/Enums.cs` `AfterCaptureTasks` (copy, save, save-as, show in Explorer, annotate,
OCR, upload, …) and `AfterUploadTasks`.
Leverage Studio v1: after stop → open the recording in the editor; actions: export MP4/GIF, copy file,
show in Explorer. Upload/links are v2 (per design).

## 6. Not carried over (ShareX features out of Studio's scope)

Uploaders (80+ hosts), URL shorteners, image effects/beautifier, OCR, QR, colour picker, ruler, pin to
screen, scrolling capture → either Snap (module 2) or not planned.

## 7. Added beyond ShareX (from the video + Loom)

Separate tracks (screen, camera, mic, system audio); Loom-style camera bubble; editor with transcript
cutting, silence/filler removal, AI-suggested cuts (Groq/OpenRouter), cut range, move clips, blur,
callouts, lower-thirds, camera reposition; local Whisper transcription.
