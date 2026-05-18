# Feature Spec: Slurs & Ties

## Overview

Ties and slurs both render as curved arcs between notes. They are semantically distinct and stored differently, but share rendering infrastructure and UX patterns. Implemented as a single sprint.

| | Tie | Slur |
|---|---|---|
| Pitches | Must match | Any |
| Span | Always 2 notes | 2 or more notes |
| Playback | Extends duration | Articulation hint only |
| Storage | Flags on `Note` | Collection on `Staff` |

---

## 1. Data Model

### 1.1 Ties — already modelled

`Note` already has:
```typescript
readonly tieStart: boolean
readonly tieEnd: boolean
```
No model changes needed. A tie is represented by `tieStart: true` on note N and `tieEnd: true` on note N+1 (same pitch, same part/staff/voice).

**Invariants:**
- `tieEnd` on a note implies the immediately preceding note in that voice has `tieStart: true`
- Both notes must share the same `noteName` and `octave` (accidentals may differ — e.g. C# tied to C♮ is valid and common)
- A note cannot have both `tieStart` and `tieEnd` with `tieStart` pointing to a different-pitch note

### 1.2 Slurs — new `Slur` type and `Staff.slurs` collection

Add to `src/shared/score.ts`:

```typescript
export interface Slur {
  readonly id: string
  readonly fromNoteId: string   // id of the source NoteEvent (Note or Chord)
  readonly toNoteId: string     // id of the destination NoteEvent (Note or Chord)
  readonly placement?: 'above' | 'below'  // omit = auto (follows stem direction)
}
```

Extend `Staff`:
```typescript
export interface Staff {
  readonly id: string
  readonly clef: ClefType
  readonly measures: readonly Measure[]
  readonly slurs?: readonly Slur[]   // NEW — spans are staff-scoped, may cross measures
}
```

**Why `Staff`, not `Measure`:** A slur can span multiple measures. Storing at staff level avoids splitting the logical unit. The renderer resolves which measures each slur touches at draw time.

**Why `fromNoteId`/`toNoteId`:** Note IDs are stable UUIDs. Index-based references break on insertion/deletion. This supports nesting and overlapping slurs (two slurs with different `fromNoteId`/`toNoteId` pairs on the same staff).

---

## 2. Commands

Add to `Command` union in `src/shared/commands.ts`:

```typescript
| { type: 'TOGGLE_TIE';   partId: string; staffId: string; noteId: string }
| { type: 'ADD_SLUR';     partId: string; staffId: string; slur: Slur }
| { type: 'REMOVE_SLUR';  partId: string; staffId: string; slurId: string }
```

### `TOGGLE_TIE` semantics

The reducer finds the note by `noteId` in its voice:
- If `tieStart` is `false`: set `tieStart: true` on this note AND `tieEnd: true` on the next note in that voice (if same pitch). Reject (no-op) if next note has a different pitch or does not exist.
- If `tieStart` is `true`: set `tieStart: false` on this note AND `tieEnd: false` on the next note.

The note identified by `noteId` is always the **source** (earlier) note of the tie. The UI always passes the earlier of two selected notes.

### `ADD_SLUR` / `REMOVE_SLUR` semantics

`ADD_SLUR` pushes a new `Slur` onto `staff.slurs` (initialising the array if absent). No pitch constraint.

`REMOVE_SLUR` filters by `slurId`. Deleting a note that appears as `fromNoteId` or `toNoteId` in any slur should also dispatch `REMOVE_SLUR` for that slur (handled in the delete-note reducer path).

---

## 3. Input UX

### 3.1 Keyboard shortcuts (primary)

| Key | Action |
|-----|--------|
| `T` | Toggle tie: select one note, press T — ties it to the next note of the same pitch |
| `S` | Slur: first press starts a slur from the selected note; second press on a different selected note ends the slur |

**Tie flow:**
1. User selects a note (single selection)
2. Presses `T`
3. If next note in voice exists and has same pitch → tie is drawn; both notes get `tieStart`/`tieEnd` set
4. If next note has different pitch or doesn't exist → no-op; optionally flash a status message

**Slur flow — two-press model:**
1. User selects source note, presses `S` → slur mode activates; a "pending slur" indicator appears (e.g. dotted arc from source note)
2. User selects destination note, presses `S` → slur is committed; `ADD_SLUR` dispatched
3. Pressing `Escape` during slur mode cancels without committing

Pressing `S` with two notes already selected (multi-select) is a shortcut: treat the earlier note as source and later note as destination, commit immediately.

**Slur mode state** lives in React component state (not in the store) — it is transient input state, not score data.

### 3.2 Toolbar toggle (secondary / discoverability)

In the note-properties toolbar (the contextual panel that appears when a note is selected):

- **Tie button**: icon showing two noteheads with a small arc. Appears active when selected note has `tieStart: true`. Click toggles tie (same as `T`).
- **Slur button**: icon showing a longer arc over a group of notes. Shows active state when the selected note is the start of an existing slur. Click enters slur mode (same as pressing `S`).

Both buttons are disabled (greyed) when:
- No note is selected
- In rest selection
- For the tie button: when the next note has a different pitch

---

## 4. Rendering

VexFlow provides:
- `StaveTie` — connects two `StaveNote` instances with a tie curve (designed for same-pitch ties)
- `Curve` — general bezier curve connecting two `StaveNote` instances (used for slurs)

Both accept `null` for first or last note to handle partial arcs at measure boundaries.

### 4.1 Within a single measure (simple case)

After notes are laid out but before the stave is drawn, scan for:
- Adjacent note pairs where `n.tieStart && next.tieEnd` → `new StaveTie({ first_note, last_note })`
- Slurs whose `fromNoteId` and `toNoteId` both fall within this measure → `new Curve(firstNote, lastNote, { cps: [...] })`

Draw these after `Formatter.joinVoices` and before moving to the next measure.

### 4.2 Cross-measure ties and slurs (primary complexity)

When a tie or slur spans a measure boundary, VexFlow requires **two separate arcs**:
1. A partial arc from the source note to the right edge of stave N (last_note = null)
2. A partial arc from the left edge of stave N+1 to the destination note (first_note = null)

The renderer currently processes measures sequentially. The following approach handles cross-measure arcs without restructuring the pipeline:

**Two-pass approach within `renderFromLayouts`:**
1. **First pass** (existing): lay out all measures, build `staveNoteMap: Map<string, StaveNote>` keyed by event id, and `staveMap: Map<string, Stave>` keyed by measure id. Already done implicitly; just needs to be exposed.
2. **Second pass** (new): after all staves are drawn, iterate over all ties and slurs in the staff, look up the `StaveNote` references from `staveNoteMap`, determine if source and destination are in the same measure or different measures, and draw the appropriate arc(s).

For cross-measure arcs, the renderer needs to know which measure each note belongs to. A `noteToMeasureId: Map<string, string>` built during the first pass provides this.

### 4.3 Tie direction

`StaveTie` auto-calculates direction based on stem direction (ties curve away from stem). No override needed initially; expose `options.direction` if manual control is added later.

### 4.4 Slur curve shape

`Curve` defaults are acceptable for initial implementation. Fine-tuning control points (cps) can be a follow-on. Placement (`above`/`below`) is passed from `Slur.placement`; default (`undefined`) uses VexFlow auto-placement.

### 4.5 Multi-measure slurs (3+ measures)

A slur spanning measures 2–5 needs arcs in measures 2, 3, 4, and 5:
- Measure 2: source note → right edge (last_note = null)
- Measures 3–4: left edge → right edge (both null — a full-width continuation arc)
- Measure 5: left edge → destination note (first_note = null)

Track "open" slurs while iterating the measure list in the second pass.

---

## 5. Playback

### Ties
In `audioEngine.ts`, `samplerEngine.ts`, and `midiOutputEngine.ts`, the playback loop currently schedules each event independently. To play tied notes correctly:

- When note N has `tieStart: true` and note N+1 has `tieEnd: true`, **merge their durations**: schedule one note-on at the start of N with duration `dur(N) + dur(N+1)`, and do not schedule a note-on for N+1.
- Chains of ties (N→N+1→N+2) accumulate: sum all durations until a note without `tieEnd` is encountered.
- Implement in a shared `resolveTiedDuration(events, startIndex): { durationSec, skipCount }` helper in `musicUtils.ts`.

### Slurs
No playback change for initial implementation. A slight velocity ramp or legato articulation could be added later as a refinement.

---

## 6. MusicXML Export

### Ties
Already implemented in `musicxmlEngine.ts`:
```xml
<tied type="start"/>  <!-- in <notations> of source note -->
<tied type="stop"/>   <!-- in <notations> of destination note -->
```
Also: `<tie type="start"/>` in `<note>` attributes (per spec, both `<tie>` and `<tied>` are needed). Currently only `<tied>` is emitted — add `<tie>` attributes to be fully compliant.

### Slurs
Add to `noteToXml()` in `musicxmlEngine.ts`. Slurs need a number attribute (1–6, for nested slurs):

```xml
<slur number="1" type="start" placement="above"/>  <!-- source note's <notations> -->
<slur number="1" type="stop"/>                      <!-- destination note's <notations> -->
```

Implementation: before rendering notes, build a lookup `Map<noteId, { slurNumber, type }>` from `staff.slurs`, then emit the appropriate element when processing each note.

---

## 7. Editing Invariants & Edge Cases

| Scenario | Behaviour |
|---|---|
| Delete a note with `tieStart` | Also clears `tieEnd` on successor note |
| Delete a note with `tieEnd` | Also clears `tieStart` on predecessor note |
| Delete a note that is `fromNoteId` of a slur | Dispatch `REMOVE_SLUR` for that slur |
| Delete a note that is `toNoteId` of a slur | Dispatch `REMOVE_SLUR` for that slur |
| Change duration of a tied note | Tie remains; the merged playback duration updates automatically |
| Change pitch of a tied note to a different pitch | Tie is implicitly broken (validator/reducer should clear `tieStart`/`tieEnd`) |
| Transpose a tied note | Tie preserved (pitch equality is re-evaluated after transpose) |
| Copy/paste a slurred group | Slur is included in paste; new `Slur.id` and `fromNoteId`/`toNoteId` UUIDs generated |

---

## 8. Deferred / Out of Scope

- **Volta brackets** (1st/2nd endings) — separate feature, different data model
- **Laissez vibrer (l.v.) ties** — open-ended tie with no destination note
- **Dotted slur curves** — non-standard notation
- **Slur over cross-staff notes** (grand staff piano) — needs cross-staff rendering
- **Slur fine-tuning UI** (drag control points) — post-MVP

---

## 9. Acceptance Criteria

1. Pressing `T` on a selected note ties it to the next note of the same pitch; the arc is visible on canvas
2. Pressing `T` again on the same note removes the tie
3. Pressing `T` when the next note has a different pitch does nothing
4. Pressing `S` once marks a slur start; pressing `S` on a later selected note draws the slur
5. Pressing `Escape` during slur mode cancels without committing
6. Slur toolbar button enters slur mode; tie toolbar button toggles tie (matches keyboard behaviour)
7. Ties and slurs crossing a measure boundary render correctly (arc continues at start of next stave)
8. Slurs spanning 3+ measures render continuation arcs in intermediate measures
9. Tied notes play as a single sustained note in all three audio engines (sampler, synth, MIDI output)
10. Deleting a tied note correctly clears the tie on the partner note
11. Deleting a slurred note removes the slur from the staff collection
12. MusicXML export emits `<tie>` attributes and `<tied>` / `<slur>` elements in `<notations>`
13. Undo/redo works for all tie and slur operations
