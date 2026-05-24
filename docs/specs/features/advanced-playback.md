# Advanced Playback

## Overview

Extends the play button with a split-button dropdown so the user can choose where playback begins: from the start of the score, or from a selected note.

## Play button UI

The play button becomes a **split button**:

- **Left side** — the primary action button. Executes the most-recently-chosen playback mode (defaults to "Play from beginning"). Shows ▶ Play / ⏹ Stop as today.
- **Right side** — a small chevron (▾) that opens a dropdown menu. Only visible when not currently playing.

### Dropdown options

| Label | Behaviour |
|---|---|
| ▶ Play from beginning | Starts playback at measure 1, beat 1. This is the default. |
| ▶ Play from here | Starts playback from the currently selected note. Disabled (greyed out) if no note is selected. |

Selecting an option from the dropdown immediately executes that action (no separate click needed) and sets it as the new primary action for subsequent presses of the left button.

## Play from beginning

Identical to current play behaviour:
- Resets `playbackResumePositionSec` to `0` before starting.
- Playback cursor jumps to measure 1 immediately.

## Play from here

Requires exactly one note to be selected (single note or chord). If nothing is selected the option is disabled in the dropdown.

### Sequence of events

1. User selects "Play from here" from the dropdown.
2. The playback cursor **immediately jumps** to the selected note's position (before audio starts).
3. `playbackResumePositionSec` is set to the time offset (seconds) of the selected note within the score's flat schedule.
4. Playback starts from that offset via the existing `resumeFrom` parameter on both the audio engine and MIDI output engine.

### Computing the start offset

Use `buildMeasureTimeline` (already in `musicUtils`) with the first part's staff to build a measure → start-time map, then add the beat offset of the selected note within its measure:

```
noteStartSec = measureStartSec + (beatPosition / 16) * (60 / bpmAtMeasure)
```

## Behaviour after stopping

Unchanged from current behaviour: the playback position stays at the stopped position (`playbackResumePositionSec` is set to the transport position at stop time). The primary button action does not reset.

## Playback cursor

- When "Play from beginning" is used: cursor behaves exactly as today.
- When "Play from here" is used: cursor jumps to the selected note's x-position at the moment the action is triggered (before audio starts), then tracks normally once playback is running.

## Store changes

| Field / action | Change |
|---|---|
| `playbackMode: 'beginning' \| 'from-note'` | New field, default `'beginning'`. Persists the last-chosen dropdown option. |
| `startPlayback()` | Reads `playbackMode`; if `'from-note'`, resolves the selected note's time offset and sets `playbackResumePositionSec` before starting. |

## Edge cases

- **No note selected when "Play from here" is the primary action**: fall back to "Play from beginning" silently and reset `playbackMode` to `'beginning'`.
- **Selected note is in a repeated section**: use the first occurrence's time, consistent with how `buildFlatSchedule` orders events.
- **Single-part vs multi-part scores**: time offset is always computed from part 0's schedule (the tempo staff), same as existing playback logic.
