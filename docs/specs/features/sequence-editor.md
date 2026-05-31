# Spec: Sequence Editor

## Overview

A **sequence part** is a type of part whose content is defined using a step-sequencer grid rather than individually entered notes. It is primarily intended for drum and percussion parts but works for any instrument. Sequence parts integrate into the existing score: they participate in playback, respect the time signature, and display a visual preview in the score.

---

## 1. Part Input Mode

### 1.1 Configuration

The Parts Panel gains a new field **Input Mode** for each part, implemented as a dropdown:

| Value | Label | Behaviour |
|---|---|---|
| `'score'` | Score | Default. Notes entered manually on the stave. All current behaviour. |
| `'sequencer'` | Sequencer | Part is driven by a step-sequencer. Stave changes appearance; clicking a bar opens the Sequence Editor view. |

### 1.2 Mode switching

- **Score → Sequencer**: Existing note events in the part are **preserved** in the data model but are not played back or displayed while the part is in sequencer mode. They are restored if the part is switched back to score mode.
- **Sequencer → Score**: Existing note events are restored. Any sequence data is preserved in the data model and restored if the part is switched back to sequencer mode.

---

## 2. Score View — Sequencer Part Display

### 2.1 Stave appearance

A sequencer-mode part renders a **track band**, not a music stave:

- **No clef**, **no key signature**.
- **No staff lines.** The five VexFlow stave lines are suppressed. In their place a subtle filled band (`rgba(0,0,0,0.06)`) spans the full stave height, and a single thin horizontal rule (`rgba(0,0,0,0.18)`, 1 px) is drawn at the vertical midpoint to delineate the part boundary.
- **Time signature** is shown on the first measure of each system (same rules as score parts).
- **Barlines** are shown normally.
- **No note or rest glyphs are rendered.** The VexFlow voice/formatter pipeline is skipped entirely for sequencer bars; the bar body shows only the mini-grid preview (§2.2).

### 2.2 Mini grid preview

Each bar of a sequencer part displays a **mini step-grid thumbnail** showing the active cells of the sequence pattern covering that bar:

- Grid cells map columns (steps) to horizontal positions, rows (pitches) to vertical positions.
- **Active cells** are drawn as small filled rectangles (`#3b9ddd` at 60% opacity).
- **Inactive cells** are not drawn (background only).
- The thumbnail is vertically compressed to fit within the stave height; pitch rows are distributed evenly across the stave height.
- Bars covered by a repetition of the same pattern show an identical thumbnail.
- Bars with no sequence attached show blank (empty band body).

### 2.3 Sequence region label

When a `SequenceRegion` has a `label` set, that label is drawn above the track band at the first bar of the region:

- Font: **bold 10 px** sans-serif, colour `#3b9ddd` (the accent blue used for grid cells).
- Positioned just above the top edge of the track band, left-aligned with the note area.
- Only shown on the first bar of the region — not repeated on subsequent bars covered by the same region.
- Regions with no explicit label default to **"Sequence N"** where N is the 1-based position of the region in the part's sorted region list.
- Bars with no region attached show nothing.

### 2.4 Note input is blocked

Sequencer-mode staves do not accept notation editing from the score view:

- In **Note Input** or **Rest Input** mode, clicks on a sequencer-mode row have no effect. The note-placement hover cursor is not shown for these rows.
- In **Select** mode, clicking opens the Sequence Editor (§3.1) as normal.
- No other interaction (drag, shift-click, keyboard note entry advancing the cursor) applies to sequencer rows.

---

## 3. Sequence Editor View

### 3.1 Activation

Clicking any bar of a sequencer-mode part in Select mode opens the Sequence Editor. The score canvas is **hidden** and the Sequence Editor takes over the full main content area. A **← Back to Score** button in the top-left returns to the score view.

The editor opens showing the sequence pattern that covers the clicked bar. If no sequence exists for that bar, a new pattern is created starting at that bar with infinite repetitions.

### 3.2 Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Score   [Part name]   [Sequence label]   [Reps: ∞ ▾] │  ← header
├──────────┬──────────────────────────────────────────────────────┤
│          │  1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16 │
│  C#5 ──  │  ■   ·   ·   ·   ■   ·   ·   ·   ■   ·   ·   ·   ■   ·   ·   · │
│  C5  ──  │  ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   · │
│ keyboard │  ...                                                  │
│  (left)  │                                                       │
└──────────┴──────────────────────────────────────────────────────┘
```

### 3.3 Keyboard / pitch labels (left column)

The left column is **instrument-aware**:

**Drum/percussion parts** (MIDI channel 10 or MIDI program 0 on channel 10):
- Shows GM percussion labels for notes 35–81 (e.g. `Bass Drum 1`, `Snare`, `Closed Hi-Hat`).
- Only notes in the GM drum range are shown.
- Row height is fixed; the full range is visible or scrollable vertically.

**All other instruments:**
- Shows a piano keyboard graphic with note names (C4, D4, etc.).
- Default visible range: **C2 – B5** (4 octaves, 48 rows).
- Scrollable vertically to reach notes outside the visible range.
- Clicking a key on the keyboard previews that pitch via the audio engine (same as sound-on-input behaviour).

### 3.4 Grid

- **Columns** = steps per bar. Default: 16 (one per 16th note). Number of columns is determined by the time signature: `(numerator / denominator) × 16`. E.g. 4/4 → 16 columns; 3/4 → 12 columns.
- **Rows** = pitches (see §3.3).
- **Cell states**: on (filled `#3b9ddd`) or off (unfilled, `rgba(255,255,255,0.05)` background).
- **Toggle**: click a cell to toggle it on/off.
- **Click-drag**: dragging across cells turns them all on (or all off, matching the state of the first cell in the drag).
- Column headers show beat numbers (1–4 for 4/4) with subdivisions indicated by lighter separators.

### 3.5 Velocity

All active cells default to velocity **127**. Velocity editing is deferred to a future iteration. The data model stores velocity per cell so this can be added without a schema change.

---

## 4. Sequence Data Model

### 4.1 Types

```typescript
interface SequenceCell {
  pitch: number     // MIDI note number (0–127)
  velocity: number  // 1–127, default 127
}

interface SequencePattern {
  id: string
  steps: SequenceCell[][]   // outer = step column; inner = active cells in that column
  stepsPerBar: number
  label?: string            // user-visible name, e.g. "Verse", "Chorus"
}

// Pins a pattern (or silence) to a bar. The pattern plays from startMeasureIndex
// until the next assignment's startMeasureIndex (exclusive).
interface SequenceAssignment {
  id: string
  patternId: string | null  // null = explicit silence from this bar
  startMeasureIndex: number
}
```

### 4.2 Part schema

```typescript
interface Part {
  // ... existing fields
  inputMode?: 'score' | 'sequencer'       // defaults to 'score' when absent
  sequencePatterns?: SequencePattern[]
  sequenceAssignments?: SequenceAssignment[]
}
```

### 4.3 Assignment semantics

- Assignments are sorted by `startMeasureIndex` and are non-overlapping per bar.
- The **active assignment** at measure N is the one with the largest `startMeasureIndex ≤ N`.
- A pattern plays from its assignment's `startMeasureIndex` until the next assignment starts.
- `patternId: null` means explicit silence from that bar onwards (until the next assignment).
- The same pattern can be assigned at multiple bars (e.g. bars 0 and 6 both use "Verse").
- At most one assignment exists per bar — assigning a pattern to bar N replaces any existing assignment at that bar.

---

## 5. Score View — Bar Assignment Dropdown

Clicking a sequencer-mode bar in **Select** mode opens a small dropdown at the click position:

- A header row shows "Assign sequence" and a **✕** close button.
- Lists all patterns defined for this part, each showing its label (or "Sequence N" default).
- The currently active pattern at that bar is marked with a checkmark.
- **(empty)** is always the default state (no assignment). Shown with a checkmark when the bar has no active pattern. Selecting it when a pattern is active sets `patternId: null` from that bar, producing silence.
- **Edit patterns…** opens the Sequence Editor (§6).

---

## 6. Sequence Editor View

### 6.1 Activation

Opened via "Edit patterns…" in the bar dropdown, or directly via the Parts Panel. The editor navigates between **patterns** (not assignments).

### 6.2 Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Score   [Part name]   [Pattern label]   ‹ Prev  Next › + New Sequence │
├──────────┬──────────────────────────────────────────────────────┤
│          │  1   2   3   4   5   6   7   8  …                    │
│  C#5 ──  │  ■   ·   ·   ·   ■   ·   ·   ·  …                   │
│  C5  ──  │  ·   ·   ·   ·   ·   ·   ·   ·  …                   │
│ (labels) │                                                       │
└──────────┴──────────────────────────────────────────────────────┘
```

The Reps control has been removed. Navigation (`‹ Prev` / `Next ›`) moves between patterns, not assignments.

### 6.3 Pattern label

The label is a property of the `SequencePattern`. Clicking it in the header makes it editable inline. Clearing the label reverts to the "Sequence N" default.

### 6.4 Keyboard / pitch labels — unchanged from original §3.3

### 6.5 Grid — unchanged from original §3.4

---

## 7. Playback Integration

For each measure in the playback sequence, find the active assignment (largest `startMeasureIndex ≤ currentMeasure`). If it references a pattern, emit that pattern's step events for the measure. `patternId: null` produces silence.

---

## 8. Commands

```typescript
| { type: 'SET_PART_INPUT_MODE';        partId: string; mode: 'score' | 'sequencer' }
| { type: 'UPSERT_SEQUENCE_PATTERN';    partId: string; pattern: SequencePattern }
| { type: 'DELETE_SEQUENCE_PATTERN';    partId: string; patternId: string }
| { type: 'SET_SEQUENCE_ASSIGNMENT';    partId: string; assignment: SequenceAssignment }
| { type: 'DELETE_SEQUENCE_ASSIGNMENT'; partId: string; assignmentId: string }
| { type: 'SET_SEQUENCE_CELL';          partId: string; patternId: string; step: number; pitch: number; on: boolean; velocity?: number }
```

`SET_SEQUENCE_CELL` is the hot-path command for toggling grid cells and must be dispatched without triggering a full undo snapshot per cell (drag-to-fill accumulates a single undo step, flushed on mouseup).

## 9. MIDI & MusicXML Export

### 9.1 MIDI export

Sequence parts are expanded inline: for each measure in the export sequence, `buildSequenceSchedule` resolves the active assignment and emits one MIDI note per active cell (pitch from `cell.pitch`, velocity from `cell.velocity`, duration = one step). No MIDI repeat markers are used. `patternId: null` assignments produce no events. Channel always follows the part's MIDI channel setting — it is never overridden by the export. When a new drum part is created, its channel defaults to 10, but the user may change it via the Parts Panel.

### 9.2 MusicXML export

Sequence parts are expanded to regular `<note>` elements: each active cell becomes a pitched note (or `<unpitched>` for channel-10 parts) of duration `1/stepsPerBar` bars. Steps with no active cells produce rests of the same duration. Measures before the first assignment, or covered by a `null` assignment, are filled with whole rests. MIDI pitch → `<pitch>` conversion uses the standard `pitch = 12*(octave+1) + semitone` mapping. Channel-10 parts use `<clef sign="percussion">` and `<unpitched>` elements.

## 10. Stock Drum Rhythms

### 10.1 Overview

When editing a drum part in the Sequence Editor, the header toolbar shows a **Load rhythm…** button. Clicking it opens a dropdown listing all stock rhythms compatible with the score's current time signature. Rhythms whose required time signature does not match are omitted entirely.

The button is visible only when:
- The part is a drum part (MIDI channel 10), **and**
- At least one stock rhythm is compatible with the current time signature.

### 10.2 Load behaviour

Selecting a stock rhythm populates the **current pattern's** cells with the preset's step data:

- If the current pattern already has at least one active cell, a brief inline confirmation ("Replace current pattern with [name]? [Yes] [Cancel]") is shown before applying.
- All existing cells are cleared first, then the preset cells are written.
- The entire operation is a single undoable step (one undo snapshot, not one per cell).
- The pattern's `stepsPerBar` is left unchanged; the preset's `stepsPerBar` always matches the current time signature, so no mismatch is possible.

### 10.3 Available stock rhythms

| Name | Time signature | Character |
|---|---|---|
| 8 Beat | 4/4 | Standard rock — kick on 1 & 3, snare on 2 & 4, 8th-note hi-hats |
| 16 Beat | 4/4 | Active feel — 16th-note hi-hats throughout |
| Shuffle | 4/4 | Swing-feel approximation at 16th-note resolution |
| Half-time | 4/4 | Snare on beat 3 only — hip-hop / ballad feel |
| Bossa Nova | 4/4 | Syncopated Latin pattern with rim-shot and closed hi-hat |
| Reggae | 4/4 | One-drop feel with off-beat hi-hat emphasis |
| Waltz | 3/4 | Classic 3-beat dance rhythm — kick on 1, hi-hat on all three beats |
| Ballad | 6/8 | Lilting compound feel — kick on the two dotted-quarter beats |

### 10.4 Data format

Stock rhythms are stored in `resources/drumRhythms.json` as a top-level array. Each entry:

```json
{
  "id": "8-beat",
  "name": "8 Beat",
  "timeSig": { "numerator": 4, "denominator": 4 },
  "stepsPerBar": 16,
  "cells": [
    { "pitch": 42, "steps": [0, 2, 4, 6, 8, 10, 12, 14] },
    { "pitch": 36, "steps": [0, 8] },
    { "pitch": 38, "steps": [4, 12] }
  ]
}
```

- `pitch` — GM percussion MIDI note number (35–81).
- `steps` — 0-based step indices within the bar.
- `velocity` — omitted; defaults to **100** when applied.
- `stepsPerBar` must equal `Math.round((timeSig.numerator / timeSig.denominator) × 16)`.

## 11. Deferred / Out of Scope

- Step granularity configuration (currently fixed at 16th notes)
- Per-cell velocity editing
- Pattern copy/paste between regions
- Swing/humanise
- Cross-part sequence sharing
- Playback cursor shown within the sequence editor grid