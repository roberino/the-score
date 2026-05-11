# Spec: Bars

## Overview

This spec covers bar (measure) management: the starting bar count, auto-adding bars as notes fill the score, final barline maintenance, and setting barline types on individual bars.

---

## Out of Scope

- Bar deletion
- Time signature changes per bar
- Pickup (anacrusis) bars
- Multi-bar rests
- Copy / paste of bars

---

## Starting State

A new score opens with **8 empty bars** in 4/4 time. Each bar displays a whole rest to indicate it is empty (standard notation convention). Bar numbers are shown above the first bar of each line.

The `createScore` factory is updated to produce 8 measures instead of 1.

---

## Auto-Add

When the **last bar in the score becomes full**, a new empty bar is appended automatically.

### Trigger

The auto-add check runs after every successful note or rest entry (dispatched via `ADD_NOTE`). It is not triggered by undo or direct score loads.

### Behaviour

- One bar is added at a time — auto-add fires once per note entry, not in bulk.
- The new bar inherits the score's current time signature.
- The cursor advances into the new bar normally (per the note-input spec: cursor moves to beat 0 of the next bar when the current bar fills).
- The new bar's barline becomes `'single'`; the final barline moves to the new last bar (see Final Barline below).

### What "last bar full" means

The last bar is full when:
```
usedUnits(lastBar.voices[0].events) >= measureCapacityUnits(timeSig)
```

Only voice 0 is checked (consistent with the note-input spec).

---

## Final Barline

The last bar in the score always renders with a `'final'` barline (the standard double thin-thick closing line). All other bars use `'single'` unless explicitly set otherwise by the user.

### Maintenance rules

| Event | Action |
|-------|--------|
| New score created | Last of the 8 bars gets `barline: 'final'`; others get `barline: 'single'` |
| Auto-add fires | Old last bar loses its `'final'`; new last bar gets `'final'` |
| User changes a barline type | Allowed on any bar except the last — the final barline on the last bar is locked and cannot be overridden |

---

## Barline Types

The user can set the barline type on any bar except the last bar (which is always `'final'`).

### Supported types

| Type | Appearance | Use |
|------|-----------|-----|
| `single` | Thin vertical line | Default between bars |
| `double` | Two thin lines | Section boundary, end of intro/verse |
| `repeat-start` | Thick + thin + dots | Start of a repeated section |
| `repeat-end` | Dots + thin + thick | End of a repeated section |
| `final` | Thin + thick | End of piece — locked to last bar only |

### Interaction model

1. User must be in **Select mode**.
2. User clicks on a barline (the right edge of a bar, within a click tolerance of ±8px).
3. The clicked bar is highlighted and a **barline picker** appears — a small inline popover showing the five barline type options as icons.
4. Clicking an option dispatches `SET_BARLINE` for that bar and closes the popover.
5. Pressing `Escape` closes the popover without changes.
6. Clicking the last bar's right edge shows the picker with all options greyed out and a tooltip: "Final barline is locked."

### Selection state

A selected barline is stored in `appStore` as `selectedBarlineId: string | null` (the measure ID whose right barline is selected). Deselects when the user clicks elsewhere or changes mode.

---

## Bar Numbers

Bar numbers are rendered above the first bar of each line (system). They use the same canvas pass as the score rendering — no separate overlay needed.

- Bar 1 does not display a number (standard engraving convention).
- Numbers render in a small font above the top staff line, left-aligned with the barline.

---

## Whole Rests in Empty Bars

An empty bar (voice 0 has no events) renders a whole rest centred in the bar. This is standard notation for "nothing written here yet." The rest is display-only — it is not stored in the voice's events array and does not count toward beat capacity.

---

## Commands

### `ADD_MEASURE` (existing, unimplemented)

```typescript
{ type: 'ADD_MEASURE'; partId: string; staffId: string; afterMeasureId: string }
```

Inserts a new empty measure immediately after `afterMeasureId`. The new measure gets one empty voice. For auto-add, `afterMeasureId` is the current last measure's ID.

Currently defined in the command union but not handled in `applyCommand` — this spec requires the case to be implemented.

### `SET_BARLINE` (new)

```typescript
{ type: 'SET_BARLINE'; partId: string; staffId: string; measureId: string; barline: BarlineType }
```

Sets the `barline` field on the specified measure. Rejected silently if `measureId` is the last measure in the staff (final barline is locked).

---

## Store Changes

| Field | Type | Description |
|-------|------|-------------|
| `selectedBarlineId` | `string \| null` | Measure ID whose right barline is selected in Select mode |

### Auto-add action

A new store action `checkAndAutoAddBar()` is called from `dispatch` after any `ADD_NOTE` command:

```
if lastMeasure.voices[0] is full:
  dispatch ADD_MEASURE (afterMeasureId = lastMeasure.id)
  update final barline: SET_BARLINE on old last measure → 'single'
                        SET_BARLINE on new last measure → 'final'
```

This action lives in the store rather than a component so it fires regardless of which input path (keyboard or mouse) triggered the note entry.

---

## Renderer Changes

### Whole rests

`renderMeasure` currently returns early if `voice0.events.length === 0`. Instead, when the voice is empty, render a centred whole rest glyph. VexFlow's `StaveNote` with `duration: 'wr'` handles this automatically.

### Barline types

VexFlow's `Stave` supports barline types via `stave.setEndBarType(VexFlow.Barline.type.DOUBLE)` etc. The renderer maps the measure's `barline` field to the appropriate VexFlow constant before calling `stave.draw()`.

### Bar numbers

After drawing each stave, render the bar number as canvas text above the first bar of each system line (measureIndex % measuresPerLine === 0 and measureIndex > 0).

---

## Acceptance Criteria

1. A new score opens with exactly 8 bars, all displaying whole rests.
2. The 8th bar has a final barline; bars 1–7 have single barlines.
3. Filling the last bar with notes triggers automatic addition of a 9th bar; the final barline moves to the 9th bar.
4. Auto-add fires at most once per note entry (not on undo/redo or file load).
5. In Select mode, clicking a barline opens the barline picker.
6. Setting a barline to `'double'` on bar 3 renders a double barline at the end of bar 3.
7. Clicking the last bar's barline shows the picker with options disabled.
8. Bar numbers appear above the first bar of each new line (bar 5, 9, 13, … for 4 bars per line) but not above bar 1.
9. Undo after auto-add removes the added bar and restores the final barline to the previous last bar.
