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

A sequencer-mode part renders a simplified stave:
- **No clef**, **no key signature**.
- **Time signature** is shown normally.
- **Barlines** are shown normally.
- Stave lines are rendered at reduced opacity (`rgba(255,255,255,0.15)`) to visually distinguish the row from score parts.

### 2.2 Mini grid preview

Each bar of a sequencer part displays a **mini step-grid thumbnail** showing the active cells of the sequence pattern covering that bar:

- Grid cells map columns (steps) to horizontal positions, rows (pitches) to vertical positions.
- **Active cells** are drawn as small filled rectangles (`#3b9ddd` at 60% opacity).
- **Inactive cells** are not drawn (background only).
- The thumbnail is vertically compressed to fit within the stave height; pitch rows are distributed evenly across the stave height.
- Bars covered by a repetition of the same pattern show an identical thumbnail.
- Bars with no sequence attached show blank (empty stave body).

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

### 4.1 New types

```typescript
interface SequenceCell {
  pitch: number     // MIDI note number (0–127)
  velocity: number  // 1–127, default 127
}

interface SequencePattern {
  id: string
  // Outer index = step column (0 to stepsPerBar-1)
  // Inner array = active cells in that column (empty = no notes on this step)
  steps: SequenceCell[][]
  stepsPerBar: number   // snapshot of step count when pattern was created
}

interface SequenceRegion {
  id: string
  patternId: string
  startMeasureIndex: number
  repetitions: number | null  // null = repeat to end of score
}
```

### 4.2 Part schema additions

```typescript
interface Part {
  // ... existing fields
  inputMode?: 'score' | 'sequencer'   // defaults to 'score' when absent
  sequencePatterns?: SequencePattern[]
  sequenceRegions?: SequenceRegion[]
}
```

### 4.3 Region semantics

- Regions are non-overlapping and sorted by `startMeasureIndex`.
- A region covers bars `[startMeasureIndex, startMeasureIndex + (repetitions ?? Infinity))`.
- When a new sequence is created at bar N, any existing region whose coverage includes bar N is **truncated** to end at bar N−1 (its `repetitions` is reduced accordingly).
- A region with `repetitions: null` extends to the end of the score or until the next region starts, whichever comes first.

---

## 5. Repetitions Control

The header bar of the Sequence Editor shows a **Reps** control:

- Displays `∞` (infinite) or a number (1–999).
- Clicking opens a small dropdown: `[∞] [1] [2] [4] [8] [Custom…]`.
- Changing repetitions updates the `SequenceRegion` and may truncate/restore the following region accordingly.

---

## 6. Sequence Navigation

From the editor header, the user can navigate between sequences defined for the current part:

- `‹ Prev` / `Next ›` buttons move between `SequenceRegion` entries for this part.
- Each region can be given an optional label (e.g. "Verse", "Chorus"). Displayed in the header; editable by clicking it.

---

## 7. Playback Integration

Sequence patterns are resolved to note events at playback time in `buildFlatSchedule` / the audio engine:

1. For each sequencer-mode part, iterate over `sequenceRegions`.
2. For each measure covered by a region, read the `SequencePattern.steps`.
3. For each column `c` in `steps`, compute `startBeat = c / stepsPerBar` (in beats within the measure).
4. For each active cell in that column, emit a note event with the cell's pitch, velocity, and a duration of one step (1/stepsPerBar of a bar).
5. These synthetic note events enter the same scheduling pipeline as regular note events.

No changes are required to the MIDI output engine — synthetic events are indistinguishable from regular ones by the time they reach the scheduler.

---

## 8. Commands

```typescript
| { type: 'SET_PART_INPUT_MODE';    partId: string; mode: 'score' | 'sequencer' }
| { type: 'UPSERT_SEQUENCE_PATTERN'; partId: string; pattern: SequencePattern }
| { type: 'UPSERT_SEQUENCE_REGION';  partId: string; region: SequenceRegion }
| { type: 'DELETE_SEQUENCE_REGION';  partId: string; regionId: string }
| { type: 'SET_SEQUENCE_CELL';       partId: string; patternId: string; step: number; pitch: number; on: boolean; velocity?: number }
```

`SET_SEQUENCE_CELL` is the hot-path command for toggling grid cells and must be dispatched without triggering a full undo snapshot per cell (drag-to-fill accumulates a single undo step, flushed on mouseup).

---

## 9. Deferred / Out of Scope

- Step granularity configuration (currently fixed at 16th notes)
- Per-cell velocity editing
- Pattern copy/paste between regions
- Swing/humanise
- Cross-part sequence sharing
- Playback cursor shown within the sequence editor grid
