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
5. **Empty space** — no priority match → deselects everything and closes any open picker.

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
