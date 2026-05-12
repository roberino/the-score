# Time Signature

## Overview

Time signatures can be set per measure, allowing changes within a score. The initial time signature is 4/4 and applies globally until overridden on a specific measure.

---

## Presets

The picker offers these presets grouped by feel:

| Simple     | Compound | Asymmetric |
|-----------|----------|------------|
| 2/4        | 6/8      | 5/4        |
| 3/4        | 9/8      | 7/4        |
| 4/4        | 12/8     | 5/8        |
|            |          | 7/8        |

---

## Score Model

The `Measure.timeSignature` field (already present, currently unused) stores the override for that measure. The score-level `score.timeSignature` remains the global default. When resolving a measure's effective time signature, walk backwards from the measure to find the nearest explicit `timeSignature`; fall back to `score.timeSignature`.

```
effectiveTimeSig(measure M) =
  M.timeSignature
  ?? nearest preceding measure with .timeSignature set
  ?? score.timeSignature
```

---

## SET_TIME Command

The `SET_TIME` command (already in the command union) is applied at the measure level:

```
{ type: 'SET_TIME', partId, staffId, measureId, time: TimeSignature }
```

**Spill-over**: when the command changes a measure's capacity (e.g. 4/4 → 3/4 reduces capacity from 64 to 48 units), any note events that no longer fit must be moved forward:

1. Compute the new capacity for the affected measure.
2. Walk the measure's voice events in order, accumulating used units.
3. Any event that would cause used units to exceed capacity is removed from this measure and prepended to the next measure's voice (preserving order).
4. Repeat recursively for the next measure if it now overflows its own capacity.
5. **No note splitting**: events are moved whole. Ties across barlines are not generated.
6. If spill reaches the last measure and it overflows, auto-add a new empty measure (same logic as the auto-add-bar feature) and continue spilling into it.

**Capacity increase** (e.g. 4/4 → 6/4): no notes are moved. The measure simply has more available space.

---

## Display

The time signature is rendered on the stave when:

1. It is the first measure of the score.
2. It differs from the effective time signature of the immediately preceding measure.
3. It is the first measure of a new system line **and** the effective time signature differs from the score default (`score.timeSignature`).

The renderer already calls `stave.addTimeSignature('4/4')` only for `measureIndex === 0`. This must be updated to call `stave.addTimeSignature(...)` whenever the display condition above is met.

Time signature format passed to VexFlow: `"${numerator}/${denominator}"`.

---

## UI: Picking a Time Signature

**Entry point — Select mode:**  
In Select mode, clicking on the time signature numerals displayed on a stave opens a `TimeSignaturePicker` popover anchored near the click point.

The hit region is the stave's left preamble area: `x` in `[layout.x, layout.x + 60]`, `y` within the standard stave vertical range. Only fires if the stave actually displays a time sig at that measure (i.e. the display condition above is met).

**Entry point — Toolbar:**  
A time signature button in the toolbar (always visible, shows the score's global time sig as the label). Clicking it opens the picker. The picker targets:
- The cursor's current measure (if in note/rest mode).
- The score globally (`measureId = score.parts[0].staves[0].measures[0].id`) if in select mode with no measure explicitly selected.

**TimeSignaturePicker popover:**

```
┌──────────────────────┐
│ Simple               │
│  [2/4] [3/4] [4/4]  │
│ Compound             │
│  [6/8] [9/8] [12/8] │
│ Asymmetric           │
│  [5/4] [7/4] [5/8] [7/8] │
└──────────────────────┘
```

- Highlights the currently active preset.
- Closes on selection, Escape, or click outside.
- After applying, the cursor is repositioned to the start of the affected measure if the change caused notes to spill.

---

## Cursor Adjustment After Change

If the cursor was in a measure whose capacity shrank and spill-over moved some notes out, reposition the cursor to `usedUnits(voice.events)` in that measure so it sits after the last remaining note.

---

## Toolbar Integration

The toolbar's time-sig button label tracks `score.timeSignature` (the global default). It does **not** reflect per-measure overrides unless the cursor is in a measure with an override (stretch goal, out of scope for v1).

---

## Out of Scope (v1)

- Free entry (numerator/denominator text fields).
- Splitting notes at new barline boundaries (tied notes across bars).
- Pickup measures (anacrusis).
- Showing the time sig at every system line start if it matches the global default.
- Multi-part synchronised changes (changes apply only to the targeted staff).
