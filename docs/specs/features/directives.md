# Performance Directives

## Overview

Performance directives are text annotations attached to a measure that instruct performers how to play and (where applicable) drive playback behaviour. Three categories are supported in this iteration:

| Category   | Examples                        | Scope      | Playback effect                        |
|------------|----------------------------------|------------|----------------------------------------|
| `tempo`    | Allegro, Adagio, ♩=120          | Score-wide | Changes BPM from that measure forward  |
| `dynamic`  | pp, mf, ff                      | Per-part   | Scales part volume from that point     |
| `expression` | pizz., arco, con sord.        | Per-part   | May switch MIDI program (pizz./arco)   |

---

## Data model

### `Directive` (new, in `score.ts`)

```ts
export type DirectiveCategory = 'tempo' | 'dynamic' | 'expression'

export interface Directive {
  readonly id: string
  readonly category: DirectiveCategory
  readonly text: string          // display text, e.g. "Allegro", "mf", "pizz."
  readonly bpm?: number          // tempo only — overrides BPM from this measure forward
  readonly midiProgram?: number  // expression only — overrides part MIDI program (null = restore)
}
```

### `Measure` additions

```ts
readonly directives?: readonly Directive[]
```

Directives are stored per-staff per-measure.

- **Tempo** directives are placed on the **first part's first staff** only (they are global by convention). Resolving the effective tempo at any measure walks backward through that staff's measures looking for a tempo directive's `bpm`, falling back to `score.tempo`.
- **Dynamic / expression** directives are placed on the relevant part's staff measure and are per-part.

---

## Standard values

### Tempo words → default BPM

| Word         | BPM |
|--------------|-----|
| Larghissimo  | 24  |
| Largo        | 40  |
| Larghetto    | 60  |
| Adagio       | 66  |
| Adagietto    | 72  |
| Andante      | 76  |
| Andantino    | 84  |
| Moderato     | 96  |
| Allegretto   | 112 |
| Allegro      | 120 |
| Vivace       | 140 |
| Presto       | 168 |
| Prestissimo  | 200 |

The user may override the BPM number after selecting a word, or type a custom text + BPM.

### Dynamics → MIDI velocity and volume multiplier

Each dynamic level maps to a canonical MIDI velocity (0–127) and a derived volume multiplier used by the audio and sampler engines. These constants live in `musicUtils.ts` as `DYNAMIC_VELOCITY` and `DYNAMIC_VOLUME`.

| Dynamic | MIDI velocity | Volume multiplier |
|---------|--------------|-------------------|
| pppp    | 10           | 0.08              |
| ppp     | 22           | 0.15              |
| pp      | 36           | 0.25              |
| p       | 50           | 0.40              |
| mp      | 62           | 0.55              |
| mf      | 75           | 0.65              |
| f       | 88           | 0.80              |
| ff      | 101          | 0.90              |
| fff     | 112          | 1.00              |
| ffff    | 120          | 1.00              |
| sfz     | 122          | 0.90              |
| fp      | 88           | 0.40              |

Measure-level dynamic directives apply their multiplier to all notes in that measure and forward, until a later directive overrides it.

### Expression presets

| Text        | Playback effect                                     |
|-------------|-----------------------------------------------------|
| pizz.       | Switch part MIDI program to 45 (Pizzicato Strings)  |
| arco        | Restore part MIDI program to `part.midiProgram`     |
| con sord.   | Text only (no playback change in this iteration)    |
| senza sord. | Text only                                           |
| rit.        | Text only (gradual tempo change deferred)           |
| accel.      | Text only                                           |
| meno mosso  | Text only                                           |
| più mosso   | Text only                                           |

`pizz.` stores `midiProgram: 45` on the directive. `arco` stores `midiProgram: -1` (sentinel for "restore original"). Other expressions store no `midiProgram`.

---

## Commands

```ts
| { type: 'ADD_DIRECTIVE';    partId: string; staffId: string; measureId: string; directive: Directive }
| { type: 'REMOVE_DIRECTIVE'; partId: string; staffId: string; measureId: string; directiveId: string }
```

`ADD_DIRECTIVE` appends to `measure.directives`. There is no uniqueness constraint — multiple directives of the same or different categories may coexist on a measure.

---

## Rendering

Directives are drawn in the **VexFlow headroom zone** — the 40 px band between `layout.staveY` (top of the Stave object) and `layout.staveTopY` (the first actual staff line). This zone is already reserved by VexFlow for clef/modifier overflow.

### Layout rules

```
layout.staveY      ┌──────────────────────────────────┐  ← Stave object top (y)
                   │  Allegro ♩=120      mf   pizz.   │  ← directive text zone
layout.staveTopY   ├──────────────────────────────────┤  ← first staff line
                   │  ════════════════════════════════ │
```

- **Tempo**: drawn at `(layout.x + 4, layout.staveY + 14)`, font `bold italic 12px sans-serif`, colour `#111`. Only on the **first part's stave** in a row. Shown when the measure carries a tempo directive OR when the first measure carries the score's default tempo.
- **Dynamics**: drawn at `(noteAreaMidX, layout.staveY + 14)`, font `bold 12px serif`, centred, colour `#111`. On each part's stave that has the dynamic.
- **Expression**: drawn at `(layout.x + 4, layout.staveY + 26)`, font `italic 11px serif`, colour `#444`. On each part's stave.

Where multiple directives of the same category exist on a measure they are drawn left-to-right separated by spaces.

### First-measure tempo

The score's root `tempo` (BPM) is always displayed above the first measure as a tempo directive even if no explicit `Directive` object exists there, so the score always shows a tempo indication.

---

## Click detection

In **select mode**, a click with `layout.staveY ≤ y < layout.staveTopY` (the 40 px headroom) opens the `DirectivePicker` for that measure + part.

The picker is positioned at the click's screen coordinates (fixed, like `BarlinePicker`).

---

## `DirectivePicker` component

A floating panel with three sections:

### Existing directives

A list of all directives currently on the measure with an `×` remove button each.

### Add — Tempo (shown for the first part's stave only)

- Row of named tempo buttons (Largo … Prestissimo). Clicking one sets both text and the default BPM.
- BPM number field (editable — overrides the word's default).
- "Custom" text field for arbitrary marking (e.g. "Très lent").
- Confirm button → dispatches `ADD_DIRECTIVE`.

### Add — Dynamic

- Eight buttons: `ppp  pp  p  mp  mf  f  ff  fff`. Clicking one immediately dispatches `ADD_DIRECTIVE`.

### Add — Expression

- A grid of preset buttons (pizz., arco, con sord., senza sord., rit., accel., meno mosso, più mosso).
- A free-text field for arbitrary expressions.
- Confirm button → dispatches `ADD_DIRECTIVE`.

---

## Playback changes

### Tempo resolution (`resolveDirectiveTempo`)

```ts
function resolveDirectiveTempo(measures: Measure[], idx: number, scoreTempo: number): number {
  for (let i = idx; i >= 0; i--) {
    const d = measures[i].directives?.find(d => d.category === 'tempo' && d.bpm != null)
    if (d?.bpm != null) return d.bpm
  }
  return scoreTempo
}
```

Called from `audioEngine` for the first part's staff when scheduling each measure's notes.

### Dynamic resolution (`resolveDirectiveDynamic`)

```ts
function resolveDirectiveDynamic(measures: Measure[], idx: number): number | null {
  for (let i = idx; i >= 0; i--) {
    const d = measures[i].directives?.find(d => d.category === 'dynamic')
    if (d) return DYNAMIC_VOLUME[d.text] ?? null
  }
  return null  // no dynamic → use part.volume unchanged
}
```

### Playback velocity priority chain

All three playback engines (audio, sampler, MIDI output) resolve playback volume/velocity using the same priority order, highest to lowest:

1. **Explicit velocity** (`event.velocity`, 0–127) — set by the user in the Event Editor or preserved from MIDI import. In MIDI output, scaled by `partVol * velFactor * hairpinFactor`. In audio/sampler, expressed as `partVol * (velocity / 127)`.
2. **Per-note dynamic** (`event.dynamic`, e.g. `'f'`) — maps to `DYNAMIC_VELOCITY` for MIDI output and `DYNAMIC_VOLUME` for audio/sampler. Overrides any measure directive for that specific note only.
3. **Measure directive dynamic** — `resolveDirectiveDynamic()` scans backward to find the nearest dynamic directive; its `DYNAMIC_VOLUME` multiplier is used as an absolute volume level.
4. **Part volume** (`part.volume`) — the default when no dynamic context applies.

Articulation modifiers (`velFactor`, `volDbBonus`) and hairpin interpolation are applied on top of whichever level wins.

### MIDI program resolution (`resolveDirectiveMidiProgram`)

```ts
function resolveDirectiveMidiProgram(measures: Measure[], idx: number, partMidiProgram: number): number {
  for (let i = idx; i >= 0; i--) {
    const d = measures[i].directives?.find(d => d.category === 'expression' && d.midiProgram != null)
    if (d?.midiProgram === -1) return partMidiProgram   // arco — restore original
    if (d?.midiProgram != null) return d.midiProgram    // pizz. or other override
  }
  return partMidiProgram
}
```

Note: MIDI program switching in the current Tone.js synth-based engine will be a best-effort approximation (e.g. switching to a plucked envelope for pizz.). Full sample-based switching is deferred.

---

## Out of scope (this iteration)

- Gradual tempo changes (rit., accel., rallentando)
- Hairpin dynamics (crescendo / decrescendo)
- Rehearsal marks
- Multi-measure spanning directives
- Beat-level positioning within a measure (all directives attach at measure start)

---

## Amendment: Piano Pedal Marks

### Overview

Piano pedal marks indicate when the sustain pedal should be depressed and released. They are beat-precise, first-class notation elements rendered below the stave using traditional symbols.

| Symbol | Meaning    | MIDI effect        |
|--------|------------|--------------------|
| `Ped`  | Pedal down | CC 64, value 127   |
| `✤`    | Pedal up   | CC 64, value 0     |

Pedal marks are available on any part and are per-staff. Playback fires CC64 on MIDI output only — the sampler engine ignores them.

---

### Data model

#### `PedalMark` (new, in `score.ts`)

```ts
export interface PedalMark {
  readonly id:           string
  readonly type:         'down' | 'up'
  readonly beatPosition: number   // in sixteenth-note units (0 = measure start)
}
```

#### `Measure` addition

```ts
readonly pedalMarks?: readonly PedalMark[]
```

---

### Commands

```ts
| { type: 'ADD_PEDAL_MARK';    partId: string; staffId: string; measureId: string; mark: PedalMark }
| { type: 'REMOVE_PEDAL_MARK'; partId: string; staffId: string; measureId: string; markId: string }
```

`ADD_PEDAL_MARK` appends to `measure.pedalMarks`. `REMOVE_PEDAL_MARK` filters by `markId`.

---

### Rendering

Pedal marks are drawn **below the stave**, in the zone used by MIDI event labels (the 40 px band below the bottom staff line). They sit on a separate row from MIDI event labels to avoid overlap — pedal marks occupy the first row (closest to the stave), MIDI labels the second.

```
                   │  ════════════════════════════════ │  ← bottom staff line
staveBottom + 6    │  Ped              ✤               │  ← pedal mark row
staveBottom + 22   │  [cc:7=64]                        │  ← MIDI event label row
```

#### Symbol rendering

- **`Ped`** — italic serif font, 13 px, color `#2a2a8a` (dark blue), positioned at the beat-precise X using the same `noteStartX` interpolation as MIDI events.
- **`✤`** — same font/size/color, positioned at its beat-precise X.

Beat-precise X is computed as: `noteStartX + (beatPosition / measureCapacity) * (staveRight - noteStartX)`.

---

### Placement UI

Pedal marks are placed in **Marks (text) mode** (`T` key). Clicking in the pedal zone below a stave (y between `staveBottom + 2` and `staveBottom + 18`) opens a small `PedalMarkPicker` popover.

#### `PedalMarkPicker`

A minimal floating popover (similar to `MidiEventPicker` in style) containing:

1. **Beat position** — number input (sixteenth-note units, 0–`measureCapacity-1`), pre-filled from click X.
2. **Type** — two buttons: `Ped` and `✤`. Selected type is highlighted.
3. **Existing marks** — list of current pedal marks on this measure with `×` remove buttons (shows beat position + symbol).
4. **Add** button → dispatches `ADD_PEDAL_MARK`.

The popover is positioned at the click's screen coordinates (fixed, like other pickers).

---

### Playback

Only `midiOutputEngine` fires CC64 events. `audioEngine` and `samplerEngine` ignore pedal marks.

In `midiOutputEngine.playScore`, after the note scheduling loop for each part, iterate `sequence` and for each measure schedule each `PedalMark`:

```ts
const eventT = measStartT + (mark.beatPosition / 16) * (60 / localBpm)
Tone.Transport.schedule((time) => {
  const ts = perfAudioOffset + time * 1000
  output.send([0xB0 | channel, 64, mark.type === 'down' ? 127 : 0], ts)
}, eventT)
```

At playback stop, CC64 is silenced implicitly by the existing `allNotesOff` (which sends CC 123 and CC 120). An explicit CC64=0 reset is also sent to each channel on stop:

```ts
output.send([0xB0 | ch, 64, 0])
```

---

### File changes summary

| File | Change |
|------|--------|
| `src/shared/score.ts` | Add `PedalMark` interface; add `pedalMarks?` to `Measure` |
| `src/shared/commands.ts` | Add `ADD_PEDAL_MARK`, `REMOVE_PEDAL_MARK` to Command union and reducer |
| `src/renderer/engine/midiOutputEngine.ts` | Schedule CC64 events from `pedalMarks`; send CC64=0 on stop |
| `src/renderer/engine/notationRenderer.ts` | Add `drawPedalMarks` function; call after `drawMidiEvents` |
| `src/renderer/components/PedalMarkPicker.tsx` | New component (beat input, Ped/✤ toggle, existing list) |
| `src/renderer/components/ScoreCanvas.tsx` | Add pedal zone click detection in text mode; render `PedalMarkPicker` |
