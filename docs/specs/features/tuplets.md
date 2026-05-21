# Tuplets

## Overview

Tuplets allow a group of notes to be played in the time normally occupied by a different number
of notes. The three supported ratios are:

| Type | Written | Sounds like |
|---|---|---|
| Triplet | 3 notes | 2 notes of the same duration |
| Quintuplet | 5 notes | 4 notes of the same duration |
| Sextuplet | 6 notes | 4 notes of the same duration |

A bracketed number is drawn above or below the group (auto-positioned by stem direction).
The bracket is omitted when all notes in the group are beamed together (VexFlow default).

---

## Data model

`TupletInfo` is a small value object embedded directly on each `NoteEvent`:

```typescript
export interface TupletInfo {
  readonly id: string      // UUID shared by every note in the same tuplet group
  readonly actual: number  // notes written  (3, 5, or 6)
  readonly normal: number  // notes they replace (2, 4, or 4)
}
```

`Note`, `Rest`, and `Chord` each gain an optional field:

```typescript
readonly tuplet?: TupletInfo
```

All events in one tuplet group share the same `tuplet.id`. Order within the group is determined
by position in `Voice.events`. There is no separate container entity.

### Duration arithmetic

`eventDurationUnits()` in `musicUtils.ts` scales the base duration by `normal / actual`:

```
triplet eighth     = 8 units × (2/3) = 5.333…
quintuplet eighth  = 8 units × (4/5) = 6.4
sextuplet eighth   = 8 units × (4/6) = 5.333…
```

The total for a complete group always equals an integer (e.g., 3 triplet eighths = 16 units =
2 normal eighths). Floating-point sums are used for capacity checking; no change to the integer
score-level capacity constant is needed.

---

## Commands

### `ADD_TUPLET`

Inserts a complete tuplet group of rests at a given voice position.

```typescript
{
  type: 'ADD_TUPLET'
  partId: string
  staffId: string
  measureId: string
  voiceId: string
  actual: 3 | 5 | 6
  normal: 2 | 4 | 4     // paired with actual
  duration: Duration     // written note value, e.g. 'eighth'
  insertIndex?: number   // defaults to end of voice
}
```

The handler:
1. Creates `actual` `Rest` objects each with the same `TupletInfo` (fresh UUID).
2. Inserts them at `insertIndex` (or appends).
3. Runs `spillOverFrom` to push any overflow into the next measure.

### `REMOVE_TUPLET` (future)

Removes all events sharing a `tupletId` and replaces the freed space with a single rest.
Not implemented in this release; deleting individual notes inside a tuplet is sufficient for now.

---

## Entry UX

### Keyboard shortcut

| Key | Action |
|---|---|
| `T` | Insert a triplet (3:2) of the currently selected note duration at the cursor |
| (context menu only) | Quintuplet / sextuplet |

Pressing `T` inserts the full group of rests immediately; the cursor lands on the first rest so
the user can replace each one by typing a pitch.

### Contextual (selection) menu

When exactly 3, 5, or 6 notes/rests are selected:
- "Make triplet" / "Make quintuplet" / "Make sextuplet" button assigns a shared `TupletInfo` to
  the selected events (same `id`, appropriate `actual`/`normal`) without changing their pitches.

This allows retroactive tuplet marking after notes are entered.

---

## Rendering

`renderMeasure` already collects `StaveNote` objects and a stave. Tuplet drawing happens as a
fourth step after beams are drawn.

Algorithm in `renderMeasure`:

1. After building all `StaveNote` objects, group them by `tupletId`.
2. For each group (in voice order), create a `VexFlow.Tuplet`:

```typescript
import { Tuplet as VexTuplet } from 'vexflow'

new VexTuplet(staveNotesInGroup, {
  num_notes:       actual,   // e.g. 3
  notes_occupied:  normal,   // e.g. 2
  bracketed:       true,     // VexFlow auto-hides bracket when all notes are beamed
  ratioed:         false,    // show "3" not "3:2"
}).setContext(ctx).draw()
```

VexFlow auto-positions the bracket above or below based on stem direction.

### Voice validation

VexFlow's `Voice` strict mode rejects a measure where three eighth notes are placed where two
should fit. The voice is therefore created with `{ strict: false }` (mode SOFT) for any measure
that contains tuplet notes.

---

## Playback

Each note's sounding duration in seconds:

```
soundingDuration = baseDuration × (normal / actual) × (60 / bpm) × beatUnitScale
```

The playback engine already computes per-note durations from `eventDurationUnits`. Since that
function now returns scaled values for tuplet notes, playback timing falls out automatically
without further changes to the scheduler.

---

## MusicXML import

Each tuplet note carries `<time-modification>`:

```xml
<note>
  <duration>128</duration>
  <type>eighth</type>
  <time-modification>
    <actual-notes>3</actual-notes>
    <normal-notes>2</normal-notes>
    <normal-type>eighth</normal-type>
  </time-modification>
  <notations>
    <tuplet type="start" number="1"/>   <!-- first note only -->
  </notations>
</note>
```

Import strategy:
- Parse `<time-modification>` on every note and accumulate `{ actual, normal }`.
- When `<tuplet type="start">` is encountered, open a new tuplet group (generate UUID).
- When `<tuplet type="stop">` is encountered, close the group.
- Notes between start and stop (inclusive) share the group's UUID and `TupletInfo`.
- Fallback: if `<time-modification>` is present but no explicit `<tuplet>` bracket element,
  group consecutive notes with the same `actual`/`normal` into an implicit group.

---

## MusicXML export

For each tuplet note:

```xml
<time-modification>
  <actual-notes>3</actual-notes>
  <normal-notes>2</normal-notes>
  <normal-type>eighth</normal-type>
</time-modification>
```

Plus `<tuplet type="start"/>` on the first note and `<tuplet type="stop"/>` on the last note
of each group (determined by order in `Voice.events`).

---

## Known limitations & future work

- **`REMOVE_TUPLET` command**: not yet implemented; delete individual notes instead.
- **Nested tuplets**: not supported.
- **Seventh / other ratios**: only 3:2, 5:4, and 6:4.
- **Cross-measure tuplets**: not supported; a tuplet group must fit within one measure.
- **Retroactive duration change inside a tuplet**: `SET_NOTE_DURATION` is not tuplet-aware;
  changing a note's duration inside a tuplet will break the group's total capacity.
