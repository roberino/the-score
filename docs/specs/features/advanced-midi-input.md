# Advanced MIDI input

## Overview

Some MIDI keyboards contain additional controls which could be used to make note input easier. This spec covers MIDI learn: a mechanism for binding physical MIDI controls to application functions.

---

## 1. MIDI learn

### 1.1 Purpose

MIDI learn lets users assign a physical MIDI control (knob, pedal, pad, etc.) to an in-app function. The app "listens" for an incoming MIDI message and stores the binding. Initially one function is in scope (duration cycle), but the design must support additional functions without structural changes.

### 1.2 Supported MIDI message types

Both of the following message types may be learned:

| Type | Trigger condition |
|---|---|
| **Note-on** | Velocity > 0 on any MIDI channel |
| **CC (continuous controller)** | Any CC value > 0 on any MIDI channel |

The app captures whichever arrives first during the listening window. CC is preferable when the user has a choice, because note-on messages can conflict with note input (see §1.6).

### 1.3 Controllable functions

| Function | Behaviour when triggered |
|---|---|
| **Duration cycle** | Cycles forward through the note duration list, wrapping from 64th back to whole. |

Duration order (cycling): whole → half → quarter → eighth → 16th → 32nd → 64th → *(wrap)* → whole.

The design must allow additional functions to be added to the mappable list without architectural changes (e.g. a registry or config table of `{ id, label, action }`).

### 1.4 UI — learn button

The MIDI learn button is placed in the toolbar, inline with the duration selector.

**States:**

| State | Visual | Description |
|---|---|---|
| **Unassigned** | MIDI icon, neutral | No binding set. Click to enter listening mode. |
| **Listening** | MIDI icon, pulsing highlight | App is waiting for a MIDI message. Click again to cancel. |
| **Assigned** | MIDI icon, active/coloured | A binding is stored. Tooltip shows the assigned control (e.g. "CC 64, Ch 1"). Click to clear the binding. |

Clicking the button cycles through these states:
- Unassigned → Listening
- Listening → Unassigned (cancel)
- Assigned → Unassigned (clear)

There is no separate "clear" control; the button itself is the toggle.

### 1.5 Learn flow

1. User clicks the learn button → state transitions to **Listening**.
2. App listens for the next qualifying MIDI message (note-on or CC, see §1.2) on any channel.
3. On receipt of a qualifying message:
   - Run conflict check (§1.6).
   - If no conflict: store the binding, transition to **Assigned**, persist to storage (§1.7).
   - If conflict: show error (§1.6), remain in **Listening** state.
4. If no MIDI message is received within **10 seconds**, the app auto-cancels and returns to the previous state (Unassigned or Assigned).
5. During listening, the normal MIDI note-input path is suspended so the incoming message is captured rather than entered as a note.

### 1.6 Conflict detection

If the user attempts to learn a **note-on** message whose pitch would also be a valid note input (i.e. is a standard MIDI pitch handled by the note entry path), the assignment is **rejected**:

- Show a brief inline error near the learn button: *"That note is used for note input. Use a CC control or a note outside the input range."*
- Remain in Listening state so the user can try a different control.

CC messages never conflict with note input and are always accepted.

### 1.7 Persistence

Learned assignments are saved to `localStorage` under a key namespaced per function (e.g. `midiLearn_durationCycle`). The stored value captures enough information to re-identify the message:

```json
{ "type": "cc", "channel": 1, "number": 64 }
// or
{ "type": "note", "channel": 1, "note": 36 }
```

Assignments are restored on app launch. If the saved assignment can no longer be validated (e.g. corrupt entry), it is silently cleared.

### 1.8 Runtime dispatch

When a MIDI message matching a stored binding arrives on the MIDI input path:
- The message is consumed by the binding and does **not** propagate to note input.
- The associated action is invoked (e.g. advance the selected duration).
- The binding check runs before the note-input handler so a matched control never enters a note.

---

## 2. Note Input Mode

### 2.1 Overview

Controls what happens when a note is entered at a cursor position that already contains a note event. Applies to virtual keyboard and external MIDI input only.

A toggle button placed next to the voice buttons (V1/V2) switches between the two modes.

### 2.2 Overwrite mode (default)

The event at the cursor is replaced entirely.

| Behaviour | Detail |
|---|---|
| **Duration** | The currently selected duration is applied to the new note. |
| **Remainder** | Any unused beats in the measure are filled with rests. |
| **Rejection** | Input is rejected if the selected duration exceeds the available space at the cursor. |
| **Cursor** | Advances to the start of the next rest after entry. |

At a rest, overwrite mode is the only valid behaviour and the cursor advances as normal.

### 2.3 Chord mode

A new pitch is added to the note at the cursor, extending it into (or further building) a chord. The note's existing duration is preserved.

| Behaviour | Detail |
|---|---|
| **Duration** | Inherited from the existing note; the selected duration is ignored. |
| **Remainder** | Unchanged — no new time is consumed. |
| **Rejection** | Input is ignored if the pitch is already present in the chord. |
| **Cursor** | Stays on the same beat, ready for additional pitches. |

If the cursor is on a **rest**, chord mode falls back to overwrite behaviour (a rest has no pitches to extend).

### 2.4 Relationship to simultaneous MIDI chord entry

Simultaneously-played MIDI notes (within the 50 ms detection window) are always entered as a chord regardless of the current input mode — the window fires before the mode toggle is consulted. Chord mode enables *sequential* chord building: the user plays or clicks one pitch at a time to accumulate pitches on a single beat.

## 3. Future controllable functions (non-exhaustive candidates)

The following are **out of scope for the initial release** but should be kept in mind when designing the binding registry:

- Octave up / octave down
- Rest entry
- Playback start / stop
- Dot toggle
- Voice selection
