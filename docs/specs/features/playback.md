# Spec: Play Notes

## Overview

This spec defines real-time audio playback of the score. The user presses Play and hears all notes and rests rendered in sequence at a fixed tempo. Playback runs from the beginning of the score to the end, then stops automatically.

---

## Goals

- Play back notes at correct pitches and durations
- Play chords (multiple pitches simultaneously)
- Observe rests as silence of the correct duration
- Give the user a visual indication that playback is in progress
- Allow playback to be stopped at any time before it finishes naturally
- Require no external dependencies (use the browser's built-in Web Audio API)

---

## Out of Scope

- Playback from a mid-score position (always starts at the beginning)
- Repeat signs, D.C., D.S., coda, segno — played straight through in this spec
- Per-note dynamics (velocity, crescendo, decrescendo)
- Tempo changes mid-score (fixed BPM only)
- User-configurable BPM (fixed at 120 for now)
- Metronome / click track
- MIDI output
- Multi-part / multi-staff playback (voice 0 of part 0 only)
- Live playback cursor tracking the current note visually

---

## Activation

| Action | Trigger |
|--------|---------|
| Start playback | Click **▶ Play** in the toolbar |
| Stop playback | Click **⏹ Stop** in the toolbar |
| Toggle play / stop | Press **Space** (when in Select or Eraser mode) |

> Space in Note or Rest mode still enters a rest — playback Space is only active in Select and Eraser modes.

Playback stops automatically when the last note finishes. The toolbar button reverts to **▶ Play** and `isPlaying` returns to `false`.

---

## Playback Behaviour

### Sequence

Playback iterates voice 0 of every measure in part 0, in order:

```
for each measure in part[0].staff[0].measures:
  for each event in measure.voices[0].events:
    schedule event at current time offset
    advance offset by event duration in seconds
```

### Note events

Each `note` event is scheduled as a sine/triangle-wave oscillator at the correct frequency with an ADSR envelope (see Audio section below).

### Chord events

Each `chord` event fires one oscillator per pitch, all starting at the same time offset and lasting the same duration.

### Rest events

No oscillator is created. The time cursor advances by the rest's duration, producing silence.

### Empty measures

An empty measure (no events in voice 0) is treated as a full-duration rest. The whole-rest glyph displayed in the score represents this silence.

---

## Pitch → Frequency Mapping

Standard equal temperament, A4 = 440 Hz.

```
semitone_from_C = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }
accidental_offset = sharp:+1, flat:−1, doubleSharp:+2, doubleFlat:−2, natural:0
midi = (octave + 1) × 12 + semitone_from_C + accidental_offset
frequency = 440 × 2^((midi − 69) / 12)
```

Example: A4 → midi 69 → 440 Hz. Middle C (C4) → midi 60 → ~261.6 Hz.

---

## Duration → Seconds Mapping

At 120 BPM, one quarter note = 0.5 seconds.

| Duration | Beats | Seconds (120 BPM) |
|----------|-------|-------------------|
| Whole    | 4     | 2.0               |
| Half     | 2     | 1.0               |
| Quarter  | 1     | 0.5               |
| Eighth   | 0.5   | 0.25              |
| 16th     | 0.25  | 0.125             |
| 32nd     | 0.125 | 0.0625            |
| 64th     | 0.0625| 0.03125           |

Dotted notes multiply the base duration: `dots=1 → ×1.5`, `dots=2 → ×1.75`.

---

## Audio

### Oscillator

- Type: **triangle** wave — warmer than sawtooth, richer than pure sine
- One `OscillatorNode` per sounding pitch

### Envelope (per note)

```
attack  = 5 ms
release = min(80 ms, 25% of note duration)   ← capped for short notes
hold    = note duration − attack − release
```

Gain ramps:
1. 0 → 0.6 over the attack period
2. 0.6 held through the hold period
3. 0.6 → 0 over the release period

### Master gain

All oscillators route through a shared `GainNode` (master gain = 0.7) connected to `AudioContext.destination`. This allows a clean fade-out on Stop.

### Stop behaviour

When the user stops playback early, the master gain is ramped to 0 over ~20 ms (using `setTargetAtTime`) before the `AudioContext` is closed. This prevents audible clicks.

---

## Scheduling Strategy

All notes are scheduled up-front when Play is pressed, using `AudioContext.currentTime` as the time base. This avoids JavaScript timer drift and gives sample-accurate timing for the full score.

```
ctx = new AudioContext()
cursor = 0  // seconds from ctx.currentTime
for each event:
  schedule oscillator at (ctx.currentTime + cursor)
  cursor += eventDurationInSeconds
```

A `setTimeout` fires after `cursor × 1000 + 300 ms` to call `onStop()` and close the context.

---

## Store Changes

### New fields (already existed as stubs)

| Field | Type | Description |
|-------|------|-------------|
| `isPlaying` | `boolean` | True while playback is running |

### New actions

| Action | Description |
|--------|-------------|
| `startPlayback()` | Creates an `AudioContext`, schedules all notes, sets `isPlaying = true` |
| `stopPlayback()` | Calls the controller's `stop()`, clears the controller, sets `isPlaying = false` |

The `PlaybackController` (returned by `playScore()`) is held in a module-level variable outside Immer state — functions and Web Audio objects are not serialisable and do not belong in the undo stack.

---

## Module: `audioEngine.ts`

Located at `src/renderer/engine/audioEngine.ts`. Pure function, no React or store imports.

```typescript
export interface PlaybackController {
  stop: () => void
}

export function playScore(
  score: Score,
  bpm: number,
  onStop?: () => void
): PlaybackController
```

---

## Acceptance Criteria

1. Clicking **▶ Play** with a score containing notes causes audio to play.
2. Pitches match the written notes — C4 sounds lower than G4.
3. A quarter note lasts half as long as a half note.
4. A dotted quarter note lasts 1.5× a plain quarter note.
5. A rest produces silence for the correct duration; subsequent notes resume on time.
6. A chord (multiple pitches) causes all pitches to sound simultaneously.
7. Playback stops automatically after the last note finishes; the toolbar shows **▶ Play** again.
8. Clicking **⏹ Stop** mid-playback silences audio immediately (within ~20 ms, no click artefact).
9. Pressing **Space** in Select mode toggles play/stop.
10. Pressing **Space** in Note mode still enters a rest and does not affect playback.
11. Starting a new score or loading a file while playing stops playback.
