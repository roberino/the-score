# Spec: Event Editor

## Overview

The Event Editor is an advanced view that exposes the underlying data model of a score in a structured, tabular form. It is intended for power users who need to inspect or directly manipulate event data that is not easily accessible through the notation canvas — for example, fine-tuning MIDI controller values, auditing articulations across many bars, or correcting imported data.

The editor is non-destructive: all changes dispatch through the normal command system and are fully undoable.

> **v2 scope (this release):** Full editing implemented. All columns marked "Editable?" are now live. Selection sync with the score canvas remains out of scope (see Q1).

---

## Access

A new top-level app view **Events** is added to the existing view tab bar alongside Score, Routing, and Performance.

- Keyboard shortcut: **⌘E** (toggles to/from Events view)
- The editor is available in all input modes; no mode switch is required

---

## Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Score]  [Routing]  [Performance]  [Events]          ← view tabs  │
├──────────────────────────────────────────────────────────────────────┤
│  Part: [Piano ▾]    Stave: [Treble ▾]                              │
│                                                                      │
│  [Notes]  [Expressions]  [Directives]  [MIDI]  [Structure]         │
│                                          ← editor category tabs     │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────── table ──────────────────────────────────┐ │
│  │  Bar │ Beat │ Voice │ Type │ Pitch │ ... │                      │ │
│  │  ────┼──────┼───────┼──────┼───────┼─────┤                      │ │
│  │   1  │  1.0 │   1   │ Note │  C4   │ ... │                      │ │
│  │   1  │  2.0 │   1   │ Rest │  —    │ ... │                      │ │
│  │   …  │  …   │   …   │  …   │  …    │ ... │                      │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Part and stave selectors

- **Part selector** (dropdown): lists all parts in the score by name. Defaults to the first part. When the score has only one part, the dropdown is shown but disabled.
- **Stave selector** (dropdown): lists the staves for the selected part (e.g. "Treble", "Bass" for a piano grand staff). Only visible when the selected part has more than one stave. Defaults to the first stave.
- Changing part or stave repopulates all tables without leaving the current category tab.

---

## Category Tabs

### 1. Notes

One row per `NoteEvent` (Note, Rest, or Chord) across all measures of the selected staff, in score order.

| Column | Source | Editable? |
|--------|--------|-----------|
| Bar | `measure.number` | No |
| Beat | beat position (formatted as `bar.beat`, e.g. `1.3`) | No |
| Voice | voice index (1 or 2) | No |
| Type | `note` / `rest` / `chord` | No |
| Note | `pitch.noteName` or `—` for rests | Yes — dropdown A–G |
| Octave | `pitch.octave` or `—` | Yes — numeric 0–9 |
| Accidental | `pitch.accidental` (`♯ ♭ ♮` or `—`) | Yes — dropdown |
| Duration | `duration` (e.g. `quarter`) | Yes — dropdown |
| Dots | `dots` (0 / 1 / 2) | Yes — dropdown |
| Tie → | `tieStart` | Yes — checkbox |
| ← Tie | `tieEnd` | Yes — checkbox |
| Dynamic | `event.dynamic` (`pp`…`ffff` or `—`) | Yes — dropdown |
| Lyric | `lyric` text or `—` | Yes — text input |
| Articulations | comma-separated list (e.g. `staccato, accent`) | Yes — multi-select |
| Tuplet | tuplet ratio (e.g. `3:2`) or `—` | Read-only |

**Chord rows:** A chord event occupies a single row. The *Note* and *Octave* columns show the lowest pitch; an expand control (▶) reveals sub-rows for each individual pitch with their own note/octave/accidental cells.

**Filtering:** A filter bar above the table lets the user restrict rows by bar range (e.g. `bars 3–8`), voice, or event type. Filter state persists while the view is open but resets when the part changes.

### 2. Expressions

Covers markings that span or attach to note events: hairpins, slurs, and note-attached dynamics summarised in context.

Three collapsible sub-sections within the table:

#### 2a. Hairpins

One row per `Hairpin` on the selected staff.

| Column | Source | Editable? |
|--------|--------|-----------|
| Type | `crescendo` / `decrescendo` | Yes — dropdown |
| From bar | derived from `fromNoteId` | No |
| From beat | derived | No |
| To bar | derived from `toNoteId` | No |
| To beat | derived | No |

Delete: row has a ✕ button (dispatches `REMOVE_HAIRPIN`).

#### 2b. Slurs

One row per `Slur` on the selected staff.

| Column | Source | Editable? |
|--------|--------|-----------|
| From bar | derived from `fromNoteId` | No |
| From beat | derived | No |
| To bar | derived from `toNoteId` | No |
| To beat | derived | No |
| Placement | `above` / `below` / `auto` | Yes — dropdown |

Delete: ✕ button (dispatches `REMOVE_SLUR`).

#### 2c. Note dynamics summary

A read-only list view (not a table) showing each measure that has a note with an attached dynamic, formatted as:

```
Bar 3, Beat 1, Voice 1: mf
Bar 7, Beat 1, Voice 1: f
```

Clicking a row navigates to the Notes tab with the filter set to that bar.

### 3. Directives

One row per `Directive` across all measures, plus one implicit row for the score's default tempo if no tempo directive exists at measure 1.

| Column | Source | Editable? |
|--------|--------|-----------|
| Bar | `measure.number` | No |
| Category | `tempo` / `dynamic` / `expression` | Yes — dropdown |
| Text | `directive.text` | Yes — text input |
| BPM | `directive.bpm` (tempo only) | Yes — numeric |
| MIDI program | `directive.midiProgram` (expression only) | Yes — numeric 0–127 or `—` |

Add row: an **+ Add directive** button at the bottom of the table opens a small inline form to pick the measure, category, and text before appending.

Delete: ✕ button (dispatches `REMOVE_DIRECTIVE`).

### 4. MIDI

Two sub-sections:

#### 4a. MIDI score events

One row per `MidiScoreEvent` across all measures of the selected staff.

| Column | Source | Editable? |
|--------|--------|-----------|
| Bar | `measure.number` | No |
| Beat | beat position | Yes — numeric |
| Type | `cc` / `pc` / `pb` / `sysex` | Yes — dropdown |
| CC# | `cc.controller` | Yes — numeric 0–127 |
| CC Value | `cc.value` | Yes — numeric 0–127 |
| Program | `pc.program` | Yes — numeric 0–127 |
| PB Value | `pb.value` | Yes — numeric −8192 to +8191 |
| SysEx | `sysex.hex` | Yes — text (space-separated hex) |

Columns that don't apply to the selected event type are greyed out.

Add row: **+ Add MIDI event** at the bottom (dispatches `ADD_MIDI_EVENT`).

Delete: ✕ (dispatches `REMOVE_MIDI_EVENT`).

#### 4b. Pedal marks

One row per `PedalMark` across all measures.

| Column | Source | Editable? |
|--------|--------|-----------|
| Bar | derived | No |
| Beat | `beatPosition` | Yes — numeric |
| Type | `down` / `up` | Yes — dropdown |

### 5. Structure

One row per measure, showing the structural properties of each bar.

| Column | Source | Editable? |
|--------|--------|-----------|
| Bar | `measure.number` | No |
| Barline | `measure.barline` | Yes — dropdown |
| Time sig | `measure.timeSignature` or `—` (inherited) | Yes — e.g. `4/4` |
| Key sig | `measure.keySignature` or `—` (inherited) | Yes — e.g. `G major` |
| Clef | `measure.clef` or `—` (inherited) | Yes — dropdown |
| Tempo | `measure.tempo` or `—` (inherited) | Yes — numeric BPM |

Editing time sig, key sig, or clef in this table dispatches `SET_TIME` / `SET_KEY` / `SET_CLEF` for that measure only. Setting a cell to `—` dispatches the corresponding `CLEAR_*` command.

---

## Editing Interactions

### Cell editing

- Single-click a cell that is editable activates an inline control:
  - Dropdowns: open immediately
  - Checkboxes: toggle immediately
  - Text/numeric: opens an inline input field
- **Enter** or clicking away commits the change (dispatches the appropriate command)
- **Escape** cancels without change
- Tab/Shift+Tab moves to the next/previous editable cell in reading order

### Keyboard shortcuts within the table

| Key | Action |
|-----|--------|
| ↑ / ↓ | Move row selection |
| Enter | Activate the primary editable cell of the selected row |
| Delete / Backspace | Delete selected row(s) where deletion is supported (Expressions, MIDI sub-tables) |
| Escape | Cancel active edit |

### Undo/redo

Every committed edit dispatches a single command and is therefore undoable with ⌘Z / ⌘⇧Z. Bulk edits (e.g. changing a property across multiple selected rows) dispatch a batch command and undo as a single step.

### Selection sync with score canvas

When the user returns to the Score view, the row(s) selected in the event editor do not affect the score canvas selection (and vice versa). The two selections are independent.

> **Q1 — Selection sync:** Should selecting a row in the Notes table highlight the corresponding note on the score canvas (and vice versa)? If so, should returning to the Score view scroll to the selected note?

---

## Validation

- Edits that produce invalid state (e.g. pitch outside `C0–B9`, numeric values out of range) are rejected with a brief inline error message. The cell reverts to its previous value.
- Changing a note's duration in the Notes table does not automatically re-fill adjacent rests (to avoid unexpected structural changes). A warning is shown if the resulting measure capacity would be violated.

> **Q2 — Duration editing:** Should editing a note's duration in the table trigger the same overwrite-and-fill logic used during note input (i.e. automatically adjusting adjacent events to keep the measure full)? Or should it reject the change if the new duration doesn't fit in the available space?

---

## Performance

- Tables are **virtualised** (only visible rows are rendered) to handle scores with thousands of events without jank.
- The initial render of each tab is deferred until the tab is first visited, using lazy population.

---

## Out of Scope (initial release)

- Adding new note events (use the score canvas for input)
- Reordering events by drag-and-drop within the table
- Bulk import/export of event data (e.g. CSV)
- Editing sequence/step-sequencer data (covered by the Sequence Editor)
- Per-chord pitch editing beyond expanding the chord row (Q3 below)

---

## Open Questions

**Q1 — Selection sync with score canvas**

Out of scope

**Q2 — Duration editing behaviour**
When a user changes a note's duration in the Notes table, the editor should reject the change with an error if the new duration would overflow the measure.

**Q3 — Chord pitch editing**
The spec proposes that chord rows expand to show sub-rows for each pitch. Editing individual pitches should be out of scope.

**Q4 — Read-only vs. fully editable on first release**
The initial release should start as a read-only inspector to de-risk complexity, with editing added in a follow-up.

**Q5 — Filtering and search**
Only supported for notes initially.

**Q6 — Beat display format**
Beat positions are stored as 64th-note units. For display, use `bar.beat` notation (e.g. `1.3` = beat 3 of bar 1 in 4/4).

**Q7 — Multi-row editing**

Out of scope.