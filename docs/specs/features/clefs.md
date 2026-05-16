# Spec: Clefs

## Overview

Adds full clef support to the score editor: all five clef types (treble, bass, alto, tenor, percussion), mid-score clef changes at measure boundaries, and a canvas-click picker to change the clef on any displayed clef symbol.

---

## Out of Scope

- Courtesy clefs (small clef shown at end of a system line before a mid-score change)
- Octave-transposing clefs (treble-8vb, bass-8va, etc.)
- Clef changes inside a measure (only at measure boundaries)
- Per-voice clef assignment

---

## Clef Types

| Type | Symbol | Middle C position | Use |
|------|--------|------------------|-----|
| `treble` | G clef | 1st ledger line below (step 10) | Default; strings, winds |
| `bass` | F clef | 2nd ledger line below (step 12) | Low strings, brass, bass |
| `alto` | C clef, 3rd line | Middle (3rd) line (step 4) | Viola |
| `tenor` | C clef, 4th line | 4th line (step 6) | Cello high passages, trombone |
| `percussion` | Neutral | Falls back to treble for pitch entry | Drums, unpitched instruments |

---

## Data Model

No schema changes required. The model already has:

- `Staff.clef: ClefType` — the initial clef for the entire staff (default: `'treble'`)
- `Measure.clef?: { type: ClefType }` — an optional clef change at this measure boundary

### Resolution rule

The effective clef for measure N is the first explicit `measure.clef` found scanning backward from N, or `staff.clef` if none is found:

```
resolveClef(measures, idx, staff.clef)
```

### `SET_CLEF` command

Already declared in the Command union. Handler logic:

- If the target is measure 0: update `staff.clef` to the new value and delete any `measure.clef` on measure 0 (measure-level overrides are not stored for the first measure).
- For any other measure: set `measure.clef = { type: command.clef }` on that measure.

---

## Rendering

### Clef display rules

| Situation | Show clef? | Size |
|-----------|-----------|------|
| First measure of a system line | Always | Default |
| Mid-system measure with a clef change | Yes | Small |
| Mid-system measure with no clef change | No | — |

### Width accounting

A mid-score clef change adds `PREAMBLE_CLEF` (30 px) to the measure's preamble width, the same constant used for line-start clefs.

### Pitch entry per clef

`stepToPitch` maps canvas Y position to a pitch using a reference C position. The reference table is extended to cover all four pitched clefs:

| Clef | Reference (C position) | Step |
|------|----------------------|------|
| treble | C4 (middle C) | 10 |
| bass | C2 | 12 |
| alto | C4 | 4 |
| tenor | C4 | 6 |
| percussion | C4 (treble fallback) | 10 |

---

## User Interaction

### Changing a clef

1. Switch to **Select mode** (`S` key or toolbar button).
2. Click the clef symbol rendered at the start of any measure line, or at any mid-score clef change marker.
3. A **ClefPicker** popup appears listing all five clef types.
4. Clicking a clef dispatches `SET_CLEF` for the measure whose clef symbol was clicked.

The clef change propagates forward through subsequent measures until the next explicit `measure.clef` or end of score.

### ClefPicker

A fixed-position popup (same visual style as `BarlinePicker`) listing:

- Treble
- Bass
- Alto
- Tenor
- Percussion

Closes on Escape or click outside.

---

## Pitch Re-spelling on Clef Change

When a clef changes, existing notes in the affected measures are **re-pitched** so that their visual position on the staff (the line or space they occupy) stays the same, but their stored pitch — and therefore their sound — changes to match what that position means in the new clef.

### Why this behaviour

A note's staff position is its primary written identity. Keeping it fixed means the score looks identical before and after the clef change; only the sounding pitch differs. This is also immediately reflected in playback (the audio engine reads the stored pitch directly).

### Scope of re-pitching

Starting from the measure where the clef changes, all subsequent measures are re-pitched **until**:
- another explicit `measure.clef` override is encountered, or
- the end of the staff is reached.

### Algorithm

For each affected note:
1. Compute its **staff step** from the stored pitch using the *old* clef via `pitchToStep(pitch, oldClef)`.
2. Convert that step back to a pitch using the *new* clef via `stepToPitch(step, newClef)`.
3. Update `noteName` and `octave`. Accidentals are preserved as-is (they represent a chromatic inflection on top of the written diatonic position).

### `pitchToStep` (new utility)

Inverse of `stepToPitch`. Given a pitch and a clef, returns the staff step:

```
step = ref.step − (noteIndex + 7 × (octave − ref.octave))
```

where `noteIndex` is the index of the note name in `['C','D','E','F','G','A','B']`.

### Playback

No changes to the audio engine are required. `pitchToHz` already reads `noteName` and `octave` from the stored `Pitch`, so re-pitched notes play back at their new frequency automatically.

---

## Undo / Redo

`SET_CLEF` is dispatched through the normal `dispatch` → `applyCommand` pipeline and is covered by the existing full-snapshot undo stack. Undoing a clef change restores both the clef and the original pitches.
