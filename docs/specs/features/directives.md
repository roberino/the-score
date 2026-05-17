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

### Dynamics → volume multiplier

| Dynamic | Multiplier |
|---------|-----------|
| ppp     | 0.15      |
| pp      | 0.25      |
| p       | 0.40      |
| mp      | 0.55      |
| mf      | 0.65      |
| f       | 0.80      |
| ff      | 0.90      |
| fff     | 1.00      |

Multiplier is applied to the part's base volume (`part.volume`) at that measure.

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
const DYNAMIC_VOLUME: Record<string, number> = {
  ppp: 0.15, pp: 0.25, p: 0.40, mp: 0.55, mf: 0.65, f: 0.80, ff: 0.90, fff: 1.00
}

function resolveDirectiveDynamic(measures: Measure[], idx: number): number | null {
  for (let i = idx; i >= 0; i--) {
    const d = measures[i].directives?.find(d => d.category === 'dynamic')
    if (d) return DYNAMIC_VOLUME[d.text] ?? null
  }
  return null  // no dynamic → use part.volume unchanged
}
```

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
