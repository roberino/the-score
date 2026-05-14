# Spec: MIDI Import / Export

## Overview

This spec defines bidirectional MIDI file support: exporting the current score as a standard MIDI file, and importing a MIDI file into a new score. The `@tonejs/midi` library handles MIDI binary encoding and decoding.

---

## Goals

- Export the score to a `.mid` file that plays correctly in any DAW or media player
- Import a `.mid` file and produce a playable notation score with correctly pitched notes in the right measures
- Preserve time signature and tempo on both paths
- Require no changes to the core Score model

---

## Out of Scope

- Multi-part / multi-track export (voice 0 of part 0 only in this iteration)
- Importing multiple tracks simultaneously (first track with notes only)
- Round-trip fidelity: ties, slurs, articulations, lyrics, repeat signs
- Velocity per note (fixed at 0.8 on export; ignored on import)
- MIDI real-time input (live keyboard recording)
- MusicXML (separate future spec)

---

## MIDI Export

### Trigger

**File → Export as MIDI…** (new menu item, `Cmd/Ctrl+Shift+M`).

The menu sends `menu:exportMidi` to the renderer. The renderer converts the score to MIDI bytes and invokes `electronAPI.exportMidi(bytes)` which opens a Save dialog and writes the file.

### What is exported

| Score element | MIDI representation |
|---|---|
| `score.tempo` | Tempo meta-event at tick 0 (μs per beat = 60 000 000 / BPM) |
| `score.timeSignature` | Time signature meta-event at tick 0 |
| `score.keySignature` | Key signature meta-event at tick 0 |
| Note event | Note-on + note-off pair at the correct tick offset |
| Rest event | Gap (no note) — silence for the rest's duration |
| Chord event | Multiple simultaneous note-on / note-off pairs |
| Part name | Track name meta-event |

### Tick resolution

PPQ (pulses per quarter note) = **480** (common DAW default, supported by `@tonejs/midi`).

Duration → ticks:

```
ticks = beats × PPQ
beats = DURATION_BEATS[duration] × dotFactor
dotFactor = dots=0 → 1.0, dots=1 → 1.5, dots=2 → 1.75
```

### MIDI file format

Standard MIDI Type 0 (single track). Simple and maximally compatible.

### Pitch encoding

```
semitone = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }
           + accidental offset (sharp+1, flat−1, doubleSharp+2, doubleFlat−2)
midi = (octave + 1) × 12 + semitone
```

Middle C = C4 = MIDI 60. A4 = MIDI 69.

---

## MIDI Import

### Trigger

**File → Import MIDI…** (new menu item). Opens an Open dialog filtered to `.mid` / `.midi` files. Replaces the current score (with the same "unsaved changes?" guard used by File → New in future, skipped for now).

The menu sends `menu:importMidi`. The renderer invokes `electronAPI.importMidi()`, receives the file bytes, converts to a Score, and calls `loadScore`.

### What is imported

| MIDI element | Score result |
|---|---|
| First non-empty track | Voice 0 of Part 0, Staff 0 |
| Tempo (first tempo event) | `score.tempo` |
| Time signature (first event) | `score.timeSignature` |
| Key signature (first event) | `score.keySignature` |
| Note events | Note or Chord events (notes at same tick → Chord) |
| Gaps between notes | Rest events of the nearest quantised duration |

### Quantisation

MIDI note durations are continuous; the Score model is discrete. Each note's duration is snapped to the nearest value from this table (beats at denominator=4):

| Duration | Beats | Dotted |
|---|---|---|
| Whole | 4 | 6 |
| Half | 2 | 3 |
| Quarter | 1 | 1.5 |
| Eighth | 0.5 | 0.75 |
| 16th | 0.25 | 0.375 |
| 32nd | 0.125 | 0.1875 |
| 64th | 0.0625 | — |

Snapping uses nearest-distance. Duration below 0.05 beats is discarded.

### Chord detection

Notes whose `ticks` values are equal (or within 5 ticks of each other) are grouped into a `Chord` event. The chord's duration is the duration of the longest note in the group.

### Pitch decoding

```
octave    = floor(midi / 12) − 1
semitone  = midi % 12
```

Semitone → note name (sharps preferred):

| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C | C# | D | D# | E | F | F# | G | G# | A | A# | B |

### Measure assembly

1. Compute measure capacity in beats = `numerator × (4 / denominator)`.
2. Walk the quantised note/rest sequence in order, filling measures.
3. When a note would overflow a measure, truncate it at the barline (discard remainder). This preserves measure structure at the cost of small rounding errors.
4. Add whole-rest auto-fill at the end of the last measure if it is not full.
5. Append empty measures to reach at least 8 (the score default).

---

## IPC / Preload changes

MIDI files are binary. New IPC channels pass `Uint8Array` (renderer) ↔ `Buffer` (main).

### New IPC handlers (main process)

```
midi:export  { bytes: Buffer }     → { success: boolean }
midi:import  ()                    → { bytes: Buffer; path: string } | null
```

### New preload methods

```typescript
exportMidi: (bytes: Uint8Array) => Promise<{ success: boolean }>
importMidi: ()                   => Promise<{ bytes: Uint8Array; path: string } | null>
```

---

## Menu changes

| Item | Location | Accelerator | Channel |
|---|---|---|---|
| Export as MIDI… | File menu, after Export as PDF | `Cmd/Ctrl+Shift+M` | `menu:exportMidi` |
| Import MIDI… | File menu, after Export as MIDI | — | `menu:importMidi` |

---

## Module: `midiEngine.ts`

Located at `src/renderer/engine/midiEngine.ts`. Pure functions, no React or store imports.

```typescript
export function scoreToMidi(score: Score): Uint8Array
export function midiToScore(bytes: Uint8Array): Score
```

---

## Acceptance Criteria

### Export
1. File → Export as MIDI… opens a Save dialog filtered to `.mid`.
2. The exported file opens in GarageBand / MuseScore / similar and plays the correct pitches in the correct order.
3. Note durations are proportionally correct (quarter note = half the duration of a half note).
4. Dotted notes are 1.5× the length of the equivalent plain note.
5. Rests produce silence for the correct duration.
6. A chord exports all pitches sounding simultaneously.
7. The file's tempo matches `score.tempo`.

### Import
8. File → Import MIDI… opens an Open dialog filtered to `.mid` / `.midi`.
9. Importing a file with 4/4 time signature and C major key produces a score with those settings.
10. A C4 quarter note in the MIDI file appears as a quarter-note C4 in the score.
11. Notes at the same tick position are imported as a chord.
12. Gaps between notes produce rest events of the nearest quantised duration.
13. Importing replaces the current score.
