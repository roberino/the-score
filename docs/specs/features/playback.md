# Playback Feature

## Overview

Plays the score from beginning to end using the Web Audio API — no external dependencies. Notes and chords are scheduled up-front for sample-accurate timing.

## Controls

| Action | How |
|---|---|
| Play / Stop | Toolbar **▶ Play** / **⏹ Stop** button |
| Play / Stop | **Space** (in Select or Eraser mode) |

Space in Note or Rest mode still enters a rest (existing behaviour).

## Implementation

- `src/renderer/engine/audioEngine.ts` — pure function `playScore(score, bpm, onStop?)`
  - Iterates voice 0 of all measures in part 0 in order
  - Notes and chords: `OscillatorNode` (triangle wave) with an ADSR gain envelope
  - Rests: silence — cursor advances but no oscillator is created
  - Returns `{ stop() }` controller
- `appStore.ts` — `startPlayback()` / `stopPlayback()` actions; `_playback` controller held in a module-level variable (outside Immer state)
- `isPlaying` in the store reflects playback state; the toolbar button and status bar can read it

## Audio

- **Waveform**: triangle (warmer than sawtooth, more harmonic than sine)
- **Envelope**: 5 ms attack → hold → 80 ms release (capped at 25% of note duration for short notes)
- **Tempo**: 120 BPM (fixed; configurable in a future iteration)
- **Master gain**: 0.7

## Scope (this iteration)

- Voice 0 of part 0 only
- No repeats, D.C., D.S., or coda handling
- No tempo changes mid-score
- No dynamics (velocity is fixed)
