# Leverage Listen — Design

Date: 2026-10-22 · Module 3 of 3 · Evidence: `docs/reverse-engineering/03-openwhispr.md`

## Intent

Replace Wispr Flow (talk anywhere, clean text appears where you type) and meeting notetakers (record a
call, get a summary with action items), built from OpenWhispr's behaviour.

## Decisions (builder's call; flagged for Saurabh to veto)

1. **Toggle, not hold-to-talk.** Press `Ctrl+Shift+Space` to start, again to stop and paste. Hold-to-talk
   and modifier-only keys (OpenWhispr's `Ctrl+Win`) need a native keyboard hook; deferred.
2. **The pill never takes focus**, so the text lands in the app you were typing in.
3. **Paste = clipboard + Ctrl+V** (PowerShell `SendKeys`), restoring your clipboard after 0.5 s if
   nothing else changed it. Settings switch "Paste automatically" (off = copy only).
4. **Cleanup is optional and off until a key exists.** It uses the provider and model already chosen
   for AI in Settings. If cleanup fails, or the model answers instead of cleaning, the raw text is
   pasted — words are never lost.
5. **Silence is never transcribed** (OpenWhispr's gate) — avoids Whisper's invented "Thank you."
6. **History keeps text, not audio**, except a failed dictation keeps its audio until retried/removed.
7. **Meeting capture = mic + system audio, two tracks**, mixed only for transcription (Studio's model).
8. Transcription engine (local whisper.cpp or Groq) is the one chosen in Settings, shared with Studio.

## Scope

**A. Dictation** — global toggle hotkey, pill (recording with level meter + timer / transcribing /
pasted / error), Esc on the pill or its × cancels, silence gate, custom dictionary, optional cleanup,
paste or copy, history on the Listen page (copy, retry failed, delete, clear).

**B. Notes** — Listen page → Notes: **Record meeting** (mic + system audio; stop → transcribe →
summarise), **New note from a Studio recording** (reuses its transcript, else transcribes it), note
view: title (editable), your notes (editable, autosaved), transcript, AI summary (Summary · Key points ·
Decisions · Action items `- [ ] task — owner`), Regenerate, Copy summary, Delete.

## Storage

`userData/listen/history.json` (dictations, newest first, max 500) and `userData/listen/failed/<id>.webm`.
Notes live with the user's files: `Documents\Leverage Notes\<date title>\note.json` (+ `mic.webm`,
`system.webm` for meetings). Never overwrite; same naming as recordings.

## Non-goals v1

Hold-to-talk, voice assistant, tone per app, translation, speaker names, meeting auto-detection,
calendars, streaming transcription, search, sync.
