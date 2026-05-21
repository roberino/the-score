# Spec: Multiple Voices

## Overview

Two independent voices per staff allow polyphonic writing — e.g. soprano and alto sharing the treble clef. Voice 1 notes have stems up; Voice 2 notes have stems down. Both voices play back simultaneously. Voice data round-trips through MusicXML.

---

## Goals

- Allow up to 2 voices per staff
- Voice 1: stems up (default, existing behaviour)
- Voice 2: stems down, tinted green in the editor
- User can switch active voice via V1 / V2 toolbar buttons
- Both voices play back concurrently
- MusicXML `<voice>` elements import and export correctly

---

## Out of Scope

- More than 2 voices per staff (Finale/Sibelius support 4; not needed yet)
- Cross-voice slurs or hairpins
- Independent dynamics per voice

---

## Data Model

No schema changes required. `Measure.voices` is already `readonly Voice[]`. Measures start with one Voice. A second Voice is created on demand when the user first adds a note in Voice 2.

The second Voice is created via a new `ADD_VOICE` command dispatched before `ADD_NOTE` if voice index 1 does not yet exist in the target measure.

---

## Store Changes

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `activeVoice` | `0 \| 1` | `0` | Which voice note input targets |
| `setActiveVoice` | `(v: 0 \| 1) => void` | — | Action to switch active voice |

The cursor beat-position tracking (`usedUnits`) checks the active voice's events, not always `voices[0]`.

---

## Commands

### `ADD_VOICE`

```
{ type: 'ADD_VOICE'; partId: string; staffId: string; measureId: string }
```

Appends a new empty `Voice` to `measure.voices` if the measure has fewer than 2 voices. No-op if voice already exists.

---

## Rendering

### Stem direction

Voice index determines stem direction — no explicit field on `Voice`.

| Voice index | VexFlow stem direction |
|-------------|----------------------|
| `0` | Auto (VexFlow default) |
| `1` | `STEM_DOWN` (-1) |

### Multi-voice formatting

When a measure has 2 voices both with events, use `Formatter.joinVoices([vexVoice0, vexVoice1]).format([vexVoice0, vexVoice1], noteAreaWidth)` so notes are spaced correctly.

When only one voice has events, fall back to the existing single-voice path (no stem forcing for voice 0).

### Voice colours

Applied unconditionally to all unselected notes, as a subtle editor affordance:

| State | Voice 1 | Voice 2 |
|-------|---------|---------|
| Unselected | `#222` (near-black) | `#2d8f4e` (green) |
| Selected | `#3b9ddd` (blue) | `#3b9ddd` (blue — selection overrides) |

### Rests in multi-voice measures

When a voice has no events (empty), do not show a whole-rest placeholder for that voice — the single present voice renders normally.

---

## Toolbar

A **V1 / V2** button pair is added to the existing toolbar, visible whenever the duration row is shown (`inputMode` is `note`, `rest`, or `select`). The active voice button is highlighted blue.

```
[ Select | Note | Rest | Eraser ]   ← existing mode row
[ V1 | V2 ]                        ← new voice row (shown with duration row)
[ 𝅝 𝅗𝅥 𝅘𝅥 𝅘𝅥𝅮 𝅘𝅥𝅯 𝅘𝅥𝅰 𝅘𝅥𝅱 . ]                    ← existing duration row
```

---

## Playback

`buildFlatSchedule` (in `musicUtils.ts`) is updated to iterate over **all voices** in a measure, not just `voices[0]`. Events from all voices are merged into the flat event schedule with the same per-beat time offsets.

---

## MusicXML

### Export

Each note element includes `<voice>1</voice>` for `voices[0]` events and `<voice>2</voice>` for `voices[1]` events.

### Import

MusicXML `<voice>` values are mapped to voice array indices (`voice 1` → index 0, `voice 2` → index 1). Notes with the same voice number within a measure are placed in the corresponding `Voice`.

---

## Acceptance Criteria

1. Clicking V2 in the toolbar switches the active voice; entering a note creates it in voice 2 with a stem-down, green-tinted notehead
2. Voice 1 and voice 2 notes share the same stave and are correctly horizontally aligned by VexFlow's `joinVoices` formatter
3. Both voices play back simultaneously with correct pitches and durations
4. Switching back to V1 re-targets the original voice; stem directions are preserved
5. A score with 2 voices exports MusicXML with `<voice>1</voice>` / `<voice>2</voice>` on the correct notes
6. Re-importing that MusicXML file restores both voices with correct notes and stem directions
7. A measure with only voice 1 notes renders identically to before (no regression)
