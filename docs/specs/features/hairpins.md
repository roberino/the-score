# Hairpins (Crescendo / Decrescendo)

## Overview

Hairpin markings indicate a gradual change in dynamic level across a span of notes. A crescendo (opening wedge) means "get louder"; a decrescendo / diminuendo (closing wedge) means "get softer."

## Data model

A `Hairpin` lives on a `Staff`, similarly to `Slur`:

```ts
export type HairpinType = 'crescendo' | 'decrescendo'

export interface Hairpin {
  readonly id: string
  readonly type: HairpinType
  readonly fromNoteId: string   // first NoteEvent id in the span
  readonly toNoteId:   string   // last  NoteEvent id in the span
  readonly placement?: 'above' | 'below'  // default: below
}
```

`Staff` gains an optional `hairpins?: readonly Hairpin[]` field.

## Creation

1. User selects a range of notes (multi-select, at least 2).
2. Clicks `<` (crescendo) or `>` (decrescendo) toolbar button, or presses keyboard shortcut.
3. A `Hairpin` is added spanning the first and last selected note.
4. Duplicate hairpins on the same span are not allowed; adding a second one replaces the first.

## Deletion

- Select any note within the hairpin span → the hairpin highlights.
- Press Delete/Backspace, or click an × affordance that appears on hover.

## Rendering

- Drawn as a standard wedge (two diverging or converging lines) below the staff, below any slurs or articulations.
- Lines begin at the notehead of `fromNote` and end at the notehead of `toNote`.
- Thickness and angle scale with zoom.

## Playback

- On playback, MIDI velocity is interpolated linearly across the span: crescendo ramps from the current dynamic level up, decrescendo ramps down.
- Default dynamic baseline: velocity 64 (mp). Range of ramp: ±32 (pp ≈ 32, ff ≈ 96) unless a dynamic directive (`p`, `f`, etc.) is present, in which case that anchors the start or end velocity.

## PDF export

- Hairpins are rendered via Verovio (they appear in the MusicXML output and Verovio draws them automatically).

## Open questions (to resolve before implementation)

- [ ] Should hairpins span across measure boundaries?
- [ ] Should hairpins be part of multi-select or a separate affordance?
- [ ] Keyboard shortcut preference (e.g. `<` / `>`, or `H` for hairpin)?
- [ ] Playback: ramp velocity, or leave for a later iteration?
