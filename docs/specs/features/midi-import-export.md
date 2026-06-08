# MIDI Import / Export

## Overview

This spec defines bidirectional MIDI file support: exporting the current score as a standard MIDI file, and importing a MIDI file into a new score. The `@tonejs/midi` library handles MIDI binary encoding and decoding.

The feature targets professional DAW / notation-editor quality: multi-part scores export as multi-track MIDI Type 1 files with correct velocity, dynamics, articulations, pedal marks, program changes, and mid-score tempo / time-signature changes. Import reconstructs a fully-voiced multi-part score from any standard MIDI file, including drum tracks.

---

## Goals

- Export a full multi-part score to a `.mid` file that is immediately usable in any DAW (GarageBand, Logic, Ableton, MuseScore, Sibelius, etc.)
- Import any standard MIDI file and produce a playable, multi-part notation score with correct pitches, durations, and dynamics
- Preserve time signature, key signature, and tempo — including mid-score changes — on both paths
- Map velocity ↔ dynamics and articulations on both paths
- Emit program changes so imported files play back with the correct GM sound on export, and detect instrument from program number on import
- Handle drum/percussion tracks (MIDI channel 10) correctly
- Require no changes to the core Score model (all information is already present)

---

## Out of Scope (this iteration)

- Swing feel / groove quantisation on import
- Triplet-grid quantisation on import (tuplets are approximated to nearest standard duration)
- SysEx pass-through on export
- MIDI Type 2 (multi-song) files
- Round-trip fidelity of slurs (slur endpoints are not stored in standard MIDI)
- Lyrics (MIDI lyric meta-events exist but are not part of the Score model)
- Hairpin import (velocity gradients inside a single MIDI track cannot be reliably decoded back to crescendo / decrescendo marks)

---

## MIDI Export

### Trigger

**File → Export as MIDI…** (menu item, `Cmd/Ctrl+Shift+M`).

The menu sends `menu:exportMidi` to the renderer. The renderer converts the score to MIDI bytes and invokes `electronAPI.exportMidi(bytes)`, which opens a Save dialog filtered to `.mid` and writes the file.

### MIDI file format

**MIDI Type 1** (multi-track). One conductor track (track 0) carries all tempo, time signature, and key signature meta-events. Each Part maps to one additional MIDI track. Type 1 is the standard for multi-instrument DAW interchange.

Scores with a single part still export as Type 1 with a conductor track + one data track (maximally compatible; DAWs accept this without issue).

### Tick resolution

PPQ (pulses per quarter note) = **480** (common DAW default, supported by `@tonejs/midi`).

Duration → ticks:

```
ticks = beats × PPQ
beats = DURATION_UNITS[duration] / 16   (DURATION_UNITS are in 64th-note units, quarter = 16)
      × dotFactor × tupletFactor

dotFactor   = dots=0 → 1.0 | dots=1 → 1.5 | dots=2 → 1.75
tupletFactor = normal / actual  (e.g. triplet: 2/3 ≈ 0.667)
```

### Conductor track (track 0)

The conductor track contains only meta-events; it carries no note data.

| Source | Meta-event |
|---|---|
| `score.tempo` | Tempo (μs/beat) at tick 0 |
| `score.timeSignature` | Time signature at tick 0 |
| `score.keySignature` | Key signature at tick 0 |
| Directive with `bpm` in any measure | Additional tempo meta-event at that measure's start tick |
| Measure-level `timeSignature` override | Additional time signature meta-event at that measure's start tick |
| Measure-level `keySignature` override | Additional key signature meta-event at that measure's start tick |

Mid-score changes are emitted in tick order. The `resolveTimeSig`, `resolveKeySig`, and `resolveTempo` helpers in `musicUtils.ts` are used to walk all measures and collect changes.

### Per-part tracks (track 1+)

Each Part produces one MIDI track. The track order follows the Part order in the score.

#### Track name

The MIDI track name meta-event is set to `part.name` (e.g. "Violin I").

#### Channel assignment

Each Part is assigned a MIDI channel:

- `part.midiChannel` if explicitly set.
- Otherwise `partIndex + 1` (1-based), clamped to 1–16.
- Percussion Parts (instrument family `"percussion"` or MIDI channel 10) always use channel 10.

If the score has more than 15 melodic parts, channels 1–9, 11–16 are used (15 melodic channels). A warning is logged; DAW playback may collapse some channels.

#### Program change

At tick 0 of each track, emit a Program Change on the part's channel:
`midiProgram = part.midiProgram` (GM 0–127).

If a Directive with a `midiProgram` field appears at a measure boundary, emit an additional Program Change at that tick.

#### Note events

| Score element | MIDI representation |
|---|---|
| `Note` event | Note-on + note-off pair at correct tick; pitch computed from sounding pitch (see Transposing Instruments) |
| `Rest` event | Gap — silence for the rest's duration |
| `Chord` event | Multiple simultaneous note-on / note-off pairs |

#### Velocity

Velocity is a 0–127 integer resolved per note using the following priority order:

1. **Explicit `event.velocity`** — if set on the `Note` or `Chord`, used directly (still scaled by articulation modifier and `part.volume`)
2. **Note-attached dynamic** — `event.dynamic` (e.g. `mf`) maps to a fixed velocity via the table below
3. **Measure directive dynamic** — nearest `Directive` of category `"dynamic"` scanning backward from the note's measure
4. **Default** — `mf` (75) if none of the above apply

`event.velocity` is set automatically on `Note` and `Chord` events during MIDI import, preserving per-note velocity with full fidelity. It can also be set manually in the Event Editor.

Velocity is a 0–127 integer derived from the effective dynamic level at each note when no explicit velocity is set.

Dynamic baseline (MIDI velocity):

| Dynamic | Velocity |
|---|---|
| pppp | 10 |
| ppp | 22 |
| pp | 36 |
| p | 50 |
| mp | 62 |
| mf | 75 |
| f | 88 |
| ff | 101 |
| fff | 112 |
| ffff | 120 |
| sfz | 122 |
| fp | 88 (first note only; subsequent notes at p = 50) |

The effective dynamic at each note is resolved by scanning backwards from the note's measure for the nearest `DynamicLevel` or `Directive` of category `"dynamic"`. If none is found, `mf` (75) is used.

Hairpins (crescendo / decrescendo) linearly interpolate velocity between the baseline at the hairpin start and the baseline at the hairpin end across all notes within the hairpin span.

Part-level volume (`part.volume`, 0–1) scales the final velocity: `velocity = round(resolved × part.volume)`, clamped to 1–127. Muted parts are exported with velocity 0 (or omitted — see open question below).

#### Articulation duration modifiers

Articulations shorten or lengthen the note-off tick relative to the theoretical note-off, matching the playback engine's `articulationPlaybackMods()`:

| Articulation | Duration multiplier |
|---|---|
| staccato | 0.5 |
| staccatissimo | 0.25 |
| tenuto | 1.0 (full value) |
| marcato | 0.9 |
| (none / accent) | 0.9 (standard detaché) |
| fermata | 2.0 |

The note-on tick is unchanged; only the note-off tick shifts.

#### Articulation velocity modifiers

| Articulation | Velocity multiplier |
|---|---|
| accent | × 1.2 |
| marcato | × 1.3 |
| sforzando | × 1.4 |
| (others) | × 1.0 |

#### Pedal marks

`PedalMark` events on a Staff are converted to CC 64 (sustain pedal):

- Pedal down → CC 64 value 127 at the pedal mark's beat position.
- Pedal up → CC 64 value 0 at the release beat position.

#### Embedded MIDI events (CC, PC, pitch bend)

`MidiScoreEvent` records embedded in measures are emitted at their precise tick positions:

| MidiScoreEvent type | MIDI output |
|---|---|
| `cc` | Control Change on the part's channel |
| `pc` | Program Change on the part's channel |
| `pb` | Pitch Bend on the part's channel |

SysEx events are **not** exported in this iteration.

#### Transposing instruments

Sounding pitch = written pitch transposed by `part.transposeSemitones`. The MIDI note number always reflects the **sounding** (concert) pitch so that DAW playback is correct. Example: a Bb clarinet part written as C5 exports as Bb4 (MIDI 70 → 58).

### Pitch encoding

```
semitone = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }
           + accidental (sharp+1, flat−1, doubleSharp+2, doubleFlat−2)
midi = (octave + 1) × 12 + semitone − part.transposeSemitones
```

The transposeSemitones is **subtracted** because a positive value means the written pitch is above concert pitch — export must output the concert (sounding) pitch.

Middle C = C4 = MIDI 60. A4 = MIDI 69.

### Repeat expansion

Repeats (volta brackets, D.C., D.S., etc.) are **expanded** before export so the MIDI file plays through as the performer would — consistent with the `buildPlaybackSequence()` helper used by the audio engine. An option to export without repeat expansion is a future enhancement.

### Muted parts

Muted parts are **omitted** from the exported file — the result matches what the listener hears. A future "Export all parts" option can include muted tracks as silent channels.

---

## MIDI Import

### Trigger

**File → Import MIDI…** (menu item). Opens an Open dialog filtered to `.mid` / `.midi`. Replaces the current score (same "unsaved changes?" guard as File → New).

The menu sends `menu:importMidi`. The renderer invokes `electronAPI.importMidi()`, receives the file bytes, converts to a Score, and calls `loadScore`.

### Multi-track import

Each MIDI track that contains note data becomes one Part in the new Score.

- Tracks with no note events (e.g. a pure-meta conductor track) are skipped.
- Track order in the MIDI file → Part order in the Score.
- The MIDI track name meta-event becomes `part.name` (and `part.shortName`, truncated to 6 chars + ".").

If the file has only one track with notes, the result is a single-part score (same as the original iteration).

### Instrument detection

For each Part:

1. Read the first Program Change event on the track's primary channel.
2. Look up the GM program number in the instruments database (`instruments.ts`) to find the closest matching instrument (by `midiProgram`).
3. Set `part.midiProgram`, `part.midiChannel`, `part.transposeSemitones`, and default clef from the matched instrument.
4. If no Program Change is found, default to `midiProgram = 0` (Acoustic Grand Piano).

### Channel assignment and drum detection

Each track's primary channel is the channel used by the majority of its note events.

- If the primary channel is **10**, the track is treated as a **percussion/drum track** (see Drum Track Import below).
- Otherwise, the channel is recorded as `part.midiChannel`.

### Percussion / drum track import

Channel 10 tracks use GM drum map pitch assignments rather than melodic pitches.

- Each distinct drum note (MIDI pitch) is imported as a separate `Note` on a **percussion staff** (unpitched, bass clef).
- The note's written pitch is mapped to a conventional drum notation position using the GM standard drum map (kick = C2, snare = D2, hi-hat = F#2, etc.) — the same mapping used by MuseScore and Sibelius.
- `part.name` defaults to "Drums" if no track name meta-event is present.
- `part.midiChannel` is set to 10.

### What is imported per track

| MIDI element | Score result |
|---|---|
| Track name meta-event | `part.name` |
| First Program Change | `part.midiProgram` + instrument lookup |
| Tempo events | `score.tempo` (first), additional tempo Directives at measure boundaries |
| Time signature events | `score.timeSignature` (first), additional per-measure overrides |
| Key signature events | `score.keySignature` (first), additional per-measure overrides |
| Note events | Note or Chord events in Voice 0 (see Multi-voice below) |
| Gaps between notes | Rest events of the nearest quantised duration |
| Note velocity | `DynamicLevel` Directive at the note's measure (see Velocity import) |
| CC 64 events | `PedalMark` records on the Staff |

### Velocity → dynamics import

Velocity ranges are mapped to `DynamicLevel` on import. A Directive is inserted at the start of a measure when the effective dynamic changes:

| MIDI velocity range | Dynamic |
|---|---|
| 1–15 | pppp |
| 16–31 | ppp |
| 32–47 | pp |
| 48–59 | p |
| 60–71 | mp |
| 72–85 | mf |
| 86–99 | f |
| 100–111 | ff |
| 112–120 | fff |
| 121–127 | ffff |

A new Directive is emitted only when the inferred dynamic changes, avoiding redundant markings.

### Pitch decoding

```
octave    = floor(midi / 12) − 1
semitone  = midi % 12
```

Semitone → note name is key-signature-aware: sharps are preferred in sharp keys (positive `fifths`), flats in flat keys (negative `fifths`), and sharps in C major (neutral). This avoids Db in G major or F# in F major.

| Semitone | Neutral / sharp key | Flat key |
|---|---|---|
| 0 | C | C |
| 1 | C# | Db |
| 2 | D | D |
| 3 | D# | Eb |
| 4 | E | E |
| 5 | F | F |
| 6 | F# | Gb |
| 7 | G | G |
| 8 | G# | Ab |
| 9 | A | A |
| 10 | A# | Bb |
| 11 | B | B |

### Transposing instruments on import

After instrument detection, written pitch is computed by reversing the sounding-pitch transposition:

```
writtenMidi = concertMidi + part.transposeSemitones
```

This is the inverse of the export formula. Example: Bb clarinet (transposeSemitones = 2), MIDI 70 (Bb4 concert) → written MIDI 72 (C5).

The Score stores written pitches (as displayed), so the part looks correct in the notation without a separate concert-pitch toggle in this iteration.

### Quantisation

MIDI note durations are continuous; the Score model is discrete. Each note's duration is snapped to the nearest value (beats, at denominator = 4):

| Duration | Beats | Dotted |
|---|---|---|
| Whole | 4 | 6 |
| Half | 2 | 3 |
| Quarter | 1 | 1.5 |
| Eighth | 0.5 | 0.75 |
| 16th | 0.25 | 0.375 |
| 32nd | 0.125 | 0.1875 |
| 64th | 0.0625 | — |

Snapping uses nearest-distance. Notes shorter than 0.05 beats are discarded. Double-dotted values are not quantised to in this iteration.

The quantisation grid is **straight** (no swing or triplet grid in this iteration).

### Chord detection

Notes whose tick positions are equal (or within 5 ticks of each other) are grouped into a `Chord` event. The chord's duration is the duration of the longest note in the group.

### Multi-voice detection

Within a single MIDI track, simultaneous melodic lines are imported into separate Voices:

1. Sort all note events by start tick.
2. Walk notes in order. Assign a note to Voice 0 if it starts after the current Voice 0 cursor (end of previous Voice 0 note). Otherwise assign to Voice 1.
3. Only two voices are supported per staff in this iteration. Additional simultaneous lines are merged into Voice 1.

Voice 1 is only created when overlapping notes are actually detected; single-line tracks produce a single-voice staff.

### Measure assembly

1. Compute measure capacity in beats = `numerator × (4 / denominator)`.
2. Walk the quantised note/rest sequence in order, filling measures.
3. When a note would overflow a measure, truncate it at the barline (discard remainder) and insert a tied note at the start of the next measure. If the remainder is too short to quantise, discard it.
4. Add whole-rest auto-fill at the end of the last measure if it is not full.
5. Append empty measures to reach at least 8 (the score default).

Mid-score time signature changes cause a new measure capacity to be used from that measure onwards.

### Mid-score tempo / time signature / key changes on import

Tempo change events, time signature events, and key signature events that fall mid-score are mapped to the nearest measure boundary and stored as:

- Tempo change → `Directive` of category `"tempo"` with `bpm` set.
- Time signature change → `measure.timeSignature` override.
- Key signature change → `measure.keySignature` override.

Events that fall within a measure (not on a barline) are assigned to the start of the next measure.

---

## IPC / Preload changes

MIDI files are binary. IPC channels pass `Uint8Array` (renderer) ↔ `Buffer` (main).

### IPC handlers (main process)

```
midi:export  { bytes: Buffer }     → { success: boolean }
midi:import  ()                    → { bytes: Buffer; path: string } | null
```

### Preload methods

```typescript
exportMidi: (bytes: Uint8Array) => Promise<{ success: boolean }>
importMidi: ()                   => Promise<{ bytes: Uint8Array; path: string } | null>
```

---

## Menu changes

| Item | Location | Accelerator | Channel |
|---|---|---|---|
| Export as MIDI… | File menu, after Export as PDF | `Cmd/Ctrl+Shift+M` | `menu:exportMidi` |
| Import MIDI… | File menu, after Export as MIDI | — | `menu:importMidi` |

---

## Module: `midiEngine.ts`

Located at `src/renderer/engine/midiEngine.ts`. Pure functions, no React or store imports.

```typescript
export interface MidiExportOptions {
  expandRepeats?: boolean  // default true — expand repeat signs before export
}

export function scoreToMidi(score: Score, opts?: MidiExportOptions): Uint8Array
export function midiToScore(bytes: Uint8Array): Score
```

Internal helpers (not exported):

```typescript
function buildConductorTrack(score: Score, ppq: number): MidiTrack
function buildPartTrack(score: Score, part: Part, partIndex: number, ppq: number): MidiTrack
function resolveVelocity(score: Score, part: Part, partIndex: number, measure: Measure, event: NoteEvent): number
function applyHairpinVelocities(track: MidiTrack, score: Score, part: Part): void
function quantiseDuration(ticks: number, ppq: number): { duration: Duration; dots: number }
function inferDynamic(velocity: number): DynamicLevel
function detectVoices(noteEvents: RawMidiNote[]): [RawMidiNote[], RawMidiNote[]]
function detectDrumTrack(track: MidiTrack): boolean
```

---

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Muted parts on export | Omit entirely — exported file matches what the listener hears |
| 2 | Concert pitch toggle on import | Import at written pitch; no toggle in this iteration |
| 3 | Tie representation at barlines on import | Notes truncated at barlines become tied pairs (tieStart / tieEnd) |
| 4 | Quantisation grid selector | No UI selector — straight quantisation only; future feature |
| 5 | Repeat expansion toggle | `expandRepeats` option on `scoreToMidi` (default `true`); export dialog toggle is future UI work |
| 6 | Part selection on import | Out of scope — all note-bearing tracks are imported |

---

## Acceptance Criteria

### Export — single part

1. File → Export as MIDI… opens a Save dialog filtered to `.mid`.
2. The exported file opens in GarageBand / MuseScore and plays the correct pitches in the correct order.
3. Note durations are proportionally correct (quarter = half the duration of a half note).
4. Dotted notes are 1.5× the duration of the plain equivalent.
5. Rests produce silence for the correct duration.
6. A chord exports all pitches sounding simultaneously.
7. The file's tempo matches `score.tempo`.

### Export — multi-part

8. A score with N parts exports a MIDI Type 1 file with N+1 tracks (conductor + N data tracks).
9. Each data track is named after the corresponding Part.
10. Each data track's first event is a Program Change matching the part's `midiProgram`.
11. Each data track uses the correct MIDI channel (per `midiChannel` or `partIndex + 1`).
12. Percussion parts use MIDI channel 10.

### Export — dynamics and articulations

13. A note in a measure marked `ff` exports with a velocity of approximately 101 (±5).
14. A staccato note's note-off occurs at approximately 50% of its theoretical duration.
15. A note within a crescendo hairpin has higher velocity than the same note before the hairpin started.
16. Pedal marks export as CC 64 (value 127 = down, 0 = up) at the correct tick.

### Export — mid-score changes

17. A tempo change directive mid-score emits a second tempo meta-event at the correct tick.
18. A time signature change emits a second time-signature meta-event at the correct tick.

### Export — transposing instruments

19. A Bb clarinet note written as C5 exports as Bb4 (MIDI 58).

### Import — single track

20. File → Import MIDI… opens an Open dialog filtered to `.mid` / `.midi`.
21. Importing a file with 4/4 time signature and C major key produces a score with those settings.
22. A C4 quarter note imports as a quarter-note C4.
23. Notes at the same tick position import as a chord.
24. Gaps between notes produce rest events of the nearest quantised duration.
25. Importing replaces the current score.

### Import — multi-track

26. A MIDI file with 3 note-bearing tracks produces a score with 3 parts.
27. Track names become Part names.
28. Program Changes are reflected in `part.midiProgram` and the instrument lookup populates the correct default clef and transposition.

### Import — dynamics and percussion

29. A note with velocity 88 imports with a `f` dynamic marking.
30. A dynamic marking is not re-emitted redundantly if adjacent notes share the same dynamic.
31. A channel-10 track imports as a percussion part with drum-map pitch positions.

### Import — tied notes and voices

34. A MIDI note that straddles a barline is imported as a tied pair: the first note has `tieStart: true` and the second has `tieEnd: true`.
35. A MIDI track containing two overlapping melodic lines produces a staff with two voices.

### Import — mid-score changes

36. A tempo change event mid-MIDI file produces a tempo Directive at the appropriate measure.
37. A time signature change event mid-MIDI file sets `measure.timeSignature` on the appropriate measure.
