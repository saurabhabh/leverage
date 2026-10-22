# Leverage Studio — Plan C: Transcripts and AI Cuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saurabh can transcribe any recording, either locally with whisper.cpp (free, private, the default) or with Groq (fast, needs a key). He can then:
- edit by deleting words from the transcript;
- remove silences and filler words with one click each;
- get AI-suggested cuts (retakes, rambling) from Groq or OpenRouter, review them, and apply them.

Every change is an ordinary undoable edit.

**Architecture:**
- **Transcript file.** A transcript is a `transcript.json` in the recording folder. It holds words with times on the **source timeline** (the same timeline as Plan B clips), so it never changes when the edit changes.
- **Pure core.** `src/shared/transcript.ts` holds all word, silence and filler logic, plus a new `removeSourceRange` op in `edit.ts`. Deleting words, removing fillers and removing silences all become `removeSourceRange` calls.
- **Speech engines and AI calls** run in the main process, so API keys never reach a renderer. Keys are stored with Electron `safeStorage` (Windows DPAPI).
- **First-use install.** The local engine (whisper.cpp binary) and the model are downloaded on first use, after the user confirms. Each download is checked against a pinned SHA-256.

**Tech Stack:** Plan A/B stack. whisper.cpp `whisper-cli` b5454 (Windows x64 BLAS build), model `ggml-base.bin` (multilingual: English + Hindi/Marathi). Groq OpenAI-compatible API, OpenRouter chat API. No new npm runtime dependencies (`fetch`, `FormData` and `Blob` are built into Node 24 and Electron).

**Spec:** `docs/superpowers/specs/2026-10-22-leverage-design.md`, with these sections:
- "Decisions": transcription local by default, Groq option; AI via Groq or OpenRouter.
- "Studio — Edit": transcript-based editing, no-AI auto cuts (silences, filler words, retakes), AI-suggested cuts.

Builds on Plan B (`docs/superpowers/plans/2026-10-22-studio-b-editor.md`).

## Global Constraints

- **Languages:** English with Hindi/Marathi mixed in. Whisper runs with `-l auto` and the multilingual `ggml-base.bin` model.
- **Pinned downloads:**

| File | Size | SHA-256 | Source |
|---|---|---|---|
| Engine zip | 21,715,607 bytes | `b1158bd10edf92c9799149a6fc5d3e58da3f495241d6fb3423088130e88ffbf3` | `https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-blas-bin-x64.zip` |
| Model | 147,951,465 bytes | `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin` |

- **Download rules:** installed under `<userData>/whisper/` and kept only if the hash matches. The app never downloads without a click on a dialog that states the size.
- **Groq endpoints:**
  - transcription: `POST https://api.groq.com/openai/v1/audio/transcriptions`, model `whisper-large-v3-turbo`, `response_format=verbose_json`, `timestamp_granularities[]=word`;
  - chat: `POST https://api.groq.com/openai/v1/chat/completions`, default model `openai/gpt-oss-120b`.
- **OpenRouter:** `POST https://openrouter.ai/api/v1/chat/completions`, default model `anthropic/claude-sonnet-5.5`. The model id is editable in Settings.
- **Base URLs** can be overridden only by the env vars `LEVERAGE_GROQ_URL` and `LEVERAGE_OPENROUTER_URL`, for tests.
- **Groq upload limit:** audio is sent as 16 kHz mono 48 kbps MP3, in chunks of at most 10 minutes. Each chunk's word times are shifted by its start.
- **What gets transcribed:** the **mic** track. Without a mic, the **system** track. Without either, Transcribe is disabled with the reason.
- **Fillers:**
  - single words: `um, umm, uh, uhh, uhm, erm, er, ah, hmm, mm, hm`. Matching is case-insensitive, after stripping punctuation.
  - two-word sequences: `you know` and `i mean`. They are **not** auto-removed; they're only flagged in the transcript (too often meaningful).
- **Silence removal:** ffmpeg `silencedetect=n=-35dB:d=1.0` on the transcribed track. 250 ms of padding is kept on both sides of each removed silence.
- **AI cuts:**
  - Only the transcript text with word indexes is sent, never audio or video.
  - The response must be JSON `{ "cuts": [{ "from": int, "to": int, "reason": string }] }`.
  - Indexes are validated (in range, from ≤ to, no overlaps). Invalid items are dropped and the count is shown.
- **Keys:** `safeStorage.encryptString`, saved to `<userData>/keys.json`. Keys are write-only from the renderer, which can only see whether a key is set. If `safeStorage.isEncryptionAvailable()` is false, keys are refused, with a message.
- **No network calls** except: the two install downloads (after the user confirms), Groq (when chosen and a key is set), and OpenRouter (when chosen and a key is set).

## Review Focus

1. **No engine, a partial download, or a hash mismatch** (network drop, wrong file). Nothing half-installed is used; a retry works; the error is clear. *(Test in Task 3.)*
2. **A recording with no mic, or a mic track that is silent or has no speech.** Transcribe either says why it's unavailable, or produces an empty transcript with "No speech found". It never crashes. *(Tests in Tasks 4 and 5.)*
3. **Deleting words that span two clips, or words already cut, or with a reordered edit.** Only those words' source ranges are removed, and undo restores them. *(Test in Task 1.)*
4. **An AI response that is not JSON, has out-of-range indexes, or overlaps.** Bad items are dropped with a count, and nothing is applied without a click. *(Test in Task 7.)*
5. **A wrong or expired API key, a 429 rate limit, or no internet.** A readable message names the provider and the status; the editor stays usable. *(Tests in Tasks 4 and 7.)*

## File Structure

```
src/shared/transcript.ts          Transcript types, schema, filler detection, silence parsing, word↔edit mapping
src/shared/edit.ts                + removeSourceRange
src/main/secrets.ts               KeyStore (safeStorage-backed, injectable cipher for tests)
src/main/whisper/install.ts       download + verify + unpack engine and model; status
src/main/whisper/local.ts         run whisper-cli → words
src/main/ai/groq.ts               transcription (chunked) + chat
src/main/ai/openrouter.ts         chat
src/main/ai/chat.ts               provider-neutral chat call + error mapping
src/main/ai/suggest.ts            prompt building + response validation for AI cuts
src/main/transcribe/ipc.ts        transcribe:*, whisper:*, ai:* channels; transcript.json persistence
src/renderer/src/editor/TranscriptPanel.tsx
src/renderer/src/editor/AutoCuts.tsx       silence / filler / AI suggestions UI
src/renderer/src/settings/AiSettings.tsx
tests/unit/transcript.test.ts, removeSourceRange.test.ts, secrets.test.ts, install.test.ts,
           whisperLocal.test.ts, groq.test.ts, suggest.test.ts, chat.test.ts
tests/e2e/transcript.spec.ts, autocuts.spec.ts, ai-settings.spec.ts
```

---

### Task 1: Transcript model and removeSourceRange

**Files:** Create `src/shared/transcript.ts`; modify `src/shared/edit.ts`; tests `tests/unit/transcript.test.ts`, `tests/unit/removeSourceRange.test.ts`.

**Interfaces — Produces:**

*Types:*
- `Word = { text: string; startMs: number; endMs: number }`, in source-timeline ms.
- `Transcript = { version: 1; engine: 'local' | 'groq'; language: string; track: 'mic' | 'system'; words: Word[]; createdAt: string }`, with its zod `TranscriptSchema`.

*In `edit.ts`:*
- `removeSourceRange(e: EditDoc, srcStartMs: number, srcEndMs: number): EditDoc`. Every clip loses the part overlapping that source range: a clip may split, shrink or disappear. It never leaves zero clips (the op is then a no-op), and pieces under 100 ms are dropped.

*Pure functions in `transcript.ts`:*
- `isFiller(word: string): boolean`
- `fillerRanges(words: Word[]): { startMs: number; endMs: number }[]`. Merges adjacent fillers.
- `flaggedPhrases(words: Word[]): number[]`. Indexes of the first word of each `you know` / `i mean`.
- `parseSilences(ffmpegStderr: string, padMs = 250): { startMs: number; endMs: number }[]`. Each range is shrunk by the padding on both sides and dropped if empty.
- `wordState(e: EditDoc, w: Word): 'kept' | 'cut' | 'partial'`. Uses `sourceToOutput` coverage.
- `wordAtSource(words: Word[], srcMs: number): number`. Index, or -1.
- `toTrackTime(words: Word[], trackOffsetMs: number): Word[]`. Shifts words from track-local time to source time.

**Steps:**
- [ ] **Step 1: Write failing tests.**
  - `removeSourceRange inside one clip splits it`
  - `spanning two clips trims both`
  - `with reordered clips removes the same content wherever it plays`
  - `removing everything is a no-op`
  - `isFiller matches "Um," "UH." "hmm" but not "umbrella"`
  - `fillerRanges merges "um uh" into one range`
  - `flaggedPhrases finds "you know" case-insensitively`
  - `parseSilences reads silence_start/silence_end pairs and pads them` (use the real stderr lines from the spike: `silence_start: 4.88` / `silence_end: 7.76 | silence_duration: 2.88` → `{ startMs: 5130, endMs: 7510 }`)
  - `parseSilences drops silences shorter than twice the padding`
  - `wordState: kept, cut after cutRange, partial when a cut edge falls inside the word`
- [ ] **Step 2:** `npx vitest run tests/unit/transcript.test.ts tests/unit/removeSourceRange.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `npm test` green.
- [ ] **Step 5:** Commit `feat: transcript model and source-range removal`.

### Task 2: Key store and AI settings

**Files:** Create `src/main/secrets.ts`, `src/renderer/src/settings/AiSettings.tsx`. Modify `src/shared/types.ts` (Settings gets an `ai` section), `src/shared/ipc.ts`, `src/main/ipc.ts`, and `Settings.tsx` (renders `<AiSettings/>`). Tests: `tests/unit/secrets.test.ts`, `tests/e2e/ai-settings.spec.ts`.

**Interfaces — Produces:**
- `Settings.ai = { transcription: 'local' | 'groq'; suggestions: 'groq' | 'openrouter'; groqChatModel: string; openrouterModel: string }`. Defaults: `'local'`, `'groq'`, `'openai/gpt-oss-120b'`, `'anthropic/claude-sonnet-5.5'`. A missing `ai` section in an old settings.json gets these defaults.
- `type Provider = 'groq' | 'openrouter'`
- `class KeyStore(file: string, cipher: { available(): boolean; encrypt(s: string): Buffer; decrypt(b: Buffer): string })`, with methods:
  - `set(p: Provider, key: string): void`. Trims the key; an empty key deletes it. Throws `Secure storage is not available on this PC` when the cipher is unavailable.
  - `get(p: Provider): string | null`, main process only.
  - `has(p: Provider): boolean`
  - The file holds base64 ciphertext per provider, written temp+rename.
- IPC:
  - `ai:setKey(p, key) → void`
  - `ai:hasKeys() → { groq: boolean; openrouter: boolean }`
  - There is never a get-key channel.
- **UI.** Settings has a "Transcription & AI" card with:
  - radio buttons for the transcription engine (Local / Groq);
  - a select for the suggestions provider;
  - two password inputs (Groq key, OpenRouter key) with Save buttons, showing "Saved ✓" once set;
  - model text fields;
  - a note: "Keys are stored encrypted on this PC and only sent to that provider."

**Steps:**
- [ ] **Step 1: Write failing unit tests**, using a fake reversible cipher:
  - `set/get/has round-trip`
  - `empty key deletes`
  - `file never contains the plain key`
  - `unavailable cipher refuses with a clear message`
  - `old settings without ai get defaults`
- [ ] **Step 2: Write the failing e2e test.** `ai-settings.spec.ts › saving a Groq key shows Saved and never returns the key`. It types a dummy test string, `test-key-not-real`, then asserts:
  - `ai:hasKeys().groq === true`
  - the password input is cleared
  - `keys.json` on disk does not contain `test-key-not-real`
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit `feat: encrypted key store and AI settings`.

### Task 3: Local engine install (download, verify, unpack)

**Files:** Create `src/main/whisper/install.ts`. Modify `src/shared/ipc.ts` and the main registration. Test: `tests/unit/install.test.ts`, which uses a local `http.createServer` serving the fixture bytes.

**Interfaces — Produces:**
- `type InstallStatus = { engine: boolean; model: boolean; dir: string }`
- `whisperStatus(root: string): InstallStatus`. Ready means `whisper-cli.exe` exists in `<root>/bin` and `<root>/models/ggml-base.bin` exists.
- `installWhisper(root: string, opts: { onProgress(stage: 'engine' | 'model', pct: number): void; signal?: AbortSignal; sources?: Sources }): Promise<void>`.
  - Downloads to a `.part` file and hashes it while streaming; on a match, renames into place. On a mismatch it deletes the `.part` and throws `Download check failed for <name>`.
  - The engine zip is unpacked with `tar -xf <zip> -C <tmp>` (Windows bsdtar). The `Release/*` contents move to `<root>/bin`.
  - Already-present, verified parts are skipped. A `<root>/installed.json` records the verified hashes, so the next launch doesn't re-hash 148 MB.
- `Sources = { engine: { url; sha256; size }; model: { url; sha256; size } }`. Defaults are the pinned values from Global Constraints; tests pass local URLs.
- IPC:
  - `whisper:status() → InstallStatus`
  - `whisper:install() → void`, with progress on the event `whisper:progress { stage, pct }`
  - `whisper:cancel() → void`

**Steps:**
- [ ] **Step 1: Write failing tests** (temp root, local server, small fake zip made with `tar -a -cf` containing `Release/whisper-cli.exe` as a text stub):
  - `fresh install downloads, verifies and unpacks both`
  - `hash mismatch deletes the part file and throws with the file name`
  - `server error throws and leaves no partial install`
  - `second install with everything present downloads nothing`
  - `cancel aborts and cleans the part file`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: verified whisper.cpp engine and model install`.

### Task 4: Transcription engines (local whisper + Groq)

**Files:** Create `src/main/whisper/local.ts`, `src/main/ai/groq.ts`, `src/main/ai/chat.ts` (error mapping only, for now) and `src/main/transcribe/ipc.ts`. Tests: `tests/unit/whisperLocal.test.ts`, `tests/unit/groq.test.ts`.

**Interfaces — Produces:**
- `extractSpeechAudio(m: RecordingManifest, dir: string, out: string, format: 'wav16k' | 'mp3'): Promise<{ track: 'mic' | 'system'; offsetMs: number } | null>`. Uses the ffmpeg audio of the chosen track (null when there is none): 16 kHz mono PCM WAV for local, 48 kbps mono MP3 for Groq.
- `parseWhisperJson(json: unknown): { language: string; words: Word[] }`. Drops empty/whitespace tokens and trims text. A word with `to < from` gets `endMs = startMs`.
- `transcribeLocal(root: string, wav: string, onProgress: (pct) => void, signal?): Promise<{ language; words }>`.
  - Runs `whisper-cli -m <model> -f <wav> -l auto -ml 1 -sow -oj -of <tmp> -pp -t <max(2, cpus-1)>`.
  - Progress comes from `-pp`, using the stderr `progress = N%` lines.
- `transcribeGroq(key: string, mp3Chunks: { file: string; startMs: number }[], fetchImpl = fetch): Promise<{ language; words }>`.
  - Sends multipart form data with the file, `model`, `response_format=verbose_json` and `timestamp_granularities[]=word`.
  - Word times (in seconds) are converted to ms and shifted by the chunk's start.
- `chunkAudio(input: string, outDir: string, maxMs = 600_000): Promise<{ file; startMs }[]>`, using the ffmpeg segment muxer.
- `providerError(provider: 'Groq' | 'OpenRouter', status: number, body: string): Error`. Messages:
  - 401/403 → `<P> rejected the API key — check it in Settings`
  - 429 → `<P> rate limit reached — wait a minute and try again`
  - 5xx → `<P> is having problems (HTTP <n>)`
  - network → `Could not reach <P> — check your internet connection`
- IPC:
  - `transcribe:run(id) → Transcript`. It uses `settings.ai.transcription`, shifts words by the track offset into source time, and saves `transcript.json`. Progress goes out on `transcribe:progress { id, pct, stage }`.
  - `transcribe:get(id) → Transcript | null`
  - `transcribe:cancel(id)`
  - Local with no engine → throws `NEEDS_INSTALL` (code), which the renderer turns into the install dialog. Groq without a key → `Add a Groq API key in Settings`.

**Steps:**
- [ ] **Step 1: Write failing tests:**
  - `parseWhisperJson reads offsets.from/to and drops empty tokens`, with the spike JSON (from `_lab/whisper-dl/out.json`) committed as a fixture.
  - `real local transcription finds "welcome" and "record"`. This one runs only when `_lab/whisper-dl/bin/Release/whisper-cli.exe` and the model exist (otherwise `test.skip` with a reason), on the committed TTS fixture `tests/fixtures/speech.wav`. It asserts the word `"welcome"` lies within 0.3–1.6 s.
  - `silent audio gives no words`: 3 s of anullsrc, same skip rule.
  - `transcribeGroq sends model, verbose_json and word granularity, and shifts chunk times`, against a fake fetch.
  - `providerError maps 401, 429, 503 and network errors`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: local and Groq transcription`.

### Task 5: Transcript panel in the editor

**Files:** Create `src/renderer/src/editor/TranscriptPanel.tsx`. Modify `Editor.tsx`: the side area becomes tabs **Transcript | Properties**, with Properties showing the existing inspector or camera panel. Test: `tests/e2e/transcript.spec.ts`, whose fixture seeds a `transcript.json`.

**Interfaces:**
- **Consumes:** `transcribe:*` and `whisper:*` IPC (Tasks 3–4), and `wordState`, `wordAtSource`, `removeSourceRange` and `flaggedPhrases` (Task 1).
- **Produces the UI:**
  - **No transcript yet:** a **Transcribe** button with the engine name. Local without the engine → a dialog: "Download the speech engine (22 MB) and model (148 MB) once? They stay on this PC." It has **Download** / Cancel and a progress bar.
  - **While transcribing:** a progress bar and a Cancel button.
  - **The transcript:** words flow as inline spans with `data-testid="word"`.
    - Cut words are struck through and dimmed; flagged phrases have a dotted underline.
    - The word at the playhead is highlighted.
    - Clicking a word seeks to it.
    - A drag or Shift+click selects a range. **Delete** (or a "Cut selected words" button) commits `removeSourceRange(first.startMs, last.endMs)`.
  - A **"Re-transcribe"** item in a small menu.
  - **Empty results:** "No speech found in the <mic/system audio> track."

**Steps:**
- [ ] **Step 1: Write failing e2e tests:**
  - `› seeded transcript shows its words; clicking one seeks there`
  - `› selecting words and pressing Delete cuts them; they show struck through; Ctrl+Z restores`
  - `› a recording without mic or system audio explains why Transcribe is unavailable`
  - `› local engine missing shows the download dialog with sizes`. The dialog is checked; Cancel closes it. Nothing is downloaded in tests.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Manual check, real engine.** From `_lab`, copy the engine and model into the isolated profile's `whisper/` folder. Transcribe a real recording, then delete a sentence and export. The sentence is gone.
- [ ] **Step 6:** Commit `feat: transcript-based editing`.

### Task 6: One-click silence and filler removal

**Files:** Create `src/renderer/src/editor/AutoCuts.tsx` (a section in the Transcript tab). Modify `src/main/transcribe/ipc.ts` to add `autocut:silences(id) → { startMs; endMs }[]`, which runs silencedetect on the transcribed track and shifts by its offset. Test: `tests/e2e/autocuts.spec.ts`; the fixture mic audio has tone 0–1 s, silence 1–2.5 s, tone 2.5–3 s.

**Interfaces — Produces:**
- **Remove silences.** Calls `autocut:silences`, then applies `removeSourceRange` for each range in one history step (one `commit`). It shows "Removed N pauses (X.X s)", or "No long pauses found".
- **Remove filler words.** Needs a transcript. It applies `fillerRanges(words)` in one step and shows "Removed N filler words", or "None found".
- Both buttons are disabled with a tooltip when their input is missing.

**Steps:**
- [ ] **Step 1: Write failing e2e tests:**
  - `› Remove silences cuts the 1.5 s pause (duration drops by about 1.0 s after padding) and one Ctrl+Z restores it`
  - `› Remove filler words cuts "um" from a seeded transcript`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: one-click silence and filler removal`.

### Task 7: AI-suggested cuts

**Files:** Create `src/main/ai/openrouter.ts` and `src/main/ai/suggest.ts`. Modify `src/main/ai/groq.ts` (add chat), `src/main/ai/chat.ts` and `AutoCuts.tsx`. Tests: `tests/unit/suggest.test.ts`, `tests/unit/chat.test.ts`, and the e2e `autocuts.spec.ts` (with a mock server via `LEVERAGE_GROQ_URL`).

**Interfaces — Produces:**
- `buildSuggestPrompt(words: Word[], opts: { targetSeconds?: number }): { system: string; user: string }`.
  - The user message lists `[index] word` lines, chunked as `i: text`.
  - The system message says: you are a video editor; find retakes (the speaker restarts a sentence), false starts, long rambles and off-topic asides; never cut content the speaker clearly meant to keep; return only `{"cuts":[{"from":i,"to":j,"reason":"…"}]}`.
- `parseSuggestions(raw: string, wordCount: number): { cuts: { from: number; to: number; reason: string }[]; dropped: number }`. It strips code fences and takes the first JSON object. It drops items that are out of range, have from > to, or overlap an earlier item.
- `chat(provider: Provider, key: string, model: string, messages, fetchImpl = fetch): Promise<string>`. Uses the OpenAI-compatible body with `response_format: { type: 'json_object' }` and `temperature: 0.2`. OpenRouter also sends `HTTP-Referer: https://leverage.local` and `X-Title: Leverage`.
- IPC `ai:suggestCuts(id, targetSeconds?) → { cuts: { from; to; reason; startMs; endMs }[]; dropped: number }`. It uses `settings.ai.suggestions` and that model; a missing key gives `Add a <Provider> API key in Settings`.
- **UI.** A **Suggest cuts with AI** button, with an optional "Target length (min)" field. Results list each cut's reason and words.
  - Each suggestion has **Apply** and **Dismiss**; there's also **Apply all**, which is one history step.
  - "N suggestions couldn't be used" is shown when `dropped > 0`.

**Steps:**
- [ ] **Step 1: Write failing tests:**
  - `parseSuggestions accepts fenced JSON`
  - `drops out-of-range, reversed and overlapping items and counts them`
  - `non-JSON gives zero cuts and dropped 0 with an error`
  - `chat sends model, json mode and auth header; maps 401/429 via providerError`
  - e2e `› AI suggestions from a mock Groq appear with reasons; Apply cuts those words; a 401 shows the key message`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** `npm test && npm run test:e2e` → green. Commit `feat: AI-suggested cuts`.

---

## Self-review notes

- **Spec coverage:**

| Spec item | Task |
|---|---|
| Local Whisper default, Groq option | T3, T4 |
| Transcript-based editing | T5 |
| No-AI cuts: silences, fillers | T6 |
| Retakes (as part of AI cuts) | T7 |
| AI cuts via Groq/OpenRouter | T7 |
| Keys encrypted | T2 |

- **Types:**
  - `Word` and `Transcript` come from Task 1 and are used in Tasks 4–7.
  - `removeSourceRange` is the single cut path for T5–T7.
  - `Provider` comes from T2 and is used in T7.
- **Deferred:** speaker labels (that's Listen), editing transcript text, captions export, GPU whisper builds, and a local LLM via Ollama (not chosen).
