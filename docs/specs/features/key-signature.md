# Key Signature

## Overview

Key signatures can be set per measure, allowing modulations within a score. The initial key is C major (0 sharps/flats) and applies globally until overridden on a specific measure. When a key changes, explicit note accidentals that are now implied by the new key are stripped from all affected notes.

---

## Data Model

`KeySignature` is already defined in `score.ts`:

```ts
interface KeySignature {
  fifths: number   // -7 (7 flats) to +7 (7 sharps); 0 = C major / A minor
  mode: 'major' | 'minor'
}
```

`Measure.keySignature?: KeySignature` stores per-measure overrides.  
`score.keySignature` is the global default.

Effective key resolution is the same walk-back pattern as time signatures:

```
effectiveKey(measure M) =
  M.keySignature
  ?? nearest preceding measure with .keySignature set
  ?? score.keySignature
```

---

## SET_KEY Command

Already defined in the Command union. Implement the handler:

```
{ type: 'SET_KEY', partId, staffId, measureId, key: KeySignature }
```

**Accidental stripping**: after setting `measure.keySignature`, walk every note event in voices of the affected staff from `measureId` onwards. For each `Note` or `Chord` pitch:

- Compute the set of accidentals implied by the new key:
  - Sharps order (F C G D A E B) — key fifths = +n uses the first n entries.
  - Flats order (B E A D G C F) — key fifths = −n uses the first n entries.
- If `pitch.accidental === 'sharp'` and the new key implies sharp on that note name → set `accidental = null`.
- If `pitch.accidental === 'flat'` and the new key implies flat on that note name → set `accidental = null`.
- Natural signs (`'natural'`) are left unchanged.

Add a corresponding `SET_SCORE_KEY` command:

```
{ type: 'SET_SCORE_KEY', key: KeySignature }
```

Sets `score.keySignature` and runs the accidental-stripping walk on all staves from measure 0.

---

## Display

The key signature is rendered on the stave when:

1. It is the first measure of the score (even if C major — VexFlow renders nothing for `'C'`, which is correct).
2. It differs from the effective key of the immediately preceding measure.
3. No courtesy key signature is shown before a change.

Pass a VexFlow key-name string to `stave.addKeySignature(name)`. The mapping:

| fifths | major name | fifths | major name |
|--------|-----------|--------|-----------|
| 0      | C         | −1     | F         |
| +1     | G         | −2     | Bb        |
| +2     | D         | −3     | Eb        |
| +3     | A         | −4     | Ab        |
| +4     | E         | −5     | Db        |
| +5     | B         | −6     | Gb        |
| +6     | F#        | −7     | Cb        |
| +7     | C#        |        |           |

VexFlow's key signature display is identical for a major key and its relative minor (same fifths count), so always pass the major-key name regardless of mode.

Add key sig display alongside time sig in `renderMeasure`: show `stave.addKeySignature(name)` when the display condition is met. Key sig is added **before** time sig so it renders in the conventional order (clef → key → time).

---

## UI: Circle of Fifths Picker

A circular SVG picker rendered as a floating popover. Two rings:

- **Outer ring** — 12 major key segments: C G D A E B F# Db Ab Eb Bb F  
- **Inner ring** — corresponding relative minor keys: Am Em Bm F#m C#m G#m D#m Bbm Fm Cm Gm Dm

Layout:
- 12 o'clock = C major. Clockwise = increasing sharps.
- Segments are equal 30° wedges.
- The currently active segment (matching `effectiveKey.fifths` and `effectiveKey.mode`) is highlighted.
- Clicking an outer segment selects major mode. Clicking an inner segment selects minor mode.
- Size: ~300 × 300 px.

**Entry points** (same pattern as time sig):

- **Select mode on canvas**: click the key signature area of a stave (left preamble, after the clef and before time sig, roughly `x` in `[layout.x, layout.x + 80]`) when that measure displays a key sig. Opens a per-measure picker → dispatches `SET_KEY`.
- **Toolbar button**: always-visible, label shows current effective key name (e.g. `G maj` or `Bm`). Opens a global picker → dispatches `SET_SCORE_KEY`.

Picker closes on selection, Escape, or click outside.

---

## Toolbar Integration

Key sig button label: `"${keyName} ${mode === 'major' ? 'maj' : 'min'}"`.  
Tracks the same effective-key resolution as the time sig button (cursor measure if in note/rest mode, else score default).

---

## Out of Scope (v1)

- Courtesy key signatures (showing the cancelled key before the new one).
- Restoring stripped accidentals when the key changes back.
- Transposing pitches when the key changes.
- Displaying key name text near the stave.
