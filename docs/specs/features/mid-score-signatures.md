# Feature: Mid-Score Key and Time Signature Changes

## Summary

Allow the key signature and time signature to change at any measure within a score. The user selects a measure by clicking empty space inside it, then uses the existing toolbar key/time signature controls to set or reset an override for that measure. Changes cascade forward through subsequent measures until the next explicit override.

---

## Current State

The data model already fully supports per-measure overrides:

- `Measure.keySignature?: KeySignature` — optional override, `undefined` = inherit
- `Measure.timeSignature?: TimeSignature` — optional override, `undefined` = inherit
- `resolveTimeSig(measures, idx, scoreSig)` and `resolveKeySig(...)` walk back to find the effective sig at any measure
- `SET_KEY` and `SET_TIME` commands apply a sig to a specific measure
- `spillOverFrom` (in commands.ts) handles overflow when time sig shrinks

What is missing:

- Measure selection UX (clicking empty bar space)
- Toolbar routing — currently always dispatches `SET_SCORE_KEY` / `SET_SCORE_TIME`
- A "Remove override" path for measures with an explicit override set
- Guards to refuse a time sig change that would make the measure over-full
- Rendering of sig-change markers at barlines when a sig changes between measures

---

## Measure Selection

### Interaction

- Clicking empty space inside a measure (not on a note, rest, barline, directive, or heading) **selects** that measure. This works in any input mode.
- The selected measure is highlighted with a subtle blue tinted background (similar to how selected notes use a blue outline).
- Pressing **Escape** deselects the measure.
- Clicking a note or rest (entering a note/rest into the measure) deselects the measure automatically.
- Clicking empty canvas outside all measures deselects.

### Store state

`selectedMeasureId` already exists in `appStore`. The `setSelectedMeasure` action already exists. No new state needed.

---

## Toolbar Behaviour with Measure Selected

### Time signature button

- When a measure is selected, the button displays the **effective** time sig at that measure (resolved via `resolveTimeSig`), not the score default.
- Clicking it opens the `TimeSignaturePicker` as normal.
- On selection, the app checks whether the chosen time sig would make the measure **over-full** (used units > new capacity). If so: show an error toast "Measure is too full for this time signature — delete some notes first." and do not apply.
- Otherwise: dispatch `SET_TIME` targeting the selected measure.

### Key signature button

- When a measure is selected, the button displays the **effective** key sig at that measure (resolved via `resolveKeySig`).
- On selection, dispatch `SET_KEY` targeting the selected measure.

### Reset option in pickers

When the selected measure has an **explicit** override (i.e. `measure.keySignature` or `measure.timeSignature` is set), the pickers include a **"Reset to inherited"** button at the top. Clicking it dispatches `CLEAR_KEY` or `CLEAR_TIME` to remove the override, reverting the measure (and all subsequent uninherited measures) to the preceding or score-level sig.

### No measure selected

Toolbar behaviour is unchanged: clicking the sig buttons dispatches `SET_SCORE_KEY` / `SET_SCORE_TIME` as before.

---

## New Commands

```typescript
| { type: 'CLEAR_KEY';  partId: string; staffId: string; measureId: string }
| { type: 'CLEAR_TIME'; partId: string; staffId: string; measureId: string }
```

### `CLEAR_KEY` reducer

- Sets `measure.keySignature = undefined`
- Calls `stripAccidentalsFrom` starting at the next measure using the now-inherited key

### `CLEAR_TIME` reducer

- Sets `measure.timeSignature = undefined`
- Calls `spillOverFrom` starting at this measure using the score's time signature (the inherited value may differ)

---

## Rendering: Sig-Change Markers

When the effective time or key signature changes between adjacent measures, the new sig must be displayed at the start of the changed measure.

VexFlow stave API supports setting `timeSignature` and `keySignature` per stave. The renderer already sets these per measure using the resolved values. What needs to change:

- **Key sig**: if `resolveKeySig(measures, i, scoreSig)` ≠ `resolveKeySig(measures, i-1, scoreSig)`, render the key sig glyph at the start of measure `i`.
- **Time sig**: if `resolveTimeSig(measures, i, scoreSig)` ≠ `resolveTimeSig(measures, i-1, scoreSig)`, render the time sig glyph at the start of measure `i`.
- On the first measure, always render both glyphs (current behaviour).

The "courtesy" sig at the end of the preceding measure (common in print) is **out of scope** for this feature.

---

## Implementation Plan

1. **`src/shared/commands.ts`**
   - Add `CLEAR_KEY` and `CLEAR_TIME` to the `Command` union.
   - Implement their reducers: clear the field, then call the appropriate helper.

2. **`src/renderer/store/appStore.ts`**
   - Update `handleTimeSigSelect` and `handleKeySigSelect` logic (or add a new action) to check `selectedMeasureId`:
     - If set: dispatch `SET_TIME` / `SET_KEY` with the measure's `partId`/`staffId`/`measureId`, with the over-full guard for time sig.
     - If not set: dispatch `SET_SCORE_TIME` / `SET_SCORE_KEY` as before.
   - Expose a `clearMeasureSig` action (or similar) that dispatches `CLEAR_KEY` / `CLEAR_TIME`.

3. **`src/renderer/components/Toolbar.tsx`**
   - Update `displayTimeSig` / `displayKeySig` to resolve from `selectedMeasureId` when set (currently only resolves from `cursorMeasureId`).
   - Update `handleTimeSigSelect` / `handleKeySigSelect` to route through the store action.
   - Pass a `hasOverride` flag into the pickers so they can show "Reset to inherited".

4. **`src/renderer/components/TimeSignaturePicker.tsx`**
   - Accept an optional `showReset: boolean` prop.
   - When true, render a "Reset to inherited" button at the top that calls `onSelect` with a sentinel or a separate `onReset` callback.

5. **`src/renderer/components/CircleOfFifths.tsx`**
   - Same pattern: optional `showReset` prop / `onReset` callback.

6. **`src/renderer/components/ScoreCanvas.tsx`**
   - Update click handler: clicking empty space in a measure (no note/rest/barline hit) calls `setSelectedMeasure(measureId)` and clears the note selection.
   - On note click / note entry: call `setSelectedMeasure(null)`.
   - Render the selected measure highlight before notes.

7. **`src/renderer/engine/notationRenderer.ts`**
   - Compare adjacent measure sigs (resolved) and conditionally render the sig glyph. Currently every measure renders the glyph; change to only render when the sig differs from the previous measure (except measure 0).

---

## Out of Scope

- Courtesy signatures at the end of the preceding measure.
- Per-part or per-staff signature overrides (all staves change together).
- MIDI channel time-sig meta events in MIDI export.
