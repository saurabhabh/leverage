# Leverage — Design

Date: 2026-10-22 · Owner: Saurabh

## Intent

Leverage is a free, personal Windows desktop app that replaces paid tools Saurabh uses, built by
reverse engineering three open-source apps (as shown in the video "reverse engineer any app",
youtube.com/watch?v=OR8j1S1xpe4) with the `rea` toolkit (github.com/morluto/rea), using Claude only —
no Lovable.

One app, three modules, built one at a time:

| Module  | Source app (reverse engineered) | Replaces            | Order |
|---------|---------------------------------|---------------------|-------|
| Studio  | ShareX (GPL-3, .NET)            | Loom                | 1st   |
| Snap    | Flameshot (GPL-3, C++/Qt) — see `2026-10-22-snap-design.md` | Snagit-style tools | 2nd |
| Listen  | OpenWhispr (Electron)           | Wispr Flow / meeting notetakers | 3rd |

Per-module process (mirrors the video): reverse engineer the source app with `rea` → write a
feature/evidence report → build our own version inside Leverage with the extra features.
We re-implement behaviour; we do not copy source code.

## Decisions (made by Saurabh)

- **Platform:** Electron desktop app for Windows (chosen over browser app to get global hotkeys,
  silent source picking, full system-audio loopback, paste-into-other-apps).
- **Users:** Saurabh only for now; others maybe later. No sign-in in v1, but keep it addable.
- **Workspace:** `D:\Saurabh\Code\Leverage`. `rea` installed only for this folder, after a safety scan.
- **Transcription:** local Whisper by default; cloud option via Groq (Studio, needs word timestamps)
  and Groq or OpenRouter (Listen).
- **AI text features** (AI cuts, summaries, cleanup, action items): Groq or OpenRouter, user's own
  keys, selectable per job in Settings. Keys stored encrypted (Electron safeStorage / Windows DPAPI).
- **Studio sharing:** v1 = download/export MP4 and send manually. Share links deferred to v2.
- Saurabh uses Loom today and has no specific pain points: Studio's bar is "a free Loom I own".

## Studio (module 1) — scope

**Record**
- Pick screen / window / region (no browser picker; own source picker with thumbnails, multi-monitor).
- Camera bubble overlay (Loom-style, movable), mic.
- Three separate tracks saved: camera video, mic audio, system audio (+ the screen video track).
- Global hotkey start / pause / stop; countdown.
- ShareX-style extras: region capture, GIF recording, delayed capture.

**Edit**
- Timeline with separate tracks.
- Transcript-based editing (delete words → cuts video), word timestamps.
- No-AI auto cuts: silences, filler words ("um", "uh"), retakes.
- AI-suggested cuts via Groq/OpenRouter (optional).
- Cut range, move clips, blur regions, callouts, lower-thirds, reposition/resize camera bubble.

**Export**
- MP4 to a user-chosen folder (ffmpeg).

**Non-goals v1:** share links, viewer comments/reactions, view analytics, teams, being Premiere.

## Constraints

- Windows 11, Node 24, ffmpeg available, no NVIDIA GPU → local Whisper runs on CPU (smaller models).
- Recordings live on local disk, in a folder the user picks; nothing uploaded unless an AI feature
  with a cloud provider is used.
- Respect source licenses (ShareX GPL-3, OpenWhispr MIT) — learn behaviour, don't paste code.

## Shared shell (my call)

- One Electron app, left nav: Studio / Snap / Listen / Library / Settings.
- Shared Library of recordings, screenshots, transcripts; a Studio recording can be sent to Listen.
- Stack: Electron + Vite + React + TypeScript; ffmpeg for media; whisper.cpp for local transcription.

## Left to the builder

Internal architecture, file formats for projects, UI styling, test strategy.
