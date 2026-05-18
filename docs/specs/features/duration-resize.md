# Feature: Duration Resize on Selected Note

## Summary

When exactly one note or rest is selected, pressing a duration key (1–7) or toggling the dot button resizes that event in place. The surrounding notes are adjusted minimally to preserve the positions of all other events:

- **Shrink** (new duration < old): fill the freed space with a rest (or grow an adjacent rest).
- **Grow** (new duration > old): consume subsequent events to make room, with a warning if any pitched notes would be lost. Block if the measure has insufficient capacity.

This applies only to single-note selection. When multiple notes are selected, duration keys keep the existing batch-apply behaviour.

---

## Trigger Conditions

- Exactly one `selectedNoteId` is set (i.e. `selectedNoteIds.length === 1`).
- The user presses a duration key (1 = 64th … 7 = whole) **or** toggles the dot button.
- The new duration + dots differs from the currently selected event's duration + dots.

---

## Shrink Behaviour

`delta = oldUnits − newUnits` (positive)

1. Find the event immediately following the selected event in the same voice.
2. **If it is a rest**: remove it, then fill the combined freed space (`delta + old rest units`) using `fillWithRests` (see below). This effectively grows the rest by `delta`.
3. **If it is a note/chord, or there is no following event**: insert new rest(s) for `delta` units using `fillWithRests` directly after the resized event.
4. Apply the resize and rest insertion atomically in a single `RESIZE_NOTE` command (one undo snapshot).

No warning is shown — shrinking is always non-destructive to pitched content.

---

## Grow Behaviour

`need = newUnits − oldUnits` (positive)

### Pre-check (block condition)

Sum the durations of all events that follow the selected event in the same voice. If this total < `need`, **block** the operation: show a brief inline error (e.g. a toast: *"Not enough space in this measure"*) and do nothing.

### Warning condition

Scan the subsequent events that would be consumed. If **any of them is a note or chord** (i.e. pitched content would be lost), show a confirmation dialog:

> **Resize note?**  
> This will remove or shorten [N] note(s) after the selected note. This cannot be undone incrementally.  
> [Cancel] [Resize]

If all consumed events are rests, proceed silently (no dialog needed).

### Consume algorithm

1. Walk subsequent events in order, accumulating consumed duration until `accumulated >= need`.
2. Remove each fully-consumed event.
3. If the last consumed event has more duration than required (i.e. `accumulated > need`), keep the remainder: insert rest(s) for `accumulated − need` units via `fillWithRests`.
4. Apply atomically in a single `RESIZE_NOTE` command.

---

## `fillWithRests` Helper

Converts a raw number of 64th-note units into one or more `{ duration, dots }` rest entries using a greedy algorithm:

```
representable = [64, 48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1]  // whole → 64th, with dotted values
while remaining > 0:
  pick largest value ≤ remaining
  emit rest of that duration+dots
  remaining -= value
```

This handles edge cases like 3-unit gaps (dotted 32nd rest) cleanly.

---

## New Command: `RESIZE_NOTE`

```typescript
{
  type: 'RESIZE_NOTE'
  partId:    string
  staffId:   string
  measureId: string
  voiceId:   string
  noteId:    string            // the event being resized
  newDuration: Duration
  newDots:     0 | 1 | 2
}
```

The reducer:
1. Locates the event by `noteId` in the voice's events array.
2. Computes `oldUnits` / `newUnits`.
3. Applies shrink or grow logic as above, mutating the events array in place.
4. Returns the new state (single undo entry via Immer).

---

## UI

- Duration buttons and keyboard shortcuts (1–7, D for dot) remain the primary trigger — no new controls needed.
- The dot toggle follows the same logic: if dotting a selected note makes it longer, run the grow path; undotting runs the shrink path.
- The confirmation dialog reuses the existing modal pattern (similar to `TransposeDialog`).
- The "not enough space" block shows a transient toast or status-bar message (no modal needed — it is not a destructive action).

---

## Out of Scope

- Stealing duration across measure boundaries.
- Applying resize to multi-selected notes.
- Splitting a note across barlines.
