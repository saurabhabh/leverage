# Reverse engineering report — Flameshot → Leverage Snap

Source: github.com/flameshot-org/flameshot @ `2cd9ad7` (2026-10-21), GPL-3. Cloned to `_lab/flameshot-src`
(git-ignored). Method: Flameshot is open source (C++/Qt), so, as with ShareX, the evidence is read from
source rather than decompiled. We re-implement behaviour; no Flameshot code is copied into Leverage.

## 1. Capture flow

| Behaviour | Evidence | How Flameshot does it | Leverage (Electron) |
|---|---|---|---|
| Freeze first, select second | `utils/screengrabber.cpp` `grabEntireDesktop`; `widgets/capture/capturewidget.cpp` ctor (`fullScreen`) | Grabs the whole desktop **once**, then shows a frameless always-on-top widget painting that still image; everything after (selection, annotation) works on the frozen pixels | Grab every display with `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: native px })`, then open one overlay window per display showing its frozen image |
| Multi-monitor on Windows | `capturewidget.cpp` (`#if defined(Q_OS_WIN)` → window at the virtual desktop's top-left) | One widget spanning all screens | One overlay per display (Studio's region overlay already does this); selection is per display |
| Launcher with delay | `widgets/capturelauncher.cpp` (`delayTime`, "No Delay"; modes: rectangular region, full screen per monitor) | Dialog to pick mode + delay | Snap page: **Region**, **Full screen** (display under the cursor) and a **delay** select (0/3/5/10 s) |
| Global hotkey | `utils/confighandler.cpp` `SHORTCUT("TAKE_SCREENSHOT", "Ctrl+Shift+X")` (Windows), `SCREENSHOT_HISTORY "Alt+Shift+X"` | Global capture shortcut; Print Screen optional (`ignorePrntScrForcesSnipping`) | `Ctrl+Shift+X` is already Studio's *abort*, and Windows 11 gives Print Screen to Snipping Tool by default, so Snap defaults to **`Ctrl+Shift+2`** (shown in Settings) |
| Abort | `capturewidget.cpp` help map (`Esc` → Exit), `showAbortNotification` | Esc closes, optional notification | Esc / right-click on an empty selection cancels; nothing is saved |

## 2. Selection (`widgets/capture/selectionwidget.cpp`, `capturewidget.cpp`)

- Drag a rectangle over the dimmed frozen screen (`contrastOpacity` 190/255 outside the selection).
- 8 resize handles + move by dragging the inside (`getMouseSide`, `handlerAreas`).
- Keyboard: arrows move 1 px, `Shift+arrow` resizes, `Ctrl+Shift+arrow` resizes symmetrically,
  `Ctrl+A` selects the whole screen (config shortcuts `TYPE_MOVE_*`, `TYPE_RESIZE_*`, `TYPE_SELECT_ALL`).
- Size readout next to the selection (`showSelectionGeometry`, `updateSizeIndicator`).
- Optional magnifier (`magnifierwidget.cpp`, off by default) — **deferred** in Leverage.
- `Enter` accepts, `Ctrl+C` copies, `Ctrl+S` saves straight from the overlay.

Leverage: same handles, keys and readout. `Enter` opens the shot in the **Snap editor**; `Ctrl+C`
copies and `Ctrl+S` saves immediately without opening the editor (fast path).

## 3. Annotation tools (`src/tools/*`, `capturetool.h` `enum Type`)

| Tool (key) | Evidence | Behaviour worth keeping | Leverage |
|---|---|---|---|
| Pencil (P) | `pencil/` | Free-hand path | Pen |
| Line (D) | `line/`, `abstracttwopointtool.cpp` | Two points; **Ctrl** snaps to 0/45/90° (`adjustedVector`, `ADJ_UNIT = atan(1)`) | Line; **Shift** snaps to 45° steps (Windows convention) |
| Arrow (A) | `arrow/arrowtool.cpp` | Head scales with thickness: length `18 + 4t`, width `10 + 2t`; shaft is shortened so it does not poke through the head; short arrows shrink the head | Arrow with the same proportional head |
| Rectangle (R), Circle (C) | `rectangle/`, `circle/` | Outline, thickness from size | Rectangle and ellipse; outline or filled |
| Marker (M) | `marker/markertool.cpp` | Highlighter: **multiply** blend at **35 %** opacity, width `14 + size` | Highlighter, same blend |
| Text (T) | `text/texttool.cpp` | Inline editor, font size `size + base`, bold/italic/underline, re-edit by double-click | Text box; double-click to edit again; bold toggle |
| Counter (no key) | `circlecount/circlecounttool.cpp` | Auto-incrementing numbered bubble; number auto-fits the circle | Step counter (N); numbers renumber after delete/undo |
| Pixelate (B) | `pixelate/pixelatetool.cpp` | **Secure "pseudo-pixelation"**: only the 1-px **fringe** around the area is sampled, the interior is never read, so it cannot be un-pixelated (cites bishopfox/unredacter); the old blur/scale mode is behind `insecurePixelate` (off) | Same idea: redaction reads **only** the border pixels. Plus a solid **Redact** box. Ordinary blur is not offered (it leaks) |
| Invert (I) | `invert/` | Inverts pixels in a rect | Not carried (rarely used) |
| Move selection, Undo/Redo | `capturewidget.cpp` `pushObjectsStateToUndoStack`, `undoLimit` 100 | Every edit is an object; moving/editing an object pushes a whole-state snapshot | Same: document = list of shapes, undo = snapshots, limit 100 |
| Select & move existing object | `selectToolItemAtPos`, `MOUSE_DISTANCE_TO_START_MOVING` | Click an object to select, drag past a small threshold to move | Same; `Delete` removes the selected object |
| Size | `wheelEvent`, digit keys in `keyPressEvent` | Wheel or typed digits change tool size | Wheel and `[`/`]` change size |
| Colour | `drawColor` (red), `userColors`, right-click colour wheel | Palette + custom | Palette of 8 + custom picker; red default |
| Pin (no key) | `pin/pinwidget.cpp` | Frameless always-on-top window; wheel zooms, opacity steps of 0.1, drop shadow, Esc closes | Pin window: drag to move, wheel zoom, Ctrl+wheel opacity, Esc/double-click closes |
| Upload (Imgur) | `imgupload/` | Uploads with a hard-coded client id | **Not carried** (nothing leaves the PC in Snap v1) |
| Open with app | `launcher/` | Open in another app | Not carried; "Show in folder" instead |

## 4. Output (`utils/screenshotsaver.cpp`, `filenamehandler.cpp`, `history.cpp`)

- Default name pattern `%F_%H-%M` (date + hour-minute); collisions get a suffix; save dir fixed or asked.
- Clipboard: PNG mime data (optionally JPEG), copy path after save optional.
- Local history of recent captures as thumbnails (`history.cpp`).

Leverage: name `YYYY-MM-DD_HH-mm-ss.png` (seconds, so bursts don't collide; still suffixed `(2)` on a
clash, never overwritten). Default folder `%USERPROFILE%\Pictures\Leverage`. Copy = PNG image on the
clipboard. **Re-editable**: the original pixels and the shape list are kept beside the PNG, so a shot can
be reopened and changed later (Flameshot flattens on save). History = the Snap page's gallery.

## 5. Not carried over

Imgur upload, app launcher, invert, D-Bus/CLI interface, update checker, translations, X11/Wayland paths.

## 6. Added beyond Flameshot

Re-editable shots, crop in the editor, filled shapes, solid redact, save/copy/pin from the gallery,
screenshots appear in Leverage's shared Library.
