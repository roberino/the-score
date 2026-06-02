# Advanced MIDI input

## Overview

Some MIDI keyboards contain additional controls which could be used to make note input easier. This spec covers MIDI learn: a mechanism for binding physical MIDI controls to application functions.

---

## 1. MIDI learn

### 1.1 Purpose

MIDI learn lets users assign physical MIDI controls (knobs, pedals, joysticks, pads, etc.) to in-app functions. The user opens a dialogue from the toolbar, picks a function, then touches the physical control to bind it. Each function is bound independently; any number can be assigned at once.

### 1.2 Supported MIDI message types

Both of the following message types may be learned:

| Type | Trigger condition |
|---|---|
| **Note-on** | Velocity > 0 on any MIDI channel |
| **CC (continuous controller)** | Any CC value > 0 on any MIDI channel |

The app captures whichever arrives first during the listening window. CC is preferable when the user has a choice, because note-on messages can conflict with note input (see §1.7).

### 1.3 Function types

Functions are categorised by how the CC value is interpreted at runtime:

| Type | How CC value is used | Example function |
|---|---|---|
| **Range** | Value (0–127) maps to one of N fixed options | Duration select |
| **Directional** | Value > 64 = forward/right; value < 64 = backward/left; value 64 = no-op | Cursor movement |
| **Trigger** | Any value > 0 fires the action once | Delete, Dot toggle |

The function registry must be extensible — new functions can be added without structural changes to the dispatch or UI code (e.g. a config table of `{ id, label, type, action }`).

### 1.4 Controllable functions

#### Duration select *(Range — already implemented)*

Maps the CC value (0–127) to one of the 7 note durations by dividing the range into equal bands. Fully right (127) = whole note, fully left (0) = 64th note.

| CC range | Duration |
|---|---|
| 0–17 | 64th |
| 18–35 | 32nd |
| 36–53 | 16th |
| 54–71 | Eighth |
| 72–89 | Quarter |
| 90–107 | Half |
| 108–127 | Whole |

Persistence key: `midiLearn_durationCycle` (existing, unchanged).

#### Cursor movement *(Directional)*

Moves the input cursor one event left or right, identical to the ArrowLeft / ArrowRight behaviour in note/rest mode.

- **Value > 64** → move right (next event)
- **Value < 64** → move left (previous event)
- **Value = 64** → dead zone, no movement

Active only when the input mode is **note** or **rest**. At a measure boundary the cursor wraps to the adjacent measure (first or last event), consistent with the keyboard implementation. At the score boundaries (start or end) the action is silently ignored.

Each CC message moves exactly one step regardless of how far the joystick is held; continuous movement while the control is held results from the stream of repeated messages the hardware sends.

Persistence key: `midiLearn_cursorMove`.

#### Delete *(Trigger)*

Replaces the note or chord at the cursor position with a rest of the same duration, identical to the Delete/Backspace key behaviour in note/rest mode. If the cursor is already on a rest the action is a no-op.

Active only when the input mode is **note** or **rest**.

Persistence key: `midiLearn_delete`.

#### Dot toggle *(Trigger)*

Toggles the dotted-duration flag on or off, identical to the `.` key shortcut.

Active in **note**, **rest**, and **select** modes.

Persistence key: `midiLearn_dotToggle`.

### 1.5 UI — toolbar button and dialogue

#### Toolbar button

A single compact **MIDI** button remains in the toolbar, inline with the duration selector. It opens and closes the MIDI learn dialogue. Its visual state reflects the aggregate binding state across all functions:

| State | Visual |
|---|---|
| No functions assigned, dialogue closed | Neutral (dim) |
| One or more functions assigned, dialogue closed | Active/coloured, badge showing count of assigned functions |
| Any function currently listening, dialogue closed | Pulsing highlight |
| Dialogue open | Button highlighted (same as "open picker" convention elsewhere) |

#### MIDI learn dialogue

A floating popup panel (same style as other pickers in the app). It lists every controllable function as a row and stays open while the user assigns controls.

**Row layout** (per function):

```
[ Function name ]  [ Type ]  [ Binding / status ]  [ Learn button ]
```

- **Function name**: e.g. "Duration select", "Cursor movement"
- **Type**: small badge — Range / Directional / Trigger
- **Binding / status**: one of:
  - *Unassigned* — no binding set
  - *CC 7, Ch 1* — bound control identifier
  - *Listening…* — pulsing, app waiting for a MIDI message
- **Learn button** cycles through states for that row:
  - Unassigned → starts listening for this function
  - Listening → cancels (returns to Unassigned)
  - Assigned → clears the binding (returns to Unassigned)

Only one function can be in the **Listening** state at a time. Clicking a Learn button on a different row while another is listening first cancels the current listener, then starts a new one.

**Closing the dialogue**: Escape key or a dedicated ✕ close button in the panel header. Closing does not affect any assignments.

### 1.6 Learn flow (per function row)

1. User clicks the row's Learn button → that row transitions to **Listening**.
2. App listens for the next qualifying MIDI message on any channel.
3. On receipt:
   - Run conflict checks (§1.7).
   - If no conflicts: store the binding, row transitions to **Assigned**, persist (§1.8).
   - If conflict: show inline error on the row (§1.7), remain **Listening**.
4. If no message arrives within **10 seconds**, auto-cancel and return to previous state.
5. During listening, the normal MIDI note-input path is suspended so the incoming message is captured rather than entered as a note.

### 1.7 Conflict detection

Two types of conflict are checked in order:

**Note-on conflict** — if the captured message is a note-on whose pitch is handled by the note entry path:
- Inline row error: *"That note is used for note input. Use a CC control instead."*
- Remain in Listening.

**Cross-function CC conflict** — if the captured CC number is already bound to a different function:
- Inline row error: *"CC [n] is already assigned to [Function name]. Clear that binding first."*
- Remain in Listening.

CC messages that don't conflict with note input or other functions are always accepted.

### 1.8 Persistence

Each function's binding is saved to `localStorage` under its own key (see §1.4). The stored value captures enough information to re-identify the message:

```json
{ "type": "cc", "channel": 1, "number": 64 }
// or
{ "type": "note", "channel": 1, "note": 36 }
```

Bindings are restored on app launch. A corrupt or unrecognisable entry is silently cleared.

### 1.9 Runtime dispatch

When a MIDI message matching a stored binding arrives:
- The message is consumed and does **not** propagate to note input.
- The binding check runs before the note-input handler so a matched control never enters a note.
- The function's action is invoked according to its type (§1.3), using the CC value where relevant.

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

The following are out of scope for the current release but should be kept in mind when maintaining the function registry:

- Rest entry
- Playback start / stop
- Voice selection