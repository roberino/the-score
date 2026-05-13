# Eraser Feature

## Overview

The eraser tool lets the user click on any note or rest in the score to delete it.

## Activation

- Toolbar button (eraser icon) → switches `inputMode` to `'eraser'`
- Keyboard shortcut: **E** — mirrors the pattern used by Note (N), Rest (R), Select (S)
- Escape → returns to select mode

## Cursor

Canvas cursor is `pointer` in eraser mode (already wired in `ScoreCanvas.tsx`).

## Click Behaviour

1. Compute the clicked measure layout via `findClickedLayout`.
2. Walk the events in the measure's first voice, accumulating beat positions (in 64th-note units).
3. For each event, map its beat position to an X coordinate using the same formula the cursor uses:
   - `noteAreaStart = layout.x + 20`
   - `noteAreaWidth  = layout.width - 40`
   - `noteX = noteAreaStart + (beatPos / capacity) * noteAreaWidth`
4. Find the event whose `noteX` is closest to the click X.
5. If the closest event is within **30 px**, dispatch `DELETE_NOTE` for it.
6. If no event is within the threshold, do nothing (no flash).

## Undo

`DELETE_NOTE` is a standard command dispatched via `dispatch`, so it is undoable via Cmd+Z in one step.

## Constraints

- Only deletes from voice 0 of the clicked measure.
- Rests are treated identically to notes — both can be erased.
- Erasing does **not** shift subsequent events or advance/move the cursor.
