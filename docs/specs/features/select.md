# Select Feature

## Overview

Select mode lets the user click on a note or rest to highlight it, enabling follow-up actions (delete, change duration, nudge octave) via keyboard shortcuts or a context menu.

## Activation

- Toolbar button (arrow/pointer icon) → switches `inputMode` to `'select'`
- Keyboard shortcut: **S** — mirrors Note (N), Rest (R), Eraser (E)
- **Escape** from any other mode → returns to select mode

## Click Behaviour

Clicks in select mode are prioritised in this order:

1. **Key signature** — click within the preamble x-range of a measure that displays a key sig → opens the Circle of Fifths picker.
2. **Time signature** — click within the preamble x-range of a measure that displays a time sig → opens the TimeSignaturePicker.
3. **Barline** — click within `±8 px` of any measure's right barline → opens the BarlinePicker.
4. **Note / rest** — click anywhere in the measure body and within `20 px` of the nearest note head → selects that event and opens the selection context menu.
5. **Empty space in a measure** — no note hit → starts or extends a bar selection.
6. **Empty space outside of staves** — deselects everything and closes any open picker/menu.
7. **Escape key** — deselects everything and closes any open picker/menu.

Pickers (key sig, time sig, barline) do not open while a selection context menu is visible — the context menu must be closed first. When a picker is opened, any active selection menu closes.

## Note Head Hit Detection

Hit positions are derived from the actual VexFlow-rendered coordinates returned by `renderScore`, not from an approximate beat-position formula. This ensures accuracy regardless of preamble width (clef, key, time sig) or line position.

## Visual Feedback

All selection types use the same blue overlay rectangle drawn on the overlay canvas, ensuring visual consistency.

### Single note / multi-note selection
- A single spanning blue rectangle covers from the leftmost to rightmost selected note's position. Width is `(rightmostNoteX + 8) − (leftmostNoteX − 8)`.
- If the selection spans multiple lines (canvas slices), one rectangle is drawn per line.
- Fill: `rgba(59, 157, 221, 0.20)`, stroke: `rgba(59, 157, 221, 0.50)`.
- VexFlow also colours selected note heads blue.

### Bar selection
- A full-width rectangle spanning the complete measure(s) width from left edge to right edge.
- Covers all selected parts; spans multiple lines if the selection crosses a line break.
- Fill: `rgba(33, 150, 243, 0.10)`, stroke: `rgba(33, 150, 243, 0.45)`.

## Mutual Exclusivity

Note selection and bar selection are mutually exclusive:
- Selecting a note/rest always clears any active bar selection.
- Making a bar selection always clears any active note selection.
- The store enforces this — `setSelectedNote`, `setSelectedNotes`, `addToSelection`, and `toggleSelectedNote` all clear `barSelection`; `setBarSelection(non-null)` clears `selectedNoteIds`.

## Selection Context Menu

A single unified context menu appears for all selection types (single note, multi-note, bar selection). It is positioned below the selected note(s) or at the click location for bar selection.

### Menu structure

```
┌─────────────────────────────────────────────┐
│  [drag handle] <summary>          [✕ close] │
│  [Tie] [Slur] [cresc] [dim] [3] [5] [6]    │  ← operation row
├─────────────────────────────────────────────┤
│  Articulations │ Volta │ Transpose           │  ← tabs
├─────────────────────────────────────────────┤
│  <tab content>                               │
└─────────────────────────────────────────────┘
```

### Operation availability by selection type

| Operation | Single note | Multi-note | Bar selection |
|---|---|---|---|
| Tie | ✓ enabled | ✗ disabled | ✗ disabled |
| Slur | ✓ enabled | ✓ enabled | ✗ disabled |
| Hairpin (cresc / dim) | ✗ disabled | ✓ enabled (≥ 2 notes) | ✗ disabled |
| Tuplet (3 / 5 / 6) | ✗ disabled | ✓ enabled (exact counts) | ✗ disabled |
| **Articulations tab** | ✓ full | ✓ full | ✗ tab disabled |
| Dynamics (within Articulations) | ✓ enabled | ✗ disabled | ✗ disabled |
| **Volta tab** | ✓ enabled | ✓ enabled | ✓ enabled |
| **Transpose tab** | ✓ enabled | ✓ enabled | ✓ enabled |

Disabled items are rendered greyed out (`color: #555`, `cursor: not-allowed`) and do not respond to clicks.

### Close behaviour

- The menu has a **✕** button in the top-right corner.
- Clicking ✕ clears the entire selection (note or bar) and closes the menu.
- This is equivalent to pressing Escape.

### Draggability

- The menu header row acts as a **drag handle** (cursor: `grab` on hover, `grabbing` while dragging).
- The user can drag the menu to any position on screen. This is particularly useful when the menu would otherwise obscure the stave during bar selection narrowing (Phase 2).
- Drag offset resets to zero whenever a new selection is made (menu repositions to its default location).

### No-overlap rule

Only one popup can be visible at a time. The selection context menu, barline picker, key sig picker, time sig picker, clef picker, directive picker, pedal mark picker, and MIDI event picker are all mutually exclusive:
- Opening any picker closes the selection context menu.
- Opening the selection context menu closes any open picker.

---

## Bar Selection

Bar selection allows the user to select one or more bars in order to apply bulk operations.

**Bar Selection Behaviour**

Bar selection works in two phases: first select a bar range (across all parts), then optionally filter down to specific parts.

**Phase 1 — Bar range selection**

- Click empty space within a measure (not on a note head, rest, barline, key sig, or time sig) → selects that bar across all parts. Any existing note or bar selection is cleared.
- Shift+click empty space in a later measure → extends the selection forward to cover all bars from the first selected to the clicked bar, inclusive, still spanning all parts.

**Phase 2 — Part filtering**

Once a bar range is active, the user can narrow it to specific parts:

- Click empty space within a stave inside the selected bar range → narrows the selection to that part only. The bar range is preserved.
- Shift+click empty space within another stave inside the bar range → adds that part to the narrowed selection.

*Example: to select bars 3–7 for piano left and right hand — click bar 3 (all parts), shift+click bar 7 (extends range), click the piano right-hand stave (narrows to that part), shift+click the piano left-hand stave (adds left hand).*

*If the context menu obscures the stave during Phase 2, drag it out of the way using the drag handle.*

**Clearing**

- Click ✕ on the context menu, press Escape, or click empty space outside all staves → clears the entire selection and closes the menu.

Full bar selection will clear any existing note selection.

**Bulk Operations on Bars**

The unified selection context menu is shown, with operation availability as described in the table above.

**Bulk deletion**

- Replace selected bars with full bar rests.
- Applied when the Delete key is pressed (not a context menu item).

**Transpose**

- Applied to all notes within the selection.
- Uses the Transpose tab of the context menu.
- Behaves as per [multi-select transpose](./multi-select.md#22-transpose).

**Volta**

- Applies across the selected bars.
- Uses the Volta tab of the context menu.
- Behaves as per the [volta spec](./volta-brackets.md).
