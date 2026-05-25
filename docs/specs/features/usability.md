# Usability Tweaks

**Slurs**

When multiple notes are selected, the slur button applies a slur across the selection. Otherwise it begins a slur from the cursor position, awaiting an end note (current behaviour).

**Note and Rest Replace**

In note mode, targeting a rest — by clicking it, typing a pitch (A–G), playing an on-screen piano key, or sending MIDI input — inserts a note at the selected pitch:

- If the note duration is less than the rest duration, the note is inserted and the remaining duration becomes a rest. Example: a 16th note targeted at an 8th rest produces a 16th note followed by a 16th rest.
- If the note duration exceeds the rest duration, the input is ignored.

**Note Sounding**

In select mode, any pitch change (arrow keys, drag, or clicking a different staff position) causes the note to re-sound.

**Eraser**

This mode is a bit redundant and it conflicts with the shortcut key for entering the E note. Remove this as a mode and improve the deletion behaviour while in select mode:

* Given a note is selected, the delete button should delete the note
* A deleted note should be replaced with the equivalent rest
* A deleted rest should be removed entirely but a measure should never be mathmatically incomplete
* The next event along should be selected (e.g. note, rest)

**Note Selection** 

* Left and right arrow keys should move the selection respectively
* When not in select mode, the selected note should not appear as selected but when back in select mode, the current selected note should be remembered.
* Tie should only work when the next note is the same pitch.
* Clicking away from a selectable item should deselect the current note and the context menu should be hidden

**Note Selection - multiple notes in the same position** 

When selecting a chord, all notes in that position should be selected but clicking again should cycle through notes in that position so that individual notes can also be selected.

Cycle wrap behaviour: 

* After reaching the last individual pitch, wrap back to all selected.
* Click anywhere else resets the cycle. Switching mode or left/right arrow navigation also resets.

Individual note selection:

* Once an individual note is selected, the same standard functionality should be available: deletion, change of pitch, change of duration, context menu
* Deletion of an individual pitch removes that pitch from the chord. A 2-pitch chord that loses one pitch becomes a plain Note.
* Pitch shift (ArrowUp/Down) moves only the selected pitch, not all pitches in the chord.
* Duration change applies to the whole chord event (all pitches share duration — no change in behaviour).

Visual indicator:

* To distinguish the selected individual note, colour the other noteheads in the chord the same as non-selected notes (black/default). Only the selected notehead shows the selection colour.

Implementation notes:

* No changes to the Score data model. Pitch selection is purely UI state: `selectedChordPitchIndex: number | null` in the app store (null = whole chord selected).
* New command `REMOVE_CHORD_PITCH { partId, staffId, measureId, voiceId, noteId, pitchIndex }` handles individual pitch deletion. Collapses to a Note when 2 pitches → 1.
* Renderer uses VexFlow `setKeyStyle(index, style)` per-notehead on the chord StaveNote when an individual pitch is active.
* Cycle position is local component state (`chordCycleState`), not persisted to the store.

Two voice scores: out of scope. Don't change current behaviour

**Measures and Completeness**

* A measure should always be mathmatically complete.
* It will start with a whole bar rest (semibreve)
* When notes are inputed, the remaining time will be filled with equivalent rests
* When notes are removed, rests will replace the note duration

**Note Insertion Behaviour**

When the cursor is on an existing note (not a rest), note input behaves as follows:

* **Different pitch** — the existing note is merged into a `Chord` event containing both pitches. The chord's duration is the currently selected input duration.
* **Same pitch** — no chord is created. The existing note's duration is changed to the currently selected input duration.
* In both cases the available space is `existing-note-units + consecutive-trailing-rest-units`. The selected duration must fit within this space; if it does not fit the input is rejected with the cursor-reject animation. If it fits, the existing event is replaced and any remaining space is filled with compacted rests (same rules as rest-replace).
* Clicking on a beat occupied by a note positions the cursor there (not forced to the first rest position). This is how the user targets a specific note for chord building.

**Note Cursor**

There is a single cursor, always visible on the score regardless of mode:

* It represents both the note input position and the playback start position.
* Clicking anywhere on the score repositions the cursor to that beat, regardless of the current mode.
* After the last note is entered the cursor advances to the next beat (existing behaviour in note/rest mode).
* During playback the cursor tracks the audio position in real time.
* When playback stops the cursor remains at the stopped position; the next note entry or playback starts from there.
* **Play from beginning** — resets the cursor to measure 1, beat 0, then starts playback from there.
* **Play from cursor** — starts playback from the current cursor position. This replaces the previous "Play from here" which required a selected note; now the cursor position is the authoritative start point.
* You never see two cursor elements simultaneously.

**Mouse Pointer**

The pointer should guide the user.

Note and rest insertion mode:

* The pointer should default to a cross-hair pointer
* The pointer should change in style to a pencil when hovering over a valid insertion point
* A valid insertion point is any measure area with space to insert
* Use a not-allowed pointer when an invalid insertion point is hovered over
* The existing shift to add chord behaviour should still remain
* The existing set cursor position should be unaltered

Marks and Midi mode:

* The pointer should default to a arrow pointer
* The pointer should change in style to a cross-hair when hovering over a valid insertion point

Select Mode:

* The pointer should default to a arrow pointer
* The existing set cursor position should be unaltered
* The pointer should change in style to a hand when hovering over a note or rest

 Lyric mode and text mode:

 Out of scope for now