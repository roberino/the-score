# Spec: Note Input

## Overview

This spec defines step-time note input — the primary workflow for entering notes and rests into the score. The user selects a duration, then enters a pitch via keyboard or mouse click. A cursor advances through the score after each entry.

---

## Goals

- Allow users to enter notes and rests into any measure at any cursor position
- Support pitch entry via letter keys (A–G) and mouse click on the staff
- Support duration selection via number keys (1–7) with optional dot modifier
- Show a visible input cursor indicating where the next note will be placed
- Enforce correct measure filling (no overfull measures; advance cursor to next measure automatically)

---

## Out of Scope

- MIDI keyboard input (Phase 3)
- Chord input (multiple noteheads on a single stem)
- Lyrics, dynamics, and articulation input
- Multi-voice (polyphonic) input — voice 0 only for this spec
- Tuplet input

---

## Input Modes

The toolbar exposes four mutually exclusive input modes. This spec covers **Note**, **Rest**, and **Select** modes. The mode is stored in `appStore.inputMode`.

| Mode    | Toolbar Key | Cursor style         |
|---------|-------------|----------------------|
| Select  | `S`         | Pointer (no cursor)  |
| Note    | `N`         | Note input cursor    |
| Rest    | `R`         | Rest input cursor    |
| Eraser  | `E`         | Eraser (existing)    |

Pressing `Escape` at any time exits note/rest input and returns to Select mode.

---

## Input Cursor

When Note or Rest mode is active, a cursor highlights the current input position within the score.

### Cursor State

```
cursorMeasureId: string | null
cursorVoice: 0                    // voice 0 only in this spec
cursorBeatPosition: number        // beat offset within the measure (0 = beat 1)
```

The cursor state lives in `appStore`. It is `null` when in Select or Eraser mode.

### Cursor Appearance

- A thin vertical bar (similar to a text insertion point) drawn on the canvas just before the next available beat position
- If the cursor is at a position occupied by an existing note, highlight that note with a blue tint instead of drawing the bar

### Cursor Placement

- Clicking anywhere on the canvas while in Note or Rest mode moves the cursor to the nearest valid beat position in the clicked measure
- If the measure is full, the cursor cannot be placed there
- On entering Note or Rest mode, the cursor defaults to the first empty beat of the first measure

### Cursor Advancement

After a note or rest is successfully entered, the cursor advances to the next beat position:
- If space remains in the current measure, advance by the duration just entered
- If the measure is now full, advance to beat 0 of the next measure
- If the last measure is full, do not advance (entry stops at the score boundary)

### Cursor Navigation

While in Note or Rest mode, the left and right arrow keys move the cursor without entering any note or rest:

| Key | Effect |
|-----|--------|
| `←` (ArrowLeft) | Move cursor to the start of the previous event |
| `→` (ArrowRight) | Move cursor to the start of the next event |

- Moving **right** past the last event of a measure advances to the first event of the next measure
- Moving **left** from the first event of a measure jumps to the last event of the previous measure
- At the score boundary (first event of first measure / last event of last measure) the key has no effect
- In Note mode, `ArrowLeft`/`ArrowRight` take priority over accidental priming (`↑`/`↓`)

---

## Note Input Mode

### Duration Selection

The active duration is stored in `appStore.selectedDuration`. It persists across note entries until changed.

| Key | Duration  |
|-----|-----------|
| `1` | 64th note |
| `2` | 32nd note |
| `3` | 16th note |
| `4` | Eighth note |
| `5` | Quarter note (default on entering note mode) |
| `6` | Half note |
| `7` | Whole note |
| `.` | Toggle one augmentation dot on the active duration |

Selecting a duration does not enter a note — it only changes the active duration.

### Pitch Entry via Keyboard

While in Note mode with the score focused, pressing a letter key `A`–`G` enters a note at that pitch using the active duration and places it at the cursor position.

**Octave selection:** The entered note uses the octave closest to the previous note (within a fourth, preferring upward). If no previous note exists, use octave 4.

**Accidentals:** Before pressing a pitch key, the user may prime an accidental:

| Key        | Accidental    |
|------------|---------------|
| `Up arrow` | Sharp (`#`)   |
| `Down arrow` | Flat (`b`) |
| `0`        | Natural       |

The primed accidental applies to the next pitch key pressed and then clears. If no accidental is primed, the note inherits the key signature (no accidental displayed unless it contradicts the key).

**Octave nudge (post-entry):** After entering a note, while it remains selected:

| Key           | Effect               |
|---------------|----------------------|
| `Ctrl+Up`     | Raise one octave     |
| `Ctrl+Down`   | Lower one octave     |

### Pitch Entry via Mouse Click

Clicking on the staff canvas while in Note mode:

1. Determines which measure was clicked from the rendered layout
2. Maps the vertical click position to a staff line/space → pitch
3. Snaps the cursor to the nearest valid beat position at that horizontal position
4. Enters a note at the resolved pitch and cursor position using the active duration

Staff-to-pitch mapping is based on the clef of the clicked staff. Clicks above or below the staff use ledger line positions (up to 3 ledger lines above/below).

### Measure Fill Enforcement

Before placing a note, calculate whether the remaining beat capacity of the measure accommodates the active duration.

- If the note fits: place it and advance the cursor
- If the note does not fit: do not place it; flash the cursor briefly to indicate the measure is full
- Do not automatically split notes across barlines in this spec

---

## Rest Input Mode

Rest input behaves identically to Note input except:

- Letter keys `A`–`G` and mouse clicks **do not** enter a rest — the pitch is irrelevant
- Pressing `Space` or `Enter` enters a rest of the active duration at the cursor position
- Accidental priming has no effect in Rest mode
- The cursor advances by the rest's duration after entry

---

## Select Mode

### Selecting a Note

- Clicking a notehead selects it (highlighted in blue)
- Only one note may be selected at a time in this spec
- Selected note ID is stored in `appStore.selectedNoteId`
- Clicking empty canvas deselects

### Editing a Selected Note

With a note selected:

| Key | Effect |
|-----|--------|
| `1`–`7` | Change duration (dispatches `SET_NOTE_DURATION`) |
| `.` | Toggle dot on selected note |
| `Up arrow` | Raise pitch by a half step (re-dispatches `ADD_NOTE` replacing the old note) |
| `Down arrow` | Lower pitch by a half step |
| `Ctrl+Up` | Raise pitch by an octave |
| `Ctrl+Down` | Lower pitch by an octave |

Duration changes that would cause the measure to overflow are rejected.

### Deleting a Note

| Key | Effect |
|-----|--------|
| `Backspace` or `Delete` | Remove selected note (dispatches `DELETE_NOTE`); selection clears |

---

## Commands Dispatched

All mutations use the existing command pattern in `src/shared/commands.ts`.

| Action | Command |
|--------|---------|
| Enter note | `ADD_NOTE` |
| Enter rest | `ADD_NOTE` (with `isRest: true` on the note type) |
| Change selected note duration | `SET_NOTE_DURATION` |
| Delete selected note | `DELETE_NOTE` |

---

## Store Changes Required

The following fields are added to `appStore`:

| Field | Type | Description |
|-------|------|-------------|
| `selectedDuration` | `Duration` | Active input duration (default: `"quarter"`) |
| `isDotted` | `boolean` | Whether active duration is dotted |
| `primedAccidental` | `Accidental \| null` | Accidental to apply to the next pitch key |
| `cursorMeasureId` | `string \| null` | Measure the cursor is in |
| `cursorBeatPosition` | `number` | Beat offset within the cursor measure |

---

## Sound on Input

### Overview

When enabled, each note entered into the score sounds briefly (~0.4 s) so the user can hear the pitch as they input it.

### Toggle

A **Sound** button in the toolbar's top row toggles `soundOnInput` in `appStore`. The button is visually active (green accent) when enabled. Default: **off**.

### Behaviour

- Fires immediately when a note is placed (keyboard pitch key, virtual keyboard, MIDI device, or canvas click in note mode)
- Preview duration is fixed at **0.4 s** regardless of the notated duration
- Rests do **not** trigger a preview
- Matches the **active part's** instrument context:
  - Volume follows the part volume and any dynamics directive in effect at the cursor measure
  - Pizz./arco envelope follows any expression directive in effect at the cursor measure
  - Transposes by the part's `transposeSemitones` so transposing instruments sound at their written pitch

### Implementation

- `notePreview.ts`: singleton `Tone.Synth` (separate from playback `PolySynth`); `previewNote(hz, volumeDb, isPizz)` function
- Preview synth is created lazily on first use; persists for the session (no dispose on playback stop)
- `Tone.start()` is called inside `previewNote` (user gesture guarantee is met by key/mouse events that trigger note entry)

### Store Changes

| Field | Type | Description |
|-------|------|-------------|
| `soundOnInput` | `boolean` | Whether to sound notes on entry (default: `false`) |

---

## Acceptance Criteria

1. Pressing `N` activates Note mode; pressing `Escape` returns to Select mode
2. Pressing `5` then `C` enters a quarter-note C at the cursor position
3. The cursor advances to the next beat after each note entry
4. The cursor advances to the next measure when a measure is filled exactly
5. Attempting to enter a note that would overflow the measure produces no entry and a visual rejection signal
6. Pressing `Up arrow` then `C` enters C# (in a key where C is natural)
7. Mouse click on the third space of a treble staff enters a C (two ledger lines below)
8. In Select mode, clicking a note selects it (blue highlight); pressing `Delete` removes it
9. Duration key `6` followed by `.` produces a dotted half note
10. `Ctrl+Up` on a selected note raises it by one octave
11. In Note or Rest mode, `ArrowRight` moves the cursor to the next event without entering a note; `ArrowLeft` moves it back
12. Arrow cursor navigation wraps correctly across measure boundaries
