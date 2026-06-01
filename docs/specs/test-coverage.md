# Test Coverage Plan

Priority-ordered list of test suites to add. All items target pure functions or
command reducers — no browser, Electron, or React dependencies.

**Status values:** `not started` · `in progress` · `done`

---

## How to read this doc

| Column | Meaning |
|--------|---------|
| **Suite** | Proposed test file (relative to `src/tests/`) |
| **Area** | Source module under test |
| **Cases** | Key scenarios to cover |
| **Why** | Risk or business rule being protected |
| **Status** | Current state |

---

## P1 — Critical

These guard logic that has already caused bugs or sits directly on the note-entry hot path.

### 1. `fillWithRests` greedy decomposition

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `done` |

**Cases:**

- Exact power-of-two inputs: 64 → `[whole]`, 32 → `[half]`, 16 → `[quarter]`, 8 → `[eighth]`, etc.
- Dotted durations: 48 → `[dotted-half]`, 24 → `[dotted-quarter]`, 12 → `[dotted-eighth]`
- Mixed: 40 → `[quarter, dotted-quarter]` (order matters: largest first)
- Odd units: 1 → `[64th]`, 3 → `[dotted-32nd]`
- Zero → `[]`
- Full 4/4 measure: 64 → single whole rest
- 3/4 measure: 48 → single dotted-half rest
- Sum of returned events always equals input units

**Why:** `fillWithRests` runs on every measure creation and every RESIZE/CLEAR. Wrong decomposition produces unplayable or unrenderable events.

---

### 2. `pitchToMidi` — MIDI note number conversion

| | |
|---|---|
| **Suite** | `midiOutputEngine.test.ts` |
| **Area** | `src/renderer/engine/midiOutputEngine.ts` |
| **Status** | `done` |

**Cases:**

- All 7 natural notes at octave 4 (C4=60, D4=62, E4=64, F4=65, G4=67, A4=69, B4=71)
- Sharp accidental (+1): C#4=61, F#4=66
- Flat accidental (−1): Bb4=70, Eb4=63
- Double-sharp (+2): C##4=62
- Double-flat (−2): Bbb4=69
- `'natural'` and `null` accidental treated identically (no shift)
- Octave boundaries: C-1=0, G9=127 (or nearby boundary)
- Transposition: C4 transposed +2 → D4 (=62), C4 transposed −2 → Bb3 (=58)
- Clamping: very low pitch + large downward transpose → 0 (not negative)
- Clamping: very high pitch + large upward transpose → 127 (not >127)

**Why:** Every MIDI playback note and every MIDI output note goes through this function. A clamping or accidental bug produces wrong-pitch or out-of-range messages.

---

### 3. `shiftPitchBySemitones` — chromatic pitch shifting

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `done` |

**Cases:**

- Up 1 semitone from natural notes: C→C#, E→F (natural half-step), B→C (octave wrap)
- Down 1 semitone: C→B (octave wrap down), F→E (natural half-step)
- Up 12 semitones: C4→C5 (octave up)
- Down 12 semitones: C4→C3 (octave down)
- Input with sharp accidental: C#4 up 1 → D4
- Input with flat accidental: Bb4 up 1 → B4
- Input with double-sharp: Cx4 up 1 → C#5 (wraps through D)
- MIDI 0 boundary: shift down from low note → clamp at MIDI 0, not negative
- MIDI 127 boundary: shift up from high note → clamp at MIDI 127

**Why:** Used by MOVE_NOTES_STEP and TRANSPOSE_NOTES commands. An octave-wrapping or boundary error silently produces the wrong note.

---

### 4. `closestOctave` — octave assignment for keyboard pitch entry

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `done` |

**Cases:**

- No previous pitch → returns octave 4
- Note adjacent above previous: E4 previous, F entered → F4 (not F5)
- Note adjacent below previous: F4 previous, E entered → E4 (not E3)
- Note one octave away: C4 previous, C entered → C4 (same octave, distance 0)
- Tie-breaking — equidistant candidates: F#3 previous, C entered → C4 (higher octave wins)
- Large interval: B4 previous, C entered → C5 (closer to go up)
- Large interval downward: C5 previous, B entered → B4

**Why:** Controls the octave chosen when the user presses a letter key (A–G). A wrong decision shifts the entire melody by an octave.

---

### 5. `DELETE_NOTE` — tie and slur cleanup

| | |
|---|---|
| **Suite** | `commands.test.ts` |
| **Area** | `src/shared/commands.ts` |
| **Status** | `done` |

**Cases:**

- Delete a note with `tieStart=true`: predecessor gets `tieStart=false`, deleted
- Delete a note with `tieEnd=true`: successor gets `tieEnd=false`, deleted
- Delete a note in the middle of a tie chain: both ends cleaned up
- Delete a note that is neither start nor end of tie: no tie fields affected
- Delete a note that is `fromNoteId` in a slur: slur removed from staff
- Delete a note that is `toNoteId` in a slur: slur removed from staff
- Delete a note not in any slur: slur list unchanged
- Delete a note in a voice with no remaining notes: voice becomes empty (no crash)

**Why:** Dangling tie/slur references produce rendering artefacts and corrupt undo state.

---

## P2 — High value

Complex logic with multiple codepaths; no existing tests.

### 6. `resolveTimeSig` and `resolveKeySig` — walk-back resolution

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `not started` |

**Cases (`resolveTimeSig`):**

- No overrides anywhere → returns score default
- Override on the queried measure → returns that override
- Override on an earlier measure → returns earlier override (walk-back)
- Override on a later measure → ignored; returns previous or default
- Multiple overrides → returns the most recent one before or at `idx`
- `idx` beyond end of array → clamped correctly, still finds last override

Same pattern for `resolveKeySig`.

**Why:** Every pitch, rest, and barline placement depends on the effective time/key signature. Wrong resolution causes mis-filled measures or incorrect accidental display.

---

### 7. `eventDurationUnits` — tuplet-aware duration arithmetic

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `not started` |

**Cases:**

- Plain quarter note (no tuplet): 16 units
- Dotted quarter (dots=1): 24 units
- Double-dotted quarter (dots=2): 28 units
- Triplet eighth (3:2 against quarter): 16 * (2/3) ≈ 10.66 — check float/rounding
- Quintuplet sixteenth (5:4 against quarter): `4 * (4/5)` = 3.2
- Tuplet undefined → same as plain note (no scaling)
- Rest events (should behave identically to notes)

**Why:** Used in all cursor positioning, measure-capacity checks, and playback timing. A wrong value cascades into every downstream computation.

---

### 8. `transposeKeyFifths` — key signature transposition

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `not started` |

**Cases:**

- Concert pitch (transposeSemitones=0) → fifths unchanged
- Bb instrument (transposeSemitones=−2): C major (0 fifths) → Bb major (−2 fifths)
- Eb instrument (transposeSemitones=−9): C major → Ab major (−4 fifths)
- F instrument (transposeSemitones=−7): C major → F major (−1 fifth)
- Result clamped to ±7: extremely sharp/flat key → max 7 sharps or 7 flats
- Negative semitones (upward transposing instrument)

**Why:** Transposing instrument parts (clarinets, trumpets, horns) display the wrong key signature if this formula is wrong.

---

### 9. `RESIZE_NOTE` — duration grow and shrink

| | |
|---|---|
| **Suite** | `commands.test.ts` |
| **Area** | `src/shared/commands.ts` |
| **Status** | `done` |

**Shrink cases:**

- Quarter → eighth: freed 8 units filled with a single eighth rest
- Quarter → 16th: freed 12 units filled with dotted-eighth rest
- Shrink a note tied forward: `tieStart` cleared on the resized note

**Grow cases:**

- Quarter → half: consumes following quarter rest; measure has correct remaining units
- Quarter → half where following event is a note (not rest): operation blocked (measure would overflow)
- Grow to exactly fill remaining measure capacity: cursor advances to next measure
- Grow consumes multiple rests: all consumed rests removed, not just one

**Why:** Duration resize is the primary editing operation. Incorrect consumption or fill leaves the measure in an incoherent state.

---

### 10. `TOGGLE_TIE` — pitch validation and cross-voice search

| | |
|---|---|
| **Suite** | `commands.test.ts` |
| **Area** | `src/shared/commands.ts` |
| **Status** | `done` |

**Cases:**

- Toggle on a note where next event has the same pitch: creates tie
- Toggle on a note where next event has a different pitch: operation blocked / no change
- Toggle on a note where next event is a rest: blocked
- Toggle on a note that already has `tieStart=true`: clears the tie (toggle off)
- Cross-measure tie: next note is in the next measure; tie created and both flags set
- No following note at all: blocked

**Why:** Ties are a common operation; a misidentified "next note" silently connects the wrong pitches.

---

### 11. `buildPlaybackSequence` — repeat and volta bracket ordering

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `not started` |

**Cases:**

- No repeats, no voltas → indices [0, 1, 2, …] in order
- Simple repeat (start–end): produces [0, 1, 2, 1, 2, 3] (measures 1–2 repeated)
- Repeat with first/second volta: first pass plays volta-1, second pass plays volta-2, skip volta-1
- Repeat with three voltas (1, 2, 3): each pass plays the correct ending
- Nested repeats (if supported): inner repeat plays before outer
- No end-repeat barline (open repeat): plays once

**Why:** Wrong playback order is immediately audible and invalidates the entire playback feature.

---

## P3 — Medium value

Important logic; lower chance of subtle bugs but covers significant surface area.

### 12. `INSERT_MEASURE` and `REMOVE_MEASURE` — barline and renumbering

| | |
|---|---|
| **Suite** | `commands.test.ts` |
| **Area** | `src/shared/commands.ts` |
| **Status** | `done` |

**Cases:**

- Insert in middle: preceding measure's barline becomes 'single', new measure inserted
- Insert at end: final barline promoted to new last measure
- Remove middle measure: renumbering correct across remaining measures
- Remove last measure when only 1 left: operation blocked (minimum 1 bar)
- After remove, last remaining measure has 'final' barline
- Insert across all parts simultaneously: all staves gain the measure

---

### 13. `stepToPitch` and `pitchToStep` — staff position ↔ pitch

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `done` |

**Cases:**

- Treble clef: middle line (step 4) → B4; step 0 (top line) → F5; step 8 → D4
- Bass clef: middle line → D3; step 0 → A3
- Alto clef: middle C position
- Round-trip: `pitchToStep(stepToPitch(s, clef), clef) === s` for all steps 0–12
- Ledger lines above and below (steps outside 0–8)

**Why:** Mouse-click pitch entry depends on these; an off-by-one shifts every clicked note.

---

### 14. `keyLabel` — key signature display strings

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `done` |

**Cases:**

- All 15 major key labels: C, G, D, A, E, B, F#, Gb, F, Bb, Eb, Ab, Db, Cb
- All 15 minor key labels: Am, Em, Bm, F#m, C#m, G#m, D#m, Ebm, Dm, Gm, Cm, Fm, Bbm, Ebm
- Edge: −7 (Cb major) and +7 (C# major) correctly named

---

### 15. `articulationPlaybackMods` — articulation velocity and duration scaling

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `done` |

**Cases:**

- No articulations → durFactor=1, volDbBonus=0, velFactor=1
- Staccato alone → durFactor≈0.45
- Fermata alone → durFactor=2.0
- Marcato alone → volDbBonus=4, velFactor≈1.45
- Accent alone → volDbBonus=2, velFactor≈1.30
- Staccato + accent together → factors accumulate (both applied)
- Tenuto alone → durFactor=1.0 (no change; check it doesn't error)

**Why:** Controls all note durations and velocities in playback. A factor of 0 or 2 instead of 1 on the wrong articulation is audible and wrong.

---

### 16. `fillWithRests` — interaction with `CLEAR_MEASURES`

| | |
|---|---|
| **Suite** | `commands.test.ts` |
| **Area** | `src/shared/commands.ts` |
| **Status** | `done` |

**Cases:**

- CLEAR_MEASURES on a measure with notes → voice filled with correct rests for its time sig
- CLEAR_MEASURES on a measure with a per-measure time override (3/4) → uses 48 units, not 64
- CLEAR_MEASURES on empty measure → idempotent (same rests)

---

## P4 — Lower priority

Useful coverage; smaller risk of subtle bugs or lower impact if wrong.

### 17. `keyAccidental` — implied accidental from key signature

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `done` |

**Cases:** G major (1 sharp) → F is sharp; F major (1 flat) → B is flat; C major → all naturals; D major (2 sharps) → F and C are sharp.

---

### 18. `eventToSeconds` — absolute timing computation

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `done` |

**Cases:** Quarter at 120 BPM → 0.5 s; dotted quarter → 0.75 s; triplet eighth → 0.333 s; whole note → 2.0 s.

---

### 19. `SET_KEY` / `CLEAR_KEY` — accidental stripping on key change

| | |
|---|---|
| **Suite** | `commands.test.ts` |
| **Area** | `src/shared/commands.ts` |
| **Status** | `done` |

**Cases:**

- Change to G major (1 sharp): all F# accidentals forward from change point are cleared (now implied)
- Change to C major (from G major): all explicit sharps that matched the old key remain; naturals on F are cleared
- Accidentals on notes before the change point are untouched
- `CLEAR_KEY`: restores inherited sig, re-strips

---

### 20. `REMOVE_CHORD_PITCH` — chord collapse to single note

| | |
|---|---|
| **Suite** | `commands.test.ts` |
| **Area** | `src/shared/commands.ts` |
| **Status** | `done` |

**Cases:**

- Remove one pitch from a 3-pitch chord → 2-pitch chord remains
- Remove one pitch from a 2-pitch chord → collapses to single Note, not Chord
- Collapsed Note preserves duration, dots, ID, articulations of the original Chord
- Removing the only pitch from a 1-pitch chord: blocked or treated as delete

---

### 21. `buildFlatSchedule` — tie merging and slur legato

| | |
|---|---|
| **Suite** | `musicUtils.test.ts` |
| **Area** | `src/shared/musicUtils.ts` |
| **Status** | `done` |

**Cases:**

- Two tied notes → merged into one schedule entry with summed duration
- Three-note tie chain → single entry
- Slurred pair → second note gets `legato: true` and `durationSec` extended by 60 ms
- Non-slurred pair → no legato
- Rests are not included in the schedule

**Note:** `buildFlatSchedule` depends on `resolveTimeSig`, `resolveDirectiveTempo`, etc. Consider providing minimal stubs rather than full scores.

---

## Suggested file structure

```
src/tests/
  score.test.ts          ✓ exists
  midiService.test.ts    ✓ exists
  noteInput.test.ts      ✓ exists
  musicUtils.test.ts     ← P1 §3,4 · P2 §6,7,8,11 · P3 §13,14,15 · P4 §17,18,21
  commands.test.ts       ← P1 §5 · P2 §9,10 · P3 §12,16 · P4 §19,20
  midiOutputEngine.test.ts ← P1 §2
```
