# Extended MIDI Control

## Overview

To enable advanced control of external MIDI devices during playback, a user can insert arbitrary MIDI events at any beat position in the score.

## User experience

A **MIDI** mode (toolbar button, shortcut `M`) works similarly to Marks mode: clicking in the zone below any staff opens a picker at the clicked beat position. The inserted event appears as a small coloured label (e.g. `CC7:100`, `PC25`, `PB+4096`, `SysEx`) rendered below the staff and is excluded from printing.

## Supported event types

| Type | Label format | Parameters |
|---|---|---|
| Control Change (CC) | `CC7:100` | Controller number (0–127) and value (0–127) |
| Program Change (PC) | `PC25` | Program number (0–127) |
| Pitch Bend (PB) | `PB+4096` | Value (−8192 to +8191) |
| SysEx | `SysEx` | Raw hex byte string, e.g. `F0 41 10 42 12 F7` |

## Positioning

Events are attached beat-precisely to a measure, stored as `beatPosition` in 64th-note units from the measure start. Clicking at an X position in the staff row converts to an approximate beat; the picker shows this value and lets the user adjust it before confirming.

## Channel

Each event is sent on the same MIDI channel as the parent part (consistent with note playback).

## Scope

Events are per-part/staff. Each measure on each staff stores an independent `midiEvents` array.
