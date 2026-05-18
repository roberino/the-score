# Feature: External MIDI Device Input

## Summary

Allow notes to be entered into the score by playing keys on an external MIDI keyboard or controller. Step-time only: each note (or chord) is entered at the current cursor position using the duration selected in the toolbar. Notes pressed simultaneously are grouped into a chord.

A device picker in the toolbar lets the user select which MIDI input port to use. Pressing a MIDI key while in select or eraser mode automatically switches the app to note mode.

---

## Current State

The `midiService` singleton already connects to all MIDI input ports and routes Note-On messages to `enterNoteAtPitch` in `ScoreCanvas`. The virtual keyboard uses the same path. What is missing:

- Per-device selection (currently all ports are active)
- Chord detection (simultaneous notes create multiple single notes)
- A visible UI indicator showing which MIDI input is connected
- The device selector persisting across sessions

---

## Device Selection

### UI

A new **MIDI In** button in the toolbar (placed next to the existing MIDI Out control) opens a picker listing all connected MIDI input ports by name, plus a "None" option to disable MIDI input.

The selected device name is shown on the button when active (e.g. "MIDI In: Arturia KeyStep").

### Behaviour

- On selection, `midiService` is updated to accept messages **only from the chosen port**; all other ports are silenced.
- Selecting "None" disables MIDI input entirely.
- If the selected device is disconnected (Web MIDI `onstatechange`), the selector resets to "None" and a brief status message is shown.
- The chosen device ID is persisted to `localStorage` under `midiInputDeviceId` and restored on next launch.

### Store state

```typescript
midiInputDeviceId: string | null     // null = disabled
setMidiInputDevice: (id: string | null) => void
```

`midiService` grows a `selectInput(portId: string | null)` method that filters which port's messages are forwarded to handlers.

---

## Chord Detection

### Algorithm

A small chord-assembly buffer sits between the MIDI service and `enterNoteAtPitch`.

```
On Note-On received:
  1. Add { noteName, octave, accidental, velocity } to pendingChord[]
  2. Clear any existing chord timer
  3. Start a new timer for CHORD_WINDOW_MS (50 ms)

On timer fires:
  if pendingChord.length === 1 → call enterNoteAtPitch(pendingChord[0])
  if pendingChord.length > 1  → call enterChordAtPitch(pendingChord)
  clear pendingChord[]
```

`CHORD_WINDOW_MS = 50` — long enough for typical human chord roll, short enough to feel immediate for single notes.

### `enterChordAtPitch`

New callback in `ScoreCanvas` (mirrors `enterNoteAtPitch`):

- Checks cursor position and measure capacity.
- Auto-switches to note mode if not already there.
- Dispatches `ADD_NOTE` with a `Chord` event built from all pitches in `pendingChord`.
- Advances the cursor by the selected duration.
- Triggers `previewNote` for the highest pitch if `soundOnInput` is on (or skips — the MIDI device already made sound).

---

## Mode Behaviour

When a MIDI Note-On arrives and the app is **not** in note mode:

- If `inputMode === 'select'` or `'eraser'` or `'rest'`: switch to `'note'` mode first, then enter the note/chord.
- If `inputMode === 'text'`: ignore (user is editing a text field).

This matches the existing virtual keyboard behaviour.

---

## Sound on Input

Because the external MIDI keyboard produces its own audio, `previewNote` is **not** called when notes arrive from the MIDI input device (to avoid double-triggering). The `soundOnInput` flag continues to control the virtual keyboard preview.

The `NoteInput` type gains an optional `source` field (`'midi' | 'keyboard'`); the note handler skips `previewNote` when `source === 'midi'`.

---

## Implementation Plan

1. **`midiService.ts`**: Add `selectInput(portId: string | null)` to filter by port. Add `source: 'midi'` to `NoteInput`. Expose `inputInfos: { id, name }[]`.

2. **`appStore.ts`**: Add `midiInputDeviceId: string | null` state and `setMidiInputDevice` action. Persist to `localStorage`. Call `midiService.selectInput` on change.

3. **`ScoreCanvas.tsx`**:
   - Add `enterChordAtPitch` callback.
   - Replace the direct `useMidiInput` handler with a chord-assembling wrapper that buffers notes for `CHORD_WINDOW_MS` before dispatching.
   - Skip `previewNote` when `input.source === 'midi'`.

4. **`Toolbar.tsx`**: Add MIDI In button that opens a port picker (same pattern as MIDI Out). Show port name when active; grey "MIDI In" when not.

5. **`localStorage`**: On store init, read `midiInputDeviceId` and call `setMidiInputDevice` if set.

---

## Out of Scope

- Real-time recording (capturing rhythm from played timing).
- Sustain pedal (CC 64) handling.
- MIDI channel filtering.
- Polyphonic aftertouch or pitch-bend mapping.
