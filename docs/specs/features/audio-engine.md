# Spec: Audio Engine

## Overview

The audio engine supports two playback modes: **Built-in** (high-quality piano sampler using real recordings) and **MIDI Output** (routes all playback to an external MIDI device or DAW). Users switch mode via an **Audio** toolbar dropdown. The goal is out-of-the-box quality for casual users while giving DAW users a zero-compromise path.

---

## Modes

### Built-in Audio (default)

Uses a `Tone.Sampler` loaded with Salamander Grand Piano samples (hosted by Tone.js CDN). All parts play back as piano regardless of `midiProgram` — this keeps asset weight minimal while delivering a dramatic quality improvement over the previous triangle-wave synth.

- Samples load in the background on first playback
- Until samples are ready, playback falls back to the triangle-wave synth
- Once loaded, samples are cached for the session (no reload between plays)
- Dynamics, tempo directives, and pizz. envelope still apply where applicable

### MIDI Output

Routes playback to a user-selected MIDI output port (hardware device, virtual port, or DAW). Requires the user to connect a MIDI output in the Audio settings panel.

- Each part maps to a MIDI channel (part 0 → ch 0, part 1 → ch 1, up to ch 15)
- Note On/Off events are pre-scheduled using `MIDIOutput.send(data, timestamp)` with Tone.Transport timing
- Stop sends All Notes Off (CC 123) on all channels
- `midiProgram` per part is honoured via MIDI Program Change messages sent at playback start

---

## Audio Settings Panel

Opened by an **Audio** button in the toolbar top row. A small floating panel containing:

| Section | Controls |
|---------|----------|
| Mode | "Built-in Audio" / "MIDI Output" toggle |
| MIDI Output (when MIDI mode) | List of available output devices; click to select |
| Built-in (when built-in mode) | Load status indicator ("Loaded" / "Loading…") |

Closes on Escape or outside click.

---

## Sound on Input (amendment)

When `soundOnInput` is enabled and `audioMode === 'midi-out'`, note preview routes through the active MIDI output (Note On + Note Off after 400 ms) rather than the built-in synth. This gives DAW users consistent timbre between preview and playback.

---

## Store Changes

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `audioMode` | `'builtin' \| 'midi-out'` | `'builtin'` | Active playback mode |
| `midiOutputDeviceId` | `string \| null` | `null` | Selected MIDI output port ID |

Actions: `setAudioMode(mode)`, `setMidiOutputDevice(id)`

---

## Implementation

- **`samplerEngine.ts`**: singleton `Tone.Sampler` with Salamander samples; `loadSampler()`, `isSamplerReady()`, `playScoreWithSampler()`
- **`midiOutputEngine.ts`**: `MidiOutputEngine` class (singleton); manages MIDI access, output selection, playback scheduling, and per-note preview
- **`AudioSettingsPanel.tsx`**: floating dropdown with mode toggle and device list
- `App.tsx`: calls `loadSampler()` on mount to begin prefetching samples

---

## Acceptance Criteria

1. Built-in playback uses piano samples after first load; sounds as triangle synth on first play if samples not yet ready
2. Switching to MIDI Output and selecting a device routes subsequent playbacks to that device
3. Stop during MIDI playback immediately silences the MIDI device (All Notes Off)
4. Note preview (sound on input) uses MIDI output when in MIDI mode
5. Audio settings panel shows connected MIDI devices; updates if a device is plugged in after panel opens
6. Switching back to Built-in deselects MIDI output and subsequent playback uses built-in audio
