# Feature Spec: Note Articulations

## Overview

Add visual rendering, UX input, playback effects, and complete MusicXML export for the eight articulation types already present in the data model: staccato, accent, tenuto, marcato, fermata, trill, mordent, turn.

---

## 1. Data Model

### 1.1 Current state — already complete

```typescript
// score.ts — unchanged
export type Articulation =
  | 'staccato' | 'accent' | 'tenuto' | 'marcato'
  | 'fermata' | 'trill' | 'mordent' | 'turn'

export interface Note  { readonly articulations: Articulation[] }
export interface Chord { readonly articulations: Articulation[] }
```

`Rest` does not carry articulations; the UI should disable articulation buttons when only rests are selected.

### 1.2 Stacking

Multiple articulations per note are allowed (e.g. staccato + accent). The model already supports this via the array.

---

## 2. Command

```typescript
// commands.ts addition
| {
    type: 'SET_ARTICULATION';
    targets: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[];
    articulation: Articulation;
    on: boolean;   // true = add, false = remove
  }
```

**Reducer**: for each target, find the note/chord event; if `on` add the articulation (if not already present); if `!on` filter it out. No-op for rest events.

**Toggle logic (determined in ScoreCanvas before dispatch):**
- If **all** selected non-rest notes already have the articulation → `on: false` (remove from all)
- Otherwise → `on: true` (add to any that are missing it)

This matches Sibelius/Finale behavior: the button acts as a "set" when any note lacks it, and "clear" only when all have it.

---

## 3. VexFlow Rendering

### 3.1 VexFlow classes

| Articulation | VexFlow class | Constructor argument |
|---|---|---|
| staccato | `Articulation` | `'a.'` |
| accent | `Articulation` | `'a>'` |
| tenuto | `Articulation` | `'a-'` |
| marcato | `Articulation` | `'a^'` |
| fermata | `Articulation` | `'a@a'` (above) |
| trill | `Ornament` | `'tr'` |
| mordent | `Ornament` | `'mordent'` |
| turn | `Ornament` | `'turn'` |

`Articulation` and `Ornament` are both VexFlow `Modifier` subclasses; both are attached via `staveNote.addModifier(modifier)`.

### 3.2 Implementation

In `noteEventToStaveNote` (notationRenderer.ts), after the existing accidental/dot handling, add articulation modifiers to the `note` and `chord` cases:

```typescript
import { Articulation as VexArticulation, Ornament } from 'vexflow'

const ARTICULATION_CODE: Partial<Record<Articulation, string>> = {
  staccato: 'a.',
  accent:   'a>',
  tenuto:   'a-',
  marcato:  'a^',
  fermata:  'a@a',
}
const ORNAMENT_CODE: Partial<Record<Articulation, string>> = {
  trill:   'tr',
  mordent: 'mordent',
  turn:    'turn',
}

function attachArticulations(staveNote: StaveNote, articulations: readonly Articulation[]): void {
  for (const art of articulations) {
    const ac = ARTICULATION_CODE[art]
    if (ac) {
      staveNote.addModifier(new VexArticulation(ac))
      continue
    }
    const oc = ORNAMENT_CODE[art]
    if (oc) staveNote.addModifier(new Ornament(oc))
  }
}
```

Called at the end of both the `'note'` and `'chord'` branches.

### 3.3 Naming conflict

The VexFlow class is also called `Articulation`. Import with an alias to avoid collision with the score type:

```typescript
import { Articulation as VexArticulation } from 'vexflow'
```

### 3.4 Placement

VexFlow auto-positions articulation modifiers based on stem direction. No manual placement is needed for the initial implementation.

---

## 4. Toolbar UX

### 4.1 Trigger

Articulation buttons appear in the existing select-mode floating toolbar whenever `selectedNoteIds.length > 0`. They are greyed-out (disabled) if the selection contains **only** rests.

### 4.2 Button set

| Button label | Articulation | Unicode hint |
|---|---|---|
| `.` | staccato | U+1D17 |
| `>` | accent | `>` |
| `—` | tenuto | `−` |
| `^` | marcato | `∧` |
| `𝄐` | fermata | U+1D110 |
| `tr` | trill | — |
| `m` | mordent | — |
| `~` | turn | `~` |

### 4.3 Active state

A button is shown **highlighted** (blue background, white text) when **all** selected non-rest notes carry that articulation. Otherwise it renders normally. This is consistent with the toggle logic: highlighted = "click to remove all"; unhighlighted = "click to add to all".

### 4.4 Layout

Articulation buttons form a second row (or a visually separated group) below the existing Tie / Slur / Transpose buttons to avoid crowding.

---

## 5. Playback Effects

Applied in `audioEngine.ts`, `samplerEngine.ts`, and `midiOutputEngine.ts` after `buildFlatSchedule` produces the `FlatScheduleEntry` list. Since `fe.event` is the raw `NoteEvent`, articulations are directly accessible.

| Articulation | Duration effect | Velocity effect |
|---|---|---|
| staccato | `playDurSec × 0.45` | — |
| tenuto | none (full value, already default) | — |
| accent | — | `velocity × 1.30`, clamped to 127 |
| marcato | `playDurSec × 0.85` | `velocity × 1.45`, clamped to 127 |
| fermata | `playDurSec × 2.0` | — |
| trill / mordent / turn | — | — |

**Stacking**: effects are composable. A staccato + accent note plays at 45% duration and 130% velocity.

**Implementation site**: a helper `applyArticulationEffects(event: NoteEvent, durSec: number, velocity: number): { durSec: number; velocity: number }` in `musicUtils.ts` (or inline in each engine).

> **Note**: fermata's `playDurSec × 2.0` only lengthens the note-off; it does not shift subsequent notes' start times. This is a simplification — a true fermata would pause the entire playback clock. For MVP this approximation is acceptable.

---

## 6. MusicXML Export Fixes

The existing `notationsElement` function (musicxmlEngine.ts) handles staccato, accent, and marcato, but is missing the others. Required additions:

### 6.1 Inside `<articulations>`

| Articulation | XML element |
|---|---|
| tenuto | `<tenuto/>` |

### 6.2 At `<notations>` level (outside `<articulations>`)

| Articulation | XML element |
|---|---|
| fermata | `<fermata/>` |

### 6.3 Inside `<ornaments>` (new element, inside `<notations>`)

| Articulation | XML element |
|---|---|
| trill | `<trill-mark/>` |
| mordent | `<mordent/>` |
| turn | `<turn/>` |

The `notationsElement` function needs to be extended to build an `<ornaments>` block and emit `<fermata/>` at the correct nesting level.

---

## 7. Files Changed

| File | Change |
|---|---|
| `src/shared/commands.ts` | Add `SET_ARTICULATION` command + reducer |
| `src/renderer/engine/notationRenderer.ts` | Import `VexArticulation`, `Ornament`; add `attachArticulations` helper; call it in `noteEventToStaveNote` |
| `src/renderer/components/ScoreCanvas.tsx` | Add articulation buttons to toolbar; compute and dispatch `SET_ARTICULATION` |
| `src/renderer/engine/musicxmlEngine.ts` | Add tenuto, fermata, ornaments to `notationsElement` |
| `src/renderer/engine/audioEngine.ts` | Apply articulation duration/velocity effects |
| `src/renderer/engine/samplerEngine.ts` | Apply articulation duration/velocity effects |
| `src/renderer/engine/midiOutputEngine.ts` | Apply articulation duration/velocity effects |

No changes required to `score.ts` or `musicUtils.ts`.

---

## 8. Out of Scope

- **Trill speed / pitch**: upper-note specification for trills (`<trill-mark>` with `<accidental-mark>`)
- **Inverted mordent** (the model has `'mordent'` only)
- **Staccatissimo**, **portato**, **snap pizzicato** — not in the current `Articulation` union
- **Per-articulation placement override** (above/below) — VexFlow auto-placement is sufficient for MVP
- **Fermata as a global playback pause** — deferred to a future tempo/playback model overhaul
