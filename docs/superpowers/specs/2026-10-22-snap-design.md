# Leverage Snap — Design

Date: 2026-10-22 · Module 2 of 3 · Evidence: `docs/reverse-engineering/02-flameshot.md`

## Intent

A free screenshot annotator Saurabh owns, in the spirit of Flameshot (capture, select, annotate, copy)
with the Snagit-style extra he gets from a real editor: shots stay re-editable.

## Decisions (builder's call; flagged for Saurabh to veto)

1. **Source app = Flameshot** (the design doc said "likely Flameshot — confirm"; "start with snap" was
   taken as the go-ahead).
2. **Annotate in the main window, not on the overlay.** Flameshot annotates on the frozen full-screen
   overlay. Leverage's overlay only *selects*; `Enter` opens the shot in the Snap editor. Reason: room
   for tools, the same editor reopens old shots, and it is testable. Fast paths stay on the overlay:
   `Ctrl+C` copy, `Ctrl+S` save.
3. **Every capture is kept** (ShareX behaviour, not Flameshot's): it lands in the Snap folder and the
   gallery. Copy additionally puts it on the clipboard.
4. **Default hotkey `Ctrl+Shift+2`** — Flameshot's `Ctrl+Shift+X` is Studio's abort, and Windows 11
   gives Print Screen to Snipping Tool.
5. **Redaction is secure by construction**: pixelate reads only the border pixels (Flameshot's
   pseudo-pixelation); solid Redact box; no blur tool.
6. Nothing leaves the PC (no upload).

## Scope v1

**Capture** — hotkey, tray item, Snap page buttons. Modes: *Region* (freeze all displays → select),
*Full screen* (display under the cursor). Delay 0 / 3 / 5 / 10 s. The main window hides itself before
grabbing when the capture was started from it.

**Region overlay** — frozen image per display, dimmed outside the selection, 8 handles, drag to move,
arrows nudge 1 px (`Shift` = 10 px), `Ctrl+arrows` resize, `Ctrl+A` whole display, size readout,
`Enter`/double-click = edit, `Ctrl+C` = copy, `Ctrl+S` = save, `Esc`/right-click = cancel.

**Editor** — tools with keys: Select `V`, Pen `P`, Line `L`, Arrow `A`, Rectangle `R`, Ellipse `E`,
Highlighter `M`, Text `T`, Step counter `N`, Pixelate `B`, Redact `X`, Crop `C`. Shift snaps lines and
arrows to 45°. 8-colour palette + custom, size slider (wheel / `[` `]`), filled toggle for shapes.
Select & drag to move, `Delete` removes, undo/redo (`Ctrl+Z` / `Ctrl+Y`, `Ctrl+Shift+Z`, limit 100).
Autosaves (shape list + rendered PNG). Actions: Copy, Save as…, Pin, Show in folder, Delete.

**Pin** — frameless always-on-top window of the shot: drag to move, wheel zoom, `Ctrl+wheel`
opacity (0.1 steps), `Esc` or double-click closes.

**Gallery** — newest-first thumbnails on the Snap page and under Library → Screenshots.

## Storage

Default folder `%USERPROFILE%\Pictures\Leverage` (Settings). Per shot:

```
Pictures\Leverage\2026-10-22_14-05-09.png          ← what the user sees/shares (rendered)
Pictures\Leverage\.leverage\2026-10-22_14-05-09\original.png
Pictures\Leverage\.leverage\2026-10-22_14-05-09\snap.json   ← { version, id, file, createdAt, width, height, crop?, shapes[] }
```

Names never overwrite (`… (2).png`). Shape coordinates are original-image pixels. A shot whose PNG
the user deleted in Explorer disappears from the gallery.

## Non-goals v1

Upload/share links, OCR, scrolling capture, window snapping in the overlay, magnifier, invert tool.
