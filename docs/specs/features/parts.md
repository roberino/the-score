# Spec: Multiple Parts

## Overview

Adds support for multiple independent parts in a score. Each part is associated with an instrument from a curated catalog, has its own staff and clef, displays a configurable label on the score, and — for transposing instruments — stores notes as written pitch while playing back at concert pitch.

---

## Out of Scope

- Grand staff (piano brace linking two staves of the same part)
- Brackets grouping families of parts (strings bracket, woodwind bracket, etc.)
- Per-part time signature overrides (all parts share the score time signature)
- Per-part key signature overrides (score has one concert key; written key is derived per part)
- MIDI import/export for multi-part scores (remains single-track for now)
- Automatic concert-pitch correction when changing transposeSemitones on a part that already has notes

---

## Instrument Catalog

A static catalog (~30 instruments) in `src/shared/instruments.ts`. Each entry:

```ts
interface InstrumentDef {
  id: string
  name: string              // e.g. "Clarinet in Bb"
  shortName: string         // e.g. "Cl."
  family: InstrumentFamily  // 'strings' | 'woodwinds' | 'brass' | 'keyboards' | 'percussion' | 'voices'
  defaultClef: ClefType
  midiProgram: number       // GM 0-127
  transposeSemitones: number
}
```

**`transposeSemitones` convention:** positive = written pitch is that many semitones above concert pitch. For playback: `concertMidi = writtenMidi − transposeSemitones`.

Example transpositions:

| Instrument | transposeSemitones | Written C sounds |
|---|---|---|
| Concert pitch instruments (strings, flute, oboe…) | 0 | C |
| Piccolo | -12 | C (octave higher) |
| Clarinet in Bb, Trumpet | +2 | Bb |
| Clarinet in A | +3 | A |
| English Horn | +7 | F |
| French Horn in F | +7 | F |
| Alto Sax | +9 | Eb |
| Tenor Sax | +14 | Bb (octave + M2) |
| Baritone Sax | +21 | Eb (two octaves + M3) |
| Double Bass, Guitar | +12 | C (octave lower) |

---

## Data Model Changes

### `Part` additions

```ts
transposeSemitones: number   // 0 = concert pitch
labelVisible: boolean        // per-part label visibility (default true)
```

### `Score` addition

```ts
showPartLabels: boolean      // master label visibility switch (default true)
```

A part label is shown when `score.showPartLabels && part.labelVisible`.

---

## Key Signature Display (Written Pitch Mode)

The score stores one concert key. For each part, the displayed key signature is the written key derived by:

```
writtenFifths = concertFifths + ((transposeSemitones × 7) mod 12),
adjusted to the range [−7, +7]
```

Example: concert C major (0 fifths), Bb clarinet (+2): written key D major (+2 fifths).  
Example: concert G major (+1 fifth), French Horn (+7): written key D major (+2 fifths).

Key changes applied via the canvas picker or toolbar always set the **concert key**; all parts' displayed key signatures update automatically.

---

## Part Labels

- **First system line** (first measure of the score): full `part.name` (e.g. "Clarinet in Bb")
- **Subsequent system lines**: `part.shortName` (e.g. "Cl.")
- Right-aligned against the stave's left edge, vertically centred on the stave
- `marginX` increases from 40 → 140 px when labels are visible to make room

---

## Playback

The audio engine schedules notes for **all non-muted parts** in parallel on the same transport timeline (parts share the same time signatures). For each part:

```
concertMidi = writtenMidi − part.transposeSemitones
```

Volume is applied per-part from `part.volume`.

---

## Commands

| Command | Effect |
|---|---|
| `ADD_PART` | Appends a new part; copies measure count from part 0; sets provided instrument defaults |
| `DELETE_PART` | Removes a part (blocked if only 1 part remains) |
| `MOVE_PART` | Swaps a part with its neighbour (up or down) |
| `SET_PART_METADATA` | Updates any subset of: name, shortName, midiProgram, transposeSemitones, labelVisible |
| `SET_SCORE_SHOW_LABELS` | Toggles the master label visibility flag |

Instrument changes in the UI dispatch `SET_CLEF` (if the clef changes) followed by `SET_PART_METADATA`.

---

## Parts Panel

A collapsible left sidebar toggled by a toolbar button ("Parts").

### Panel layout

```
┌─────────────────────┐
│ Parts           [×] │
│─────────────────────│
│ ▸ Piano             │  ← collapsed row
│ ▸ Clarinet in Bb    │
│─────────────────────│
│ [+ Add part]        │
└─────────────────────┘
```

### Expanded part row

- Instrument picker (grouped by family)
- Name field (text input, defaults to instrument name)
- Short name field
- Label visibility toggle checkbox
- Delete button (disabled when only 1 part)
- Up / Down reorder buttons

---

## Undo / Redo

All part-management commands go through `dispatch` and are covered by the existing full-snapshot undo stack.
