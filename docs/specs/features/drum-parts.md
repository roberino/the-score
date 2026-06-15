# Spec: Drum Part Improvements

## Overview

This spec covers three distinct gaps in drum part support:

1. **Notehead types** — score model, rendering, and toolbar picker for alternate noteheads (x, circle-x, diamond, slash, triangle) needed to correctly notate hi-hats, cymbals, and other percussion instruments.
2. **Score-mode drum playback** — non-sequencer percussion staves are currently routed to the pitched sampler; they need to route to the drum sampler with a reverse pitch-to-MIDI-note lookup.
3. **MusicXML drum import** — `<unpitched>` notes are silently ignored; display-step/display-octave must be read to recover staff position, and notehead type must be imported.

---

## Part 1: Notehead Types

### Background

Drum notation uses several notehead shapes to distinguish instrument voices:

| Shape | VexFlow key suffix | Common usage |
|---|---|---|
| Normal (filled oval) | `n` (default) | Snare, bass drum, toms |
| X | `x` | Closed hi-hat, ride cymbal, crash cymbal |
| Circle-X | `cx` | Open hi-hat |
| Diamond | `d` | Ride bell, harmonics |
| Slash | `s` | Beat slashes, comping notation |
| Triangle | `ti` | Triangle, cowbell |

VexFlow accepts the suffix as the third segment of a key string: `"b/4/x"` renders an x-notehead at B4.

### 1.1 Score model

Add `noteheadType` to both `Note` and `Chord` in `packages/volta-app/src/shared/score.ts`:

```typescript
export type NoteheadType = 'normal' | 'x' | 'circle-x' | 'diamond' | 'slash' | 'triangle'

export interface Note {
  // ... existing fields ...
  noteheadType?: NoteheadType   // undefined = 'normal'
}

export interface Chord {
  // ... existing fields ...
  noteheadType?: NoteheadType   // applies to all noteheads in the chord
}
```

The field is optional and defaults to `'normal'` everywhere it is not present, so no migration is needed for existing scores.

### 1.2 Rendering

In `notationRenderer.ts`, `noteEventToStaveNote()` (around line 209) currently builds VexFlow key strings as `"${vfNote}/${octave}"`. Change it to append the VexFlow suffix when `noteheadType` is set:

```typescript
const NOTEHEAD_SUFFIX: Record<NoteheadType, string> = {
  'normal':   '',
  'x':        '/x',
  'circle-x': '/cx',
  'diamond':  '/d',
  'slash':    '/s',
  'triangle': '/ti',
}

function buildKey(vfNote: string, octave: number, noteheadType?: NoteheadType): string {
  const suffix = noteheadType ? NOTEHEAD_SUFFIX[noteheadType] : ''
  return `${vfNote}/${octave}${suffix}`
}
```

Apply `buildKey` in every place that currently constructs `"${vfNote}/${octave}"` for a `StaveNote`.

### 1.3 Toolbar picker

Add a notehead type picker row to `Toolbar.tsx` that appears when `inputMode === 'note'` or `inputMode === 'rest'` (no clef restriction — it's useful for all staves, though most common on percussion).

The picker is a row of five buttons below the existing duration row, styled identically (same height, border, active highlight):

```
● Normal    ✕ X    ⊗ Circle-X    ◇ Diamond    ╱ Slash    △ Triangle
```

Button labels use Unicode glyphs. Active notehead is highlighted with the same blue used for active duration.

State: add `selectedNoteheadType: NoteheadType` to `appStore.ts`, defaulting to `'normal'`. A `setNoteheadType` action updates it. The store type already holds `selectedDuration` — follow the same pattern.

Wire the toolbar buttons to `setNoteheadType`. Pass `selectedNoteheadType` into the existing note-insertion paths in `handleCanvasClick` and `useMidiInput`, and set it on newly created `Note` / `Chord` objects.

### 1.4 Drum-specific defaults

When clicking on a percussion stave in note-input mode, automatically suggest the canonical notehead type for the drum instrument at that staff position. This is informational only — the user can override. Implement via a lookup from `DRUM_MAP` (defined in Part 2) keyed on pitch:

```typescript
function defaultNoteheadForPitch(pitch: Pitch, clef: ClefType): NoteheadType {
  if (clef !== 'percussion') return 'normal'
  const entry = DRUM_MAP_BY_PITCH.get(pitchKey(pitch))
  return entry?.noteheadType ?? 'normal'
}
```

Set `selectedNoteheadType` in `handleCanvasMouseMove` (or a new `handlePercussionHover`) when the cursor enters a new staff slot on a percussion stave. This gives a live preview of what will be inserted.

---

## Part 2: Score-mode Drum Playback

### Background

`samplerEngine.ts` currently routes events to the drum sampler only for `inputMode === 'sequencer'` parts (line 87). Notes on a percussion stave created via note-input or imported from MIDI/MusicXML fall through to `pitchToHz`, which tries to play them as a pitched instrument — producing the wrong sound or silence.

### 2.1 Routing fix

In `samplerEngine.ts`, change the routing condition from checking `inputMode` to checking `midiChannel` OR stave clef:

```typescript
const hasDrumStave = part.staves.some(s =>
  s.measures.length > 0 && resolveClef(s) === 'percussion'
)
const isDrumPart = (part.midiChannel ?? 1) === 10 || hasDrumStave
```

Where `resolveClef(s)` reads the clef directive from the first measure of the stave (the same way `resolveKeySig` etc. already work).

Apply this check to the `buildFlatSchedule` path (the note/chord event loop starting at line 108), routing matching events through `scheduleDrumHit` instead of `sampler.triggerAttack`.

### 2.2 Pitch → MIDI drum note reverse map

`scheduleDrumHit` takes a MIDI note number. Currently there is a forward map `GM_DRUM_MAP: Record<midiNote, Pitch>` in `midiEngine.ts`. We need the reverse.

Define `DRUM_MAP` as a single canonical source of truth, exported from a new shared file `packages/volta-app/src/shared/drumMap.ts`:

```typescript
export interface DrumInstrument {
  midiNote:    number
  name:        string
  pitch:       Pitch          // staff display position
  noteheadType: NoteheadType
}

export const DRUM_MAP: DrumInstrument[] = [
  { midiNote: 35, name: 'Bass Drum 2',     pitch: { noteName: 'B', octave: 1, accidental: null },          noteheadType: 'normal' },
  { midiNote: 36, name: 'Bass Drum 1',     pitch: { noteName: 'C', octave: 2, accidental: null },          noteheadType: 'normal' },
  { midiNote: 37, name: 'Side Stick',      pitch: { noteName: 'C', octave: 3, accidental: 'sharp' },       noteheadType: 'x' },
  { midiNote: 38, name: 'Acoustic Snare',  pitch: { noteName: 'D', octave: 3, accidental: null },          noteheadType: 'normal' },
  { midiNote: 39, name: 'Hand Clap',       pitch: { noteName: 'D', octave: 4, accidental: 'sharp' },       noteheadType: 'x' },
  { midiNote: 40, name: 'Electric Snare',  pitch: { noteName: 'E', octave: 3, accidental: null },          noteheadType: 'normal' },
  { midiNote: 41, name: 'Low Floor Tom',   pitch: { noteName: 'F', octave: 2, accidental: null },          noteheadType: 'normal' },
  { midiNote: 42, name: 'Closed Hi-Hat',   pitch: { noteName: 'F', octave: 4, accidental: 'sharp' },       noteheadType: 'x' },
  { midiNote: 43, name: 'High Floor Tom',  pitch: { noteName: 'G', octave: 2, accidental: null },          noteheadType: 'normal' },
  { midiNote: 44, name: 'Pedal Hi-Hat',    pitch: { noteName: 'A', octave: 4, accidental: null },          noteheadType: 'x' },
  { midiNote: 45, name: 'Low Tom',         pitch: { noteName: 'A', octave: 2, accidental: null },          noteheadType: 'normal' },
  { midiNote: 46, name: 'Open Hi-Hat',     pitch: { noteName: 'B', octave: 4, accidental: null },          noteheadType: 'circle-x' },
  { midiNote: 47, name: 'Low-Mid Tom',     pitch: { noteName: 'B', octave: 2, accidental: null },          noteheadType: 'normal' },
  { midiNote: 48, name: 'Hi-Mid Tom',      pitch: { noteName: 'C', octave: 3, accidental: null },          noteheadType: 'normal' },
  { midiNote: 49, name: 'Crash Cymbal 1',  pitch: { noteName: 'A', octave: 5, accidental: null },          noteheadType: 'x' },
  { midiNote: 50, name: 'High Tom',        pitch: { noteName: 'D', octave: 3, accidental: null },          noteheadType: 'normal' },
  { midiNote: 51, name: 'Ride Cymbal 1',   pitch: { noteName: 'E', octave: 5, accidental: null },          noteheadType: 'x' },
  { midiNote: 52, name: 'Chinese Cymbal',  pitch: { noteName: 'F', octave: 5, accidental: null },          noteheadType: 'x' },
  { midiNote: 53, name: 'Ride Bell',       pitch: { noteName: 'F', octave: 5, accidental: 'sharp' },       noteheadType: 'diamond' },
  { midiNote: 54, name: 'Tambourine',      pitch: { noteName: 'G', octave: 5, accidental: null },          noteheadType: 'x' },
  { midiNote: 55, name: 'Splash Cymbal',   pitch: { noteName: 'G', octave: 5, accidental: 'sharp' },       noteheadType: 'x' },
  { midiNote: 56, name: 'Cowbell',         pitch: { noteName: 'A', octave: 5, accidental: null },          noteheadType: 'triangle' },
  { midiNote: 57, name: 'Crash Cymbal 2',  pitch: { noteName: 'A', octave: 5, accidental: 'sharp' },       noteheadType: 'x' },
  { midiNote: 59, name: 'Ride Cymbal 2',   pitch: { noteName: 'B', octave: 5, accidental: null },          noteheadType: 'x' },
]

export const DRUM_MAP_BY_MIDI   = new Map(DRUM_MAP.map(d => [d.midiNote, d]))
export const DRUM_MAP_BY_PITCH  = new Map(DRUM_MAP.map(d => [pitchKey(d.pitch), d]))

function pitchKey(p: Pitch): string {
  return `${p.noteName}${p.octave}${p.accidental ?? ''}`
}
```

Replace the existing `GM_DRUM_MAP` in `midiEngine.ts` with `DRUM_MAP_BY_MIDI` from this shared module. Use `DRUM_MAP_BY_PITCH` in `samplerEngine.ts` to resolve the MIDI note for playback:

```typescript
// In samplerEngine.ts, drum event playback:
const pitchK = pitchKey(n.pitch)
const drumEntry = DRUM_MAP_BY_PITCH.get(pitchK)
const midiNote = drumEntry?.midiNote ?? 38  // fallback: snare
scheduleDrumHit(midiNote, velocity, volDb, time)
```

### 2.3 Clef resolution helper

Add `resolveClef(stave: Staff, measureIndex: number): ClefType` to `musicUtils.ts`, mirroring `resolveKeySig`. It walks the measure directives backwards to find the most recent clef change, defaulting to `'treble'`. This is needed by the routing fix and by the drum-default notehead logic.

---

## Part 3: MusicXML Drum Import

### Background

MusicXML represents unpitched percussion notes with `<unpitched>` rather than `<pitch>`:

```xml
<note>
  <unpitched>
    <display-step>C</display-step>
    <display-octave>5</display-octave>
  </unpitched>
  <duration>1</duration>
  <type>quarter</type>
  <instrument id="P1-I37"/>
  <notehead>x</notehead>
</note>
```

The `<display-step>/<display-octave>` give the visual staff position (what we store as `Pitch`). The `<instrument id>` maps to a `<score-instrument>` in `<part-list>` that carries the GM MIDI note number via `<midi-unpitched>`. The `<notehead>` element gives the notehead shape.

Currently `xmlPitch()` in `musicxmlEngine.ts` reads only `<pitch>` and returns `C4` as a default when neither `<pitch>` nor `<unpitched>` is present. All drum notes from MusicXML therefore import as C4 with no notehead type, stacking on the same staff line.

### 3.1 Parse `<unpitched>` elements

Extend `xmlPitch()` to fall back to `<unpitched>` when `<pitch>` is absent:

```typescript
function xmlPitch(noteEl: Element): Pitch {
  const pitchEl    = noteEl.querySelector('pitch')
  const unpitchedEl = noteEl.querySelector('unpitched')

  if (pitchEl) {
    // existing logic (unchanged)
    return parsePitchEl(pitchEl, noteEl)
  }

  if (unpitchedEl) {
    const noteName = (unpitchedEl.querySelector('display-step')?.textContent?.trim() ?? 'C') as NoteName
    const octave   = parseInt(unpitchedEl.querySelector('display-octave')?.textContent ?? '5', 10)
    return { noteName, octave, accidental: null }
  }

  return { noteName: 'C', octave: 4, accidental: null }
}
```

### 3.2 Parse `<notehead>` elements

Add a new helper `xmlNoteheadType()`:

```typescript
const XML_NOTEHEAD_MAP: Record<string, NoteheadType> = {
  'normal':    'normal',
  'x':         'x',
  'circle-x':  'circle-x',
  'diamond':   'diamond',
  'slash':     'slash',
  'triangle':  'triangle',
  // MusicXML also uses these synonyms:
  'cross':     'x',
  'cluster':   'normal',
  'inverted triangle': 'triangle',
}

function xmlNoteheadType(noteEl: Element): NoteheadType | undefined {
  const text = noteEl.querySelector('notehead')?.textContent?.trim().toLowerCase()
  if (!text) return undefined
  return XML_NOTEHEAD_MAP[text]
}
```

Apply this when constructing `Note` / `Chord` objects in `parseMusicXmlPart()`:

```typescript
const noteheadType = xmlNoteheadType(noteEl)
const note = createNote(pitch.noteName, pitch.octave, duration, accidental, /* dots */ dots)
if (noteheadType) (note as Note).noteheadType = noteheadType
```

### 3.3 Instrument → MIDI note lookup

To recover the correct MIDI drum note for playback, parse the part's `<score-instrument>` / `<midi-instrument>` blocks in `<part-list>` and build an instrument-id → MIDI-note map:

```typescript
function buildInstrumentMap(
  partListEl: Element,
  partId: string,
): Map<string, number> {
  const map = new Map<string, number>()
  const scorePartEl = partListEl.querySelector(`score-part[id="${partId}"]`)
  if (!scorePartEl) return map

  for (const mi of Array.from(scorePartEl.querySelectorAll('midi-instrument'))) {
    const instrId    = mi.getAttribute('id') ?? ''
    const unpitched  = mi.querySelector('midi-unpitched')?.textContent?.trim()
    if (unpitched) map.set(instrId, parseInt(unpitched, 10))
  }
  return map
}
```

When `<midi-unpitched>` is present, write the resolved MIDI note into a new optional field `midiDrumNote?: number` on `Note`. `samplerEngine.ts` should prefer `midiDrumNote` over the pitch-lookup when scheduling:

```typescript
const midiNote = (n as any).midiDrumNote
  ?? DRUM_MAP_BY_PITCH.get(pitchKey(n.pitch))?.midiNote
  ?? 38
```

### 3.4 Part detection

Ensure imported percussion parts have `midiChannel` set to 10. In `parseMusicXmlPart()`, if any note in the part has an `<unpitched>` element, set `part.midiChannel = 10` after parsing.

---

## Acceptance Criteria

### Notehead types

1. A `NoteheadType` picker appears in the toolbar when in note or rest input mode.
2. Selecting a notehead type and clicking on any stave inserts a note with that notehead rendered correctly (x, circle-x, diamond, slash, triangle).
3. Notehead type survives undo/redo and save/load.
4. On percussion staves, hovering over a staff slot shows the canonical notehead type for that drum instrument in the preview ghost note.

### Drum playback

5. Notes on a percussion stave (any part with `midiChannel === 10` or a percussion clef) play back through the drum sampler, not the pitched sampler.
6. Pitch → MIDI note reverse lookup is correct for all instruments in `DRUM_MAP`.
7. Notes with no entry in `DRUM_MAP` fall back to snare (MIDI 38) rather than silence.
8. Sequencer-mode drum parts continue to work exactly as before.

### MusicXML import

9. A MusicXML file with unpitched percussion notes imports each note at the correct staff position (display-step/display-octave).
10. `<notehead>x</notehead>` imports as `noteheadType: 'x'`; `<notehead>circle-x</notehead>` as `'circle-x'`; etc.
11. When `<midi-unpitched>` is present in the part-list, the note's `midiDrumNote` is populated and playback uses the exact GM instrument.
12. Imported percussion parts have `midiChannel === 10` set automatically.
13. Re-export of an imported drum part to MusicXML produces valid `<unpitched>` elements (existing export path already handles this).

---

## Out of Scope

- Ghost notes (parenthesised noteheads) — a separate articulation feature
- Buzz roll (`z`) noteheads
- Per-pitch notehead overrides within a chord
- Drum input palette / one-click drum-note insertion by instrument name
- Automatic voice assignment (stem-up vs stem-down by instrument family)
- Drum part creation wizard
