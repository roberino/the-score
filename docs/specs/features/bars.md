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

With the stored-rests model, capacity is always reached (rests fill the measure). The bar is considered *full* when voice 0 contains **no rest events** — every beat is occupied by a note or chord:

```
!lastBar.voices[0].events.some(e => e.type === 'rest')
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

## Measures and Completeness

A measure's voice 0 is always mathematically complete: its events sum exactly to the measure's capacity. This means:

- A new empty measure starts with stored rest events that fill the full duration (e.g. a whole rest in 4/4, a dotted-half rest in 3/4). The rest(s) are real `NoteEvent` objects in `voice[0].events`, not a display-only placeholder.
- When a note is entered, the rest at the cursor position is replaced by the note and any remaining duration is filled with decomposed rests.
- When files are loaded, any measure with an empty `voice[0].events` array is normalised by filling it with the appropriate rests.

The renderer no longer needs special empty-measure handling; it renders the stored rest(s) as normal events via VexFlow.

---

## Manual Bar Insertion

Clicking the **`+ Bar`** toolbar button (or pressing **⌘B**) opens an **Insert Bars** dialog rather than immediately inserting a single bar. The dialog allows the user to choose where to insert and how many bars to add.

### Dialog fields

| Field | Control | Default | Constraints |
|-------|---------|---------|-------------|
| Number of bars | Numeric input | **1** | min 1, max 99 |
| Position | Radio group | **After current bar** | "After current bar" or "At end of score" |

- "After current bar" inserts after the currently selected measure (or cursor measure if no selection).
- "At end of score" appends after the final measure regardless of cursor position.
- The button is disabled (greyed out) when no cursor or selection exists; "After current bar" is therefore only available when the cursor/selection is set.

### Dialog interaction

1. Button click or ⌘B opens the dialog.
2. The number input is focused automatically so the user can type a count and press Enter.
3. **Confirm** (Enter or "Insert" button): inserts the requested bars and closes the dialog. The cursor moves to beat 0 of the first newly-inserted bar.
4. **Cancel** (Escape or "Cancel" button): closes without changes.
5. Clicking outside the panel closes without changes.

### Undo behaviour

All bars inserted in one dialog confirmation are treated as a **single undo step**. Undoing removes all inserted bars at once and restores the cursor to its pre-insertion position.

### `INSERT_MEASURE` count extension

`INSERT_MEASURE` gains an optional `count` field:

```typescript
{ type: 'INSERT_MEASURE'; afterMeasureIndex: number; count?: number }
```

- Default `count` is 1 (backward-compatible).
- The command inserts `count` consecutive measures starting at `afterMeasureIndex + 1`.
- Bar renumbering and final-barline maintenance apply across all inserted bars as a single atomic operation.

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

With the stored-rests model, `voice0.events` is never empty for a properly initialised measure. The stored whole/dotted-half rest is rendered as a normal `StaveNote` event. The legacy empty-measure whole-rest fallback (`events.length === 0 → render 'wr'`) is retained only as a safety net for edge cases (e.g. voice 2).

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
10. Clicking `+ Bar` opens the Insert Bars dialog; the count field is focused and defaults to 1.
11. Confirming with count=3, position="After current bar" inserts 3 consecutive bars after the cursor measure; the cursor moves to the first new bar.
12. Confirming with position="At end of score" inserts the requested bars after the last measure, regardless of cursor position.
13. Cancelling or pressing Escape closes the dialog with no score changes.
14. All bars from a single dialog confirmation are removed by a single undo.
15. `INSERT_MEASURE` with `count: N` inserts exactly N bars and renumbers all subsequent measures correctly.
