# Virtual Keyboard

## Overview

A floating piano keyboard that provides a mouse/touch alternative to letter-key note entry, and serves as the UI anchor point for the note-input abstraction layer that future MIDI device input will also use.

---

## UI

### Layout

```
┌─────────────────────────────────────────────── Virtual Keyboard ──── [×] ─┐
│  ◄  C4                                                               C6  ► │
│  ┌──┬─┬─┬──┬─┬─┬─┬──┬─┬─┬──┬─┬─┬─┐                                       │
│  │  │▓│ │  │▓│ │▓│  │▓│ │  │▓│ │▓│  (2 octaves, black keys overlaid)      │
│  │ C│ │D│ E│ │F│ │ G│ │A│ B│ │C│ …│                                       │
│  └──┴─┴─┴──┴─┴─┴─┴──┴─┴─┴──┴─┴─┴─┘                                       │
└───────────────────────────────────────────────────────────────────────────┘
```

- Fixed position, bottom-centre of viewport (CSS `position: fixed`).
- Not draggable (can be revisited).
- White key: 28 × 80 px. Black key: 18 × 50 px, overlaid.
- 2 octaves shown; ◄ / ► buttons shift the visible window down/up one octave.
- Default visible range: C4 – B5.

### Toggle

| Trigger        | Action                   |
|----------------|--------------------------|
| Toolbar "Keys" button | Toggle visible/hidden |
| `K` key        | Toggle visible/hidden    |

The keyboard is hidden by default. It may be shown in any input mode; pressing a key always enters a note (the keyboard implies note-entry intent).

### Key behaviour

Clicking (or eventually touch-pressing) a key:

1. Switches input mode to `note` if not already in it.
2. Calls the shared `NoteInputHandler` with `{ noteName, octave, accidental? }`.
3. The handler enters the note at the cursor using the currently selected duration and dot state, then advances the cursor — identical to pressing a letter key.

Accidentals: black keys carry `accidental: 'sharp'`. The handler overrides `primedAccidental` for that one note entry.

---

## Note-input abstraction layer

All note sources (virtual keyboard, future MIDI device) share one handler type:

```ts
// src/renderer/services/noteInputService.ts
export interface NoteInput {
  noteName: NoteName
  octave:   number
  accidental?: 'sharp' | 'flat' | 'natural'
  velocity:  number   // 0–127 (virtual keyboard always sends 100)
}

export type NoteInputHandler = (input: NoteInput) => void
```

`ScoreCanvas` owns the live handler (it has access to the full cursor + score state). It exposes a stable ref so external services can call it without re-registering on every render.

```
VirtualKeyboard ─────────┐
                          ▼
MIDI device ──► MidiService ──► noteInputHandlerRef.current()
                                          │
                                    ScoreCanvas
                                  (enters note, advances cursor)
```

---

## MIDI input service

**File**: `src/renderer/services/midiService.ts`

Uses `navigator.requestMIDIAccess()` (Web MIDI API, available in Electron's Chromium renderer with no extra permissions).

```ts
export class MidiService {
  connect(): Promise<boolean>          // requests MIDI access, wires listeners
  disconnect(): void                   // releases all listeners
  subscribe(h: NoteInputHandler): () => void  // returns unsubscribe fn
  get connected(): boolean
  get inputNames(): string[]           // names of detected input devices
}

export const midiService = new MidiService()   // singleton
```

### MIDI note-on → NoteInput

```
MIDI note number  →  octave = floor(note / 12) - 1
                      noteInOctave = note % 12
```

Chromatic map (12 entries):

| Index | Note | Accidental |
|-------|------|------------|
| 0     | C    |            |
| 1     | C    | sharp      |
| 2     | D    |            |
| 3     | D    | sharp      |
| 4     | E    |            |
| 5     | F    |            |
| 6     | F    | sharp      |
| 7     | G    |            |
| 8     | G    | sharp      |
| 9     | A    |            |
| 10    | A    | sharp      |
| 11    | B    |            |

Only MIDI Note-On (status `0x9n`) with `velocity > 0` triggers entry. Note-Off and zero-velocity Note-On are ignored (the app uses fixed durations, not held-note durations).

### `useMidiInput` hook

```ts
// src/renderer/hooks/useMidiInput.ts
export function useMidiInput(handler: NoteInputHandler | null): { connected: boolean; inputNames: string[] }
```

Connects `midiService` on mount, subscribes `handler`, disconnects on unmount. Used by `ScoreCanvas`.

---

## Store additions

```ts
keyboardVisible: boolean      // default false
toggleKeyboard: () => void
```

---

## Component: `VirtualKeyboard`

**File**: `src/renderer/components/VirtualKeyboard.tsx`

```ts
interface VirtualKeyboardProps {
  onNotePress: (input: NoteInput) => void
  onClose: () => void
}
```

### Internal state

```ts
baseOctave: number   // leftmost octave shown (default 4)
```

### Rendering

Two passes over the 2-octave range:
1. White keys: 14 `<div>` elements in a row.
2. Black keys: absolutely positioned over the white-key row.

Each key `onMouseDown` (not `onClick`) fires `onNotePress` immediately — `onMouseDown` gives faster feedback and avoids the 300 ms delay.

Key visual states:
- Default: white / dark-grey background.
- Active (pointer held): highlighted blue.
- `C` keys: show octave label at bottom (e.g. "C4").

---

## Files changed

| File | Change |
|------|--------|
| `src/renderer/store/appStore.ts` | Add `keyboardVisible`, `toggleKeyboard` |
| `src/renderer/services/midiService.ts` | **new** — Web MIDI abstraction singleton |
| `src/renderer/hooks/useMidiInput.ts` | **new** — hook wiring MidiService → handler |
| `src/renderer/components/VirtualKeyboard.tsx` | **new** — floating piano UI |
| `src/renderer/components/ScoreCanvas.tsx` | Add `enterNoteAtPitch`, render `VirtualKeyboard`, wire K shortcut, call `useMidiInput` |
| `src/renderer/components/Toolbar.tsx` | Add "Keys" toggle button |

---

## Out of scope (this iteration)

- Draggable keyboard position
- Note-off / sustain pedal handling
- Velocity-sensitive note volume from virtual keyboard
- MIDI clock sync
- Displaying which keys are currently sounding during playback
- MIDI output (sending to external synths)
