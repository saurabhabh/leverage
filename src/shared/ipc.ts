import type { CaptureSource, RecordingManifest, Rect, Settings, TrackKind } from './types'

export type RegionPick = { displayId: string; rectDip: Rect }

export type RecorderCommand = 'toggle' | 'pause' | 'abort'
export type RecorderStatus = {
  phase: 'idle' | 'countdown' | 'recording' | 'paused' | 'saving'
  elapsedMs: number
  /** Display being recorded; undefined for window capture (helpers then use the primary display). */
  displayId?: string
  cameraId?: string
  /** Problems the user must see even with the main window minimized (e.g. a track dropped). */
  warnings?: string[]
}
export type BubblePlacement = { xDip: number; yDip: number; sizeDip: number }
import type { CreateInitPayload } from './recording'
import type { EditDoc } from './edit'
import type { Transcript } from './transcript'
import type { SnapAction, SnapDoc, SnapEntry, SnapMode } from './snap'
import type { DictationEntry, DictationStatus, NoteDoc, NoteEntry } from './listen'
import type { GateDecision } from './speechGate'

/** Pill → main: what was recorded, and whether anything was said. */
export type DictationAudioInfo = { durationMs: number; gate: GateDecision }
export type DictateCommand = { action: 'start'; id: string } | { action: 'stop' } | { action: 'cancel' }

/** From the Snap region overlay: the selection (global DIP) and what to do with it. */
export type SnapSelection = { displayId: string; rectDip: Rect; action: SnapAction }

export type OpenedEdit = { manifest: RecordingManifest; dir: string; edit: EditDoc; repaired: boolean; sourceMs: number }

/**
 * Single source of truth for renderer → main calls. Each key is both the IPC channel and the
 * method name on `window.leverage`. Later tasks add entries here and a handler in main.
 */
export interface InvokeApi {
  'settings:get': () => Promise<Settings>
  'settings:set': (settings: Settings) => Promise<Settings>
  'dialog:pickFolder': (defaultPath?: string) => Promise<string | null>

  'rec:create': (init: CreateInitPayload) => Promise<{ id: string; dir: string }>
  'rec:chunk': (id: string, track: TrackKind, data: ArrayBuffer) => Promise<void>
  'rec:offset': (id: string, track: TrackKind, offsetMs: number) => Promise<void>
  'rec:disable': (id: string, track: TrackKind, reason: string) => Promise<void>
  'rec:update': (id: string, patch: Pick<Partial<RecordingManifest>, 'bubble' | 'crop'>) => Promise<void>
  'rec:finalize': (id: string, durationMs: number) => Promise<RecordingManifest>
  'rec:abort': (id: string) => Promise<void>
  'rec:list': () => Promise<RecordingManifest[]>

  'capture:list': () => Promise<CaptureSource[]>
  'capture:select': (sourceId: string) => Promise<void>

  'window:minimize': () => Promise<void>
  'window:restore': () => Promise<void>

  'region:pick': () => Promise<RegionPick | null>
  'region:submit': (result: RegionPick | null) => Promise<void>

  'recorder:status': (status: RecorderStatus) => Promise<void>
  /** Latest status, for helper windows that open after it was broadcast. */
  'recorder:current': () => Promise<RecorderStatus>
  /** From the toolbar; abort is confirmed by main before it reaches the recorder. */
  'recorder:command': (command: RecorderCommand) => Promise<void>
  'bubble:placement': () => Promise<BubblePlacement | null>
  'bubble:resize': (size: 'S' | 'M' | 'L') => Promise<void>
  'hotkeys:failed': () => Promise<string[]>

  /** outPath skips the save dialog (tests); the result never overwrites an existing file. */
  'export:mp4': (id: string, outPath?: string) => Promise<string | null>
  'export:gif': (id: string, outPath?: string) => Promise<string | null>
  'shell:showInFolder': (path: string) => Promise<void>
  /** Moves the recording folder to the Recycle Bin. */
  'rec:delete': (id: string) => Promise<void>
  'rec:dir': (id: string) => Promise<string | null>

  'edit:open': (id: string) => Promise<OpenedEdit>
  'edit:save': (id: string, edit: EditDoc) => Promise<void>
  'edit:overlayPng': (id: string, overlayId: string, data: ArrayBuffer) => Promise<void>
  /** leverage-media:// URL for a track; renderers never see file paths. */
  'edit:mediaUrl': (id: string, track: TrackKind) => Promise<string>

  /** Write-only: an empty key removes it. There is deliberately no way to read a key back. */
  'ai:setKey': (provider: 'groq' | 'openrouter', key: string) => Promise<void>
  'ai:hasKeys': () => Promise<{ groq: boolean; openrouter: boolean }>

  'whisper:status': () => Promise<{ engine: boolean; model: boolean; dir: string }>
  /** Downloads (after the user confirmed in the UI) and verifies the engine and model. */
  'whisper:install': () => Promise<void>
  'whisper:cancel': () => Promise<void>

  /** Rejects with NEEDS_INSTALL when the local engine is chosen but not installed. */
  'transcribe:run': (id: string) => Promise<Transcript>
  'transcribe:get': (id: string) => Promise<Transcript | null>
  'transcribe:cancel': (id: string) => Promise<void>
  /** Long pauses in the speech track, on the source timeline. */
  'autocut:silences': (id: string) => Promise<{ startMs: number; endMs: number }[]>
  /** Only the transcript text is sent to the provider chosen in Settings. */
  'ai:suggestCuts': (
    id: string,
    targetSeconds?: number
  ) => Promise<{ cuts: { from: number; to: number; reason: string; startMs: number; endMs: number }[]; dropped: number }>

  /** Start a capture; hides the main window first. Resolves once the shot is handled (or cancelled). */
  'snap:capture': (mode: SnapMode, delaySec?: number) => Promise<void>
  /** Overlay: PNG of its display's frozen image. */
  'snap:frozen': (displayId: string) => Promise<ArrayBuffer>
  /** Overlay: frozen image painted, show the window. */
  'snap:ready': () => Promise<void>
  'snap:select': (selection: SnapSelection | null) => Promise<void>
  'snap:list': () => Promise<SnapEntry[]>
  'snap:get': (id: string) => Promise<SnapDoc>
  'snap:image': (id: string, which: 'original' | 'rendered') => Promise<ArrayBuffer>
  /** Store an edit: the shape list plus the rendered (cropped) PNG. */
  'snap:save': (id: string, doc: SnapDoc, png: ArrayBuffer) => Promise<SnapDoc>
  'snap:copy': (id: string) => Promise<void>
  /** outPath skips the dialog (tests); never overwrites. */
  'snap:saveAs': (id: string, outPath?: string) => Promise<string | null>
  'snap:pin': (id: string) => Promise<void>
  'snap:show': (id: string) => Promise<void>
  /** Moves the PNG and its edit data to the Recycle Bin. */
  'snap:delete': (id: string) => Promise<void>

  /** Pin window controls; they act on the calling window. */
  'pin:move': (dx: number, dy: number) => Promise<void>
  'pin:zoom': (factor: number) => Promise<void>
  'pin:opacity': (delta: number) => Promise<void>
  'pin:close': () => Promise<void>

  /** Start, or stop and paste (the hotkey does the same). */
  'dictate:toggle': () => Promise<void>
  'dictate:cancel': () => Promise<void>
  'dictate:current': () => Promise<DictationStatus>
  /** Pill: the finished recording. */
  'dictate:audio': (id: string, data: ArrayBuffer, info: DictationAudioInfo) => Promise<void>
  /** Pill: the microphone could not be opened. */
  'dictate:micError': (message: string) => Promise<void>
  'dictate:history': () => Promise<DictationEntry[]>
  /** Transcribe a failed dictation again; the result is copied, not pasted. */
  'dictate:retry': (id: string) => Promise<DictationEntry>
  'dictate:copy': (id: string) => Promise<void>
  'dictate:remove': (id: string) => Promise<void>
  'dictate:clear': () => Promise<void>

  'notes:list': () => Promise<NoteEntry[]>
  'notes:get': (id: string) => Promise<NoteDoc>
  /** Only the title and the user's own notes can be changed from a page. */
  'notes:save': (id: string, patch: { title?: string; notes?: string }) => Promise<NoteDoc>
  /** Moves the note folder (and its audio) to the Recycle Bin. */
  'notes:delete': (id: string) => Promise<void>
  /** Write (or rewrite) the AI summary; only the transcript and the user's notes are sent. */
  'notes:summarize': (id: string) => Promise<NoteDoc>
  /** Transcribe and summarise again (after a failure). */
  'notes:retry': (id: string) => Promise<void>
  /** A note for a Studio recording: its transcript (made if missing), then a summary. */
  'notes:fromRecording': (recordingId: string) => Promise<NoteDoc>
  'notes:meetingStart': (title: string) => Promise<NoteDoc>
  'notes:meetingChunk': (id: string, track: 'mic' | 'system', data: ArrayBuffer) => Promise<void>
  'notes:meetingWarn': (id: string, warning: string) => Promise<void>
  /** Recording finished: transcribe and summarise in the background. */
  'notes:meetingStop': (id: string, durationMs: number) => Promise<void>
}

export type InvokeChannel = keyof InvokeApi

export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  'settings:get',
  'settings:set',
  'dialog:pickFolder',
  'rec:create',
  'rec:chunk',
  'rec:offset',
  'rec:disable',
  'rec:update',
  'rec:finalize',
  'rec:abort',
  'rec:list',
  'capture:list',
  'capture:select',
  'window:minimize',
  'window:restore',
  'region:pick',
  'region:submit',
  'recorder:status',
  'recorder:current',
  'recorder:command',
  'bubble:placement',
  'bubble:resize',
  'hotkeys:failed',
  'export:mp4',
  'export:gif',
  'shell:showInFolder',
  'rec:delete',
  'rec:dir',
  'edit:open',
  'edit:save',
  'edit:overlayPng',
  'edit:mediaUrl',
  'ai:setKey',
  'ai:hasKeys',
  'whisper:status',
  'whisper:install',
  'whisper:cancel',
  'transcribe:run',
  'transcribe:get',
  'transcribe:cancel',
  'autocut:silences',
  'ai:suggestCuts',
  'snap:capture',
  'snap:frozen',
  'snap:ready',
  'snap:select',
  'snap:list',
  'snap:get',
  'snap:image',
  'snap:save',
  'snap:copy',
  'snap:saveAs',
  'snap:pin',
  'snap:show',
  'snap:delete',
  'pin:move',
  'pin:zoom',
  'pin:opacity',
  'pin:close',
  'dictate:toggle',
  'dictate:cancel',
  'dictate:current',
  'dictate:audio',
  'dictate:micError',
  'dictate:history',
  'dictate:retry',
  'dictate:copy',
  'dictate:remove',
  'dictate:clear',
  'notes:list',
  'notes:get',
  'notes:save',
  'notes:delete',
  'notes:summarize',
  'notes:retry',
  'notes:fromRecording',
  'notes:meetingStart',
  'notes:meetingChunk',
  'notes:meetingWarn',
  'notes:meetingStop'
]

/** Main → renderer events. */
export interface EventMap {
  'settings:changed': Settings
  'library:changed': null
  'recorder:status': RecorderStatus
  /** To the main window's recorder; abort here is already confirmed. */
  'recorder:command': RecorderCommand
  'export:progress': { id: string; pct: number }
  'whisper:progress': { stage: 'engine' | 'model'; pct: number }
  'transcribe:progress': { id: string; stage: string; pct: number }
  /** Open this shot in the Snap editor (main window). */
  'snap:open': { id: string }
  'snap:changed': null
  'dictate:status': DictationStatus
  /** To the pill only. */
  'dictate:command': DictateCommand
  'dictate:historyChanged': null
  /** A note was created, changed or removed (id), or the list changed (null). */
  'notes:changed': { id: string | null }
}

export type EventChannel = keyof EventMap

export const EVENT_CHANNELS: readonly EventChannel[] = [
  'settings:changed',
  'library:changed',
  'recorder:status',
  'recorder:command',
  'export:progress',
  'whisper:progress',
  'transcribe:progress',
  'snap:open',
  'snap:changed',
  'dictate:status',
  'dictate:command',
  'dictate:historyChanged',
  'notes:changed'
]

export type LeverageApi = InvokeApi & {
  on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void
}
