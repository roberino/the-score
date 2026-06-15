# Spec: Drum Part Improvements

## Overview

This spec covers four areas of drum part support:

1. **Notehead types** — score model, rendering, and toolbar picker for alternate noteheads (x, circle-x, diamond, slash, triangle) needed to correctly notate hi-hats, cymbals, and other percussion instruments.
2. **Score-mode drum playback** — non-sequencer percussion staves route to the drum sampler with a reverse pitch-to-MIDI-note lookup.
3. **MusicXML drum import** — `<unpitched>` notes import at the correct staff position; notehead type is read from `<notehead>` or inferred from the GM instrument map.
4. **Realistic drum sample playback** — drum preview and playback route through `previewDrumHit` / `scheduleDrumHit` on all input paths; sample coverage expanded to all 24 GM drum instruments.

Parts 1–4 are fully implemented except sample file acquisition (§4.1–4.2), which requires sourcing and placing audio files.

---

## Part 1: Notehead Types

### Background

Drum notation uses several notehead shapes to distinguish instrument voices:

| Shape | VexFlow key suffix | Common usage |
|---|---|---|
| Normal (filled oval) | *(default)* | Snare, bass drum, toms |
| X | `/x` | Closed hi-hat, ride cymbal, crash cymbal |
| Circle-X | `/cx` | Open hi-hat |
| Diamond | `/d` | Ride bell, harmonics |
| Slash | `/s` | Beat slashes, comping notation |
| Triangle | `/ti` | Triangle, cowbell |

VexFlow accepts the suffix as the third segment of a key string: `"b/4/x"` renders an x-notehead at B4.

### 1.1 Score model

`NoteheadType` and optional `noteheadType` fields added to `packages/volta-app/src/shared/score.ts`:

```typescript
export type NoteheadType = 'normal' | 'x' | 'circle-x' | 'diamond' | 'slash' | 'triangle'

export interface Note {
  // ...
  readonly noteheadType?: NoteheadType   // undefined = 'normal'
  readonly midiDrumNote?: number         // set on MusicXML import when <midi-unpitched> is present
}

export interface Chord {
  // ...
  readonly noteheadType?: NoteheadType   // applies to all noteheads in the chord
}
```

The fields are optional and default to `'normal'`/`undefined` everywhere not set, so no migration is needed for existing scores.

### 1.2 Rendering

`notationRenderer.ts` builds VexFlow key strings via a `buildKey` helper that appends the notehead suffix:

```typescript
const NOTEHEAD_SUFFIX: Record<NoteheadType, string> = {
  'normal':   '',
  'x':        '/x',
  'circle-x': '/cx',
  'diamond':  '/d',
  'slash':    '/s',
  'triangle': '/ti',
}

function buildKey(
  pitch: { noteName: string; octave: number; accidental: string | null },
  noteheadType?: NoteheadType,
): string {
  const suffix = noteheadType ? NOTEHEAD_SUFFIX[noteheadType] : ''
  return `${pitch.noteName.toLowerCase()}/${pitch.octave}${suffix}`
}
```

`buildKey` is used in place of the previous inline string for both single notes (`n.noteheadType`) and chords (`c.noteheadType`). The old `pitchToVexKey` function was removed.

### 1.3 Toolbar picker

A notehead picker row is rendered in `Toolbar.tsx` when `inputMode === 'note'` or `inputMode === 'rest'`. It appears below the duration row:

```
● Normal    ✕ X    ⊗ Circle-X    ◇ Diamond    ╱ Slash    △ Triangle
```

Button labels use Unicode glyphs. The active notehead is highlighted with the same blue used for active duration. `selectedNoteheadType: NoteheadType` (default `'normal'`) and `setNoteheadType` live in `appStore.ts`, following the same pattern as `selectedDuration`.

`selectedNoteheadType` is applied in every note-creation path in `ScoreCanvas.tsx`:

```typescript
const noteheadExt = selectedNoteheadType !== 'normal' ? { noteheadType: selectedNoteheadType } : {}
const noteWithDot = { ...note, dots, ...noteheadExt } as Note
```

This covers: `enterNote` (rest-replace and append), `enterNoteAtPitch` (rest-replace, chord-mode, overwrite, and append), and both mouse-click paths in `handleCanvasClick`.

### 1.4 Drum-specific notehead suggestion

When the cursor moves over a percussion stave in note-input mode, `handleCanvasMouseMove` looks up the canonical notehead for the drum at that staff position and calls `setNoteheadType`:

```typescript
if (layout.clef === 'percussion' && inputMode === 'note') {
  const hoverKey  = drumPitchKey({ ...stepToPitch(step, layout.clef), accidental: null })
  if (hoverKey !== lastDrumHoverKeyRef.current) {
    lastDrumHoverKeyRef.current = hoverKey
    const drumEntry = DRUM_MAP_BY_PITCH.get(hoverKey)
    if (drumEntry) setNoteheadType(drumEntry.noteheadType)
  }
}
```

`lastDrumHoverKeyRef` debounces the update so `setNoteheadType` is only called when moving to a new staff slot.

When the cursor leaves a percussion stave (no layout hit, sequencer part, or non-percussion stave), `selectedNoteheadType` resets to `'normal'` and the ref is cleared:

```typescript
} else if (lastDrumHoverKeyRef.current !== null) {
  lastDrumHoverKeyRef.current = null
  setNoteheadType('normal')
}
```

This ensures the toolbar returns to normal when the user moves to a pitched stave.

---

## Part 2: Score-mode Drum Playback

### Background

`samplerEngine.ts` previously routed events to the drum sampler only for `inputMode === 'sequencer'` parts. Notes on a percussion stave created via note-input or imported from MusicXML fell through to `pitchToHz`, producing the wrong sound or silence.

### 2.1 Routing fix

`samplerEngine.ts` now detects drum parts using `midiChannel` or stave clef, checked once before the sequencer/score branch:

```typescript
const hasDrumStave = part.staves.some(s => s.clef === 'percussion')
const isDrumPart   = (part.midiChannel ?? 1) === 10 || hasDrumStave
```

`s.clef === 'percussion'` is used directly rather than `resolveClef` (which already existed in `musicUtils.ts` but wasn't needed here since `Staff.clef` is the authoritative initial clef). Both the sequencer path and the `buildFlatSchedule` path use this flag to route through `scheduleDrumHit`.

### 2.2 Canonical drum map

`packages/volta-app/src/shared/drumMap.ts` is the single source of truth for the GM percussion map, replacing the old inline `GM_DRUM_MAP` in `midiEngine.ts`:

```typescript
export interface DrumInstrument {
  midiNote:     number
  name:         string
  pitch:        Pitch        // staff display position
  noteheadType: NoteheadType
}

export const DRUM_MAP: DrumInstrument[] = [
  { midiNote: 35, name: 'Bass Drum 2',    pitch: { noteName: 'B', octave: 1, accidental: null },      noteheadType: 'normal'   },
  { midiNote: 36, name: 'Bass Drum 1',    pitch: { noteName: 'C', octave: 2, accidental: null },      noteheadType: 'normal'   },
  { midiNote: 37, name: 'Side Stick',     pitch: { noteName: 'C', octave: 3, accidental: 'sharp' },   noteheadType: 'x'        },
  { midiNote: 38, name: 'Acoustic Snare', pitch: { noteName: 'D', octave: 3, accidental: null },      noteheadType: 'normal'   },
  { midiNote: 39, name: 'Hand Clap',      pitch: { noteName: 'D', octave: 4, accidental: 'sharp' },   noteheadType: 'x'        },
  { midiNote: 40, name: 'Electric Snare', pitch: { noteName: 'E', octave: 3, accidental: null },      noteheadType: 'normal'   },
  { midiNote: 41, name: 'Low Floor Tom',  pitch: { noteName: 'F', octave: 2, accidental: null },      noteheadType: 'normal'   },
  { midiNote: 42, name: 'Closed Hi-Hat',  pitch: { noteName: 'F', octave: 4, accidental: 'sharp' },   noteheadType: 'x'        },
  { midiNote: 43, name: 'High Floor Tom', pitch: { noteName: 'G', octave: 2, accidental: null },      noteheadType: 'normal'   },
  { midiNote: 44, name: 'Pedal Hi-Hat',   pitch: { noteName: 'A', octave: 4, accidental: null },      noteheadType: 'x'        },
  { midiNote: 45, name: 'Low Tom',        pitch: { noteName: 'A', octave: 2, accidental: null },      noteheadType: 'normal'   },
  { midiNote: 46, name: 'Open Hi-Hat',    pitch: { noteName: 'B', octave: 4, accidental: null },      noteheadType: 'circle-x' },
  { midiNote: 47, name: 'Low-Mid Tom',    pitch: { noteName: 'B', octave: 2, accidental: null },      noteheadType: 'normal'   },
  { midiNote: 48, name: 'Hi-Mid Tom',     pitch: { noteName: 'C', octave: 3, accidental: null },      noteheadType: 'normal'   },
  { midiNote: 49, name: 'Crash Cymbal 1', pitch: { noteName: 'A', octave: 5, accidental: null },      noteheadType: 'x'        },
  { midiNote: 50, name: 'High Tom',       pitch: { noteName: 'D', octave: 3, accidental: null },      noteheadType: 'normal'   },
  { midiNote: 51, name: 'Ride Cymbal 1',  pitch: { noteName: 'E', octave: 5, accidental: null },      noteheadType: 'x'        },
  { midiNote: 52, name: 'Chinese Cymbal', pitch: { noteName: 'F', octave: 5, accidental: null },      noteheadType: 'x'        },
  { midiNote: 53, name: 'Ride Bell',      pitch: { noteName: 'F', octave: 5, accidental: 'sharp' },   noteheadType: 'diamond'  },
  { midiNote: 54, name: 'Tambourine',     pitch: { noteName: 'G', octave: 5, accidental: null },      noteheadType: 'x'        },
  { midiNote: 55, name: 'Splash Cymbal',  pitch: { noteName: 'G', octave: 5, accidental: 'sharp' },   noteheadType: 'x'        },
  { midiNote: 56, name: 'Cowbell',        pitch: { noteName: 'A', octave: 5, accidental: null },      noteheadType: 'triangle' },
  { midiNote: 57, name: 'Crash Cymbal 2', pitch: { noteName: 'A', octave: 5, accidental: 'sharp' },   noteheadType: 'x'        },
  { midiNote: 59, name: 'Ride Cymbal 2',  pitch: { noteName: 'B', octave: 5, accidental: null },      noteheadType: 'x'        },
]

export function pitchKey(p: Pitch): string {
  return `${p.noteName}${p.octave}${p.accidental ?? ''}`
}

export const DRUM_MAP_BY_MIDI  = new Map(DRUM_MAP.map(d => [d.midiNote, d]))
export const DRUM_MAP_BY_PITCH = new Map(DRUM_MAP.map(d => [pitchKey(d.pitch), d]))
```

`DRUM_MAP_BY_PITCH` is used in `samplerEngine.ts` to resolve the MIDI note for score-mode playback:

```typescript
const midiNote = (n as any).midiDrumNote
  ?? DRUM_MAP_BY_PITCH.get(pitchKey(n.pitch))?.midiNote
  ?? 38  // fallback: snare
scheduleDrumHit(midiNote, liveVolume, volDb, time)
```

`midiDrumNote` (set during MusicXML import) takes precedence over the pitch lookup.

---

## Part 3: MusicXML Drum Import

### Background

MusicXML represents unpitched percussion notes with `<unpitched>` rather than `<pitch>`. The `<instrument id>` references a `<score-instrument>` in `<part-list>` that carries the GM MIDI note via `<midi-unpitched>`. The `<notehead>` element gives the notehead shape, but many exporters omit it.

### 3.1 `<unpitched>` elements

`xmlPitch()` falls back to `<unpitched>` when `<pitch>` is absent:

```typescript
if (unpitchedEl) {
  const noteName = (unpitchedEl.querySelector('display-step')?.textContent?.trim() ?? 'C') as NoteName
  const octave   = parseInt(unpitchedEl.querySelector('display-octave')?.textContent ?? '5', 10)
  return { noteName, octave, accidental: null }
}
```

### 3.2 `<notehead>` elements

`xmlNoteheadType()` maps the element text to `NoteheadType`:

```typescript
const XML_NOTEHEAD_MAP: Record<string, NoteheadType> = {
  'normal': 'normal', 'x': 'x', 'circle-x': 'circle-x',
  'diamond': 'diamond', 'slash': 'slash', 'triangle': 'triangle',
  'cross': 'x', 'cluster': 'normal', 'inverted triangle': 'triangle',
}
```

### 3.3 Instrument → MIDI note lookup and notehead inference

`buildInstrumentMap()` parses `<midi-unpitched>` from `<part-list>` to build an instrument-id → MIDI-note map. During note parsing, the MIDI note is stored as `midiDrumNote` on the event, and the notehead type is resolved with a two-level fallback:

```typescript
const drumMidi     = instrId ? instrumentMap.get(instrId) : undefined
if (drumMidi !== undefined) { (event as any).midiDrumNote = drumMidi }

const noteheadType = xmlNoteheadType(firstEl)              // explicit <notehead> wins
  ?? (drumMidi !== undefined                               // fall back to canonical map
      ? DRUM_MAP_BY_MIDI.get(drumMidi)?.noteheadType
      : undefined)
if (noteheadType && noteheadType !== 'normal') {
  ;(event as any).noteheadType = noteheadType
}
```

This means files that include `<midi-unpitched>` but omit `<notehead>` (common in Sibelius/Finale exports) still get correct x-noteheads on hi-hats, circle-x on open hi-hat, diamond on ride bell, etc.

### 3.4 Part detection

If any note in the part has an `<unpitched>` element, `effectiveMidiChannel` is forced to 10 when constructing the imported `Part`.

---

## Part 4: Realistic Drum Sample Playback

### Background

`drumSamplerEngine.ts` loads MP3 files from `./samples/drums/{midiNote}.mp3` via `Tone.Players`, with a synthesised Web Audio fallback for missing files. Previously it only attempted to load 16 notes. All `soundOnInput` preview paths routed to the piano sampler regardless of stave type.

### 4.1 Sample sourcing *(pending — audio files not yet in repo)*

Obtain free, CC-licensed acoustic drum samples for each of the 24 instruments in `DRUM_MAP`. Recommended sources:

- **[freesound.org](https://freesound.org)** — CC0 individual samples
- **[Sonatina Drumkit](http://sso.mattiaswestlund.net/)** — CC-BY 3.0, high-quality acoustic kit
- **gleitz/midi-js-soundfonts** — pre-converted MP3s for all 128 GM percussion notes

**Format:** MP3 128 kbps (or OGG Vorbis q5), mono, normalised to −3 dBFS, ≤5 ms pre-transient silence, natural release tail retained. Files for rare instruments (cowbell, tambourine) may be absent; the synthesised fallback handles them gracefully.

### 4.2 File layout *(pending)*

```
packages/volta-app/public/samples/drums/{midiNote}.mp3
```

This matches the URL pattern already in `drumSamplerEngine.ts`; no code change needed.

### 4.3 Engine: expanded sample coverage *(implemented)*

`DRUM_SAMPLE_NOTES` in `drumSamplerEngine.ts` is now derived from `DRUM_MAP` rather than a hand-coded list:

```typescript
import { DRUM_MAP } from '@shared/drumMap'
const DRUM_SAMPLE_NOTES: readonly number[] = DRUM_MAP.map(d => d.midiNote)
```

Coverage automatically stays in sync with the drum map (currently 24 instruments, up from 16).

### 4.4 Preview routing *(implemented)*

`triggerDrumInputPreview` is added to `ScoreCanvas.tsx` alongside `triggerInputPreview`:

```typescript
function triggerDrumInputPreview(
  pitch: { noteName: string; octave: number; accidental: string | null | undefined },
  midiDrumNote: number | undefined,
  volDb: number,
  audioMode: 'builtin' | 'midi-out',
  midiChannel: number,
): void {
  if (audioMode === 'midi-out') {
    midiOutputEngine.previewNote(midiDrumNote ?? 38, velocity, midiChannel, 0)
  } else {
    const midi = midiDrumNote ?? DRUM_MAP_BY_PITCH.get(...)?.midiNote ?? 38
    previewDrumHit(midi, volDb)
  }
}
```

Every `soundOnInput` block in `ScoreCanvas.tsx` branches on `isDrumPart` before choosing between the two preview functions. This covers all 16 paths:

| Callback | Paths covered |
|---|---|
| `enterNote` | rest-replace, add-to-chord, append |
| `enterNoteAtPitch` | rest-replace, chord-mode, overwrite, append |
| `enterChordAtPitch` | chord-to-chord merge, overwrite, rest-replace |
| `handleCanvasClick` | add-to-existing, rest-replace, append |
| `shiftOctave` | octave up/down on selected note |
| `moveSelectedNotes` | semitone up/down on selected note(s) |
| click-to-select | clicking an existing note/chord in select mode |

`isDrumPart` is detected consistently as:
```typescript
const hasDrumStave = staff.clef === 'percussion'
const isDrumPart   = (part.midiChannel ?? 1) === 10 || hasDrumStave
```

### 4.5 Loading order *(already in place)*

`loadDrumSampler()` is called at app startup in `App.tsx` alongside `loadSampler()`.

---

## Acceptance Criteria

### Notehead types

1. A `NoteheadType` picker appears in the toolbar when in note or rest input mode.
2. Selecting a notehead type and inserting a note on any stave renders the correct notehead (x, circle-x, diamond, slash, triangle).
3. Notehead type survives undo/redo and save/load.
4. On percussion staves in note-input mode, hovering auto-selects the canonical notehead for the drum at that position; moving to a non-percussion stave resets it to normal.

### Drum playback

5. Notes on a percussion stave (any part with `midiChannel === 10` or a percussion clef) play back through the drum sampler in both score-mode and sequencer-mode.
6. Pitch → MIDI note reverse lookup is correct for all 24 instruments in `DRUM_MAP`.
7. Notes with no entry in `DRUM_MAP` fall back to snare (MIDI 38) rather than silence.
8. All `soundOnInput` preview paths on percussion staves (including select-mode navigation) play the drum sampler, not piano.

### MusicXML import

9. A MusicXML file with `<unpitched>` percussion notes imports each note at the correct staff position.
10. `<notehead>x</notehead>` imports as `noteheadType: 'x'`; `<notehead>circle-x</notehead>` as `'circle-x'`; etc.
11. When `<midi-unpitched>` is present but `<notehead>` is absent, notehead type is inferred from `DRUM_MAP_BY_MIDI`.
12. When `<midi-unpitched>` is present, `midiDrumNote` is set and playback uses the exact GM instrument.
13. Imported percussion parts have `midiChannel === 10` set automatically.

### Realistic drum samples

14. Once sample files are placed in `public/samples/drums/`, playback uses sampled audio for all instruments present in `DRUM_MAP`.
15. Note-input preview on a percussion stave routes through `previewDrumHit` on all input paths.
16. Drum sounds load in the background at app start; playback is not blocked.
17. If a sample file is absent, the synthesised fallback fires with no error shown to the user.

---

## Out of Scope

- Ghost notes (parenthesised noteheads) — a separate articulation feature
- Buzz roll (`z`) noteheads
- Per-pitch notehead overrides within a chord
- Multi-velocity drum samples (pp/mf/ff layers)
- Drum input palette / one-click drum-note insertion by instrument name
- Automatic voice assignment (stem-up vs stem-down by instrument family)
- Drum part creation wizard
