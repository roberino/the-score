# Feature Spec: Multi-Note Selection and Editing

## Overview

Extend the selection model from single-note to multi-note, and add bulk edit operations: step-wise movement, transposition, triplet conversion, and multi-deletion. The feature also enables future operations like copy/paste and bulk articulation.

---

## 1. Selection Model

### 1.1 Current state
`selectedNoteId: string | null` — one note selected globally in the store.

### 1.2 New state
`selectedNoteIds: string[]` — ordered list of selected event IDs.

`selectedNoteId` (singular) is retained as a derived value — the last element of `selectedNoteIds`, or null if empty — so all existing single-note code paths continue to work without immediate refactoring.

### 1.3 Multi-select interactions

**Click**: select single note; clears prior selection.

**Shift+click**: add or remove one note from the selection (toggle behaviour).

**Shift+click on a different measure**: extend selection from the last-selected note to the clicked note (range select: all consecutive notes in order between the two click points within the same staff).

**Escape**: clear entire selection.

All selections are constrained to a **single staff** of a **single part**. Cross-part selection is out of scope (ambiguous for most operations and raises transpose-harmony questions).

### 1.4 Rendering
Notes in `selectedNoteIds` are drawn in the selection colour (existing `#3b9ddd`). The last-selected note may optionally use a slightly different shade to indicate the "anchor" — **TBD based on answer to Q1**.

---

## 2. Operations

### 2.1 Step-wise movement (arrow keys)

Move all selected notes up or down by **one diatonic step** within the current key. Accidentals on the moved note are cleared unless the target pitch requires one (i.e., natural movement through the scale).

| Key | Action |
|-----|--------|
| `↑` (Up Arrow, select mode, note selected) | Move all selected notes up one diatonic step |
| `↓` (Down Arrow, select mode, note selected) | Move all selected notes down one diatonic step |

This replaces the current accidental-priming use of arrows (which only fires in note mode, not select mode — no conflict).

Existing `Ctrl+↑` / `Ctrl+↓` for octave nudge is unchanged.

**Edge cases:**
- If a moved note would go below C0 or above B9: clamp and ignore (no-op for that note).
- Accidentals: cleared on movement; the moved pitch uses only the natural pitch implied by the step in the current clef.

> **⚠️ TBD — See Q2:** Does "moving up/down" mean diatonic (in-key) or chromatic (semitone)? The spec assumes diatonic; if chromatic is preferred, the key-signature lookup is dropped and we shift by one semitone instead.

### 2.2 Transpose

A transpose operation that shifts selected notes by a **specified interval** — as opposed to one-step-at-a-time arrow keys.

**Trigger:** `Shift+T` when notes are selected in select mode switches to the Transpose tab of the selection context menu.

**UI:** The **Transpose** tab of the selection context menu contains:
- Direction: Up / Down toggle buttons
- Named interval buttons (m2, M2, m3, M3, P4, Tritone, P5, m6, M6, m7, M7, P8)
- Semitones numeric input (1–24, synced with interval selection)
- [Apply] button (also triggered by Enter in the semitones field)

**Command:** `TRANSPOSE_NOTES` — takes `partId`, `staffId`, and `{ noteId, measureId, voiceId }[]` array plus `semitones: number` (negative = down).

### 2.3 Triplets

Convert a selected note (or group of selected notes summing to the triplet base duration) into a triplet group.

**What triplets are:** Three notes played in the time of two of the same duration. E.g., three eighth-note triplets fit in the space of one quarter note.

**⚠️ Data model challenge:** The current model uses integer 64th-note units, and triplets require rational arithmetic (a quarter-note triplet = 32/3 ≈ 10.67 units). This is a **non-trivial** change to:
- `DURATION_UNITS` (can no longer be integers)
- `measureCapacityUnits`, `eventDurationUnits`, `usedUnits` (must handle fractions)
- `eventToSeconds`, `buildFlatSchedule` (fractional beat durations)
- `spillOverFrom`, rendering width calculation

**Options:**
A. **Full tuplet model** — add `tuplet?: { actual: number; normal: number }` to NoteEvent; change capacity arithmetic to rational. Full fidelity but large scope.
B. **Approximate** — add triplet durations as pseudo-types (`'eighth-triplet'`, `'quarter-triplet'`) and round to nearest 64th for capacity (loses time-accuracy but avoids rational arithmetic).
C. **Defer** — triplets as a separate sprint after the rest of this feature is stable.

> **⚠️ TBD — See Q4:** Which approach? Recommendation: Option C (defer) or Option A (implement fully). Option B (approximate) introduces silent timing errors.

### 2.4 Multi-deletion

Delete all notes in `selectedNoteIds` with a single `Delete`/`Backspace` keypress.

**Ordering concern:** Notes must be deleted from back to front within each voice so that earlier indices aren't invalidated by preceding deletions.

**Command approach:** Dispatch one `DELETE_NOTE` per selected note, batched as a single undo step by wrapping in a snapshot push (same pattern as `checkAndAutoAddBar`).

**Ties/slurs cleanup:** Inherited from the existing `DELETE_NOTE` reducer logic — adjacent tie flags and referencing slurs are cleared automatically.

---

## 3. Missing Features — Suggested Additions

These are not in the user's original list but are strongly implied by multi-select and would be quick to add:

| Feature | Rationale | Effort |
|---|---|---|
| **Copy / Paste** (Ctrl+C / Ctrl+V) | Most common use of multi-select in notation apps; once selection is ordered, paste is just ADD_NOTE loop | Medium |
| **Duration change applies to all selected** | Currently `.` and `1–7` only affect one note; natural to extend | Low |
| **Articulation toggle on all selected** | Already works per-note; just loop the dispatch | Low |
| **Select-all in measure** (Ctrl+A) | Instant productivity for bulk ops on a full measure | Low |
| **Tie across selected range** | Select first and last note, press T | Low (uses TOGGLE_TIE per pair) |
| **Slur across selected range** | Select first and last note, press L — same as current L shortcut but with pre-filled from/to | Trivial |

---

## 4. Store Changes

```typescript
// New fields
selectedNoteIds: string[]          // replaces selectedNoteId as the canonical selection
selectedAnchorId: string | null    // the "pivot" for shift+click range selection

// Derived (backward-compat shim)
get selectedNoteId(): string | null  // selectedNoteIds[selectedNoteIds.length - 1] ?? null

// New actions
setSelectedNotes: (ids: string[]) => void
addSelectedNote: (id: string) => void
toggleSelectedNote: (id: string) => void
clearSelection: () => void
selectRange: (fromId: string, toId: string, score: Score) => void
```

The renderer's `renderScore` signature changes from `selectedNoteId: string | null` to `selectedNoteIds: ReadonlySet<string>`.

---

## 5. Commands

New commands:

```typescript
| { type: 'MOVE_NOTES_STEP';  partId: string; staffId: string; moves: { measureId: string; voiceId: string; noteId: string }[]; direction: 'up' | 'down' }
| { type: 'TRANSPOSE_NOTES';  partId: string; staffId: string; moves: { measureId: string; voiceId: string; noteId: string }[]; semitones: number }
| { type: 'DELETE_NOTES';     deletions: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[] }
```

`MOVE_NOTES_STEP` resolves the effective clef and key at each note's measure to determine the target diatonic pitch.

---

## 6. Deferred / Out of Scope

- Cross-part multi-select
- Click-drag box selection (complex hit-testing, defer post MVP)
- Velocity editing on selected notes
- Triplets (pending Q4 answer)

---

## 7. Decisions (resolved)

**Q1 → Uniform blue.** All selected notes use the same `#3b9ddd` highlight. No anchor distinction needed.

**Q2 → Chromatic (semitone).** Arrow Up/Down shifts by one semitone. Key-agnostic; sharps used for spellings.

**Q3 → Dialog (Shift+T).** Popover with direction (Up/Down), named interval presets (m2…P8), and numeric semitone input. Centred modal overlay.

**Q4 → Defer triplets.** Separate sprint after multi-select is stable.

**Q5 → Select-all (Ctrl+A) and duration-on-all in scope.** Copy/paste deferred.
