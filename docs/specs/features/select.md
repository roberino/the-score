# Select Feature

## Overview

Select mode lets the user click on a note or rest to highlight it, enabling follow-up actions (delete, change duration, nudge octave) via keyboard shortcuts or toolbar controls.

## Activation

- Toolbar button (arrow/pointer icon) → switches `inputMode` to `'select'`
- Keyboard shortcut: **S** — mirrors Note (N), Rest (R), Eraser (E)
- **Escape** from any other mode → returns to select mode

## Click Behaviour

Clicks in select mode are prioritised in this order:

1. **Key signature** — click within the preamble x-range of a measure that displays a key sig → opens the Circle of Fifths picker.
2. **Time signature** — click within the preamble x-range of a measure that displays a time sig → opens the TimeSignaturePicker.
3. **Barline** — click within `±8 px` of any measure's right barline → opens the BarlinePicker.
4. **Note / rest** — click anywhere in the measure body and within `20 px` of the nearest note head (using actual VexFlow-rendered x positions) → selects that event; highlights it in blue.
5. **Empty space outside of staves** — no priority match → deselects everything and closes any open picker.
6. **Escape key** - deselects everything

## Note Head Hit Detection

Hit positions are derived from the actual VexFlow-rendered coordinates returned by `renderScore`, not from an approximate beat-position formula. This ensures accuracy regardless of preamble width (clef, key, time sig) or line position.

## Visual Feedback

- Selected note/rest is drawn in blue (`#3b9ddd`) by the renderer.
- Deselecting (clicking empty space or switching mode) clears the blue highlight.

## Follow-up Actions (while a note is selected)

| Action | Shortcut |
|---|---|
| Delete note | Delete / Backspace |
| Change duration | 1–7 (same as note input duration keys) |
| Nudge octave up | Cmd/Ctrl + ↑ |
| Nudge octave down | Cmd/Ctrl + ↓ |

## Bar selection

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

**Clearing**

- Escape or click empty space outside all staves → clears the entire selection.

Full bar selection will clear any existing note selection.

**Bulk Operations on Bars**

The standard context menu should be presented upon bar selection but with limitted operations as per below.

**Bulk deletion** 

* Replace selected bars with full bar rests
* This will not be a context menu item but rather will be applied when the delete key as pressed (same as note selection deletion)

**Transpose** 

* This should be applied to all notes within selection
* Transpose will use the context menu
* Should behave exactly as the [multi-select](./multi-select.md#22-transpose)

**Volta**

* Should apply across the selected bars
* Will use the context menu
* Should behave as per the [volta spec](./volta-brackets.md)