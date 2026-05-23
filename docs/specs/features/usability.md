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
* A deleted rest should be removed entirely
* The next event along should be selected (e.g. note, rest)

**Note Selection** 

* Left and right arrow keys should move the selection respectively
* When not in select mode, the selected note should not appear as selected but when back in select mode, the current selected note should be remembered.
* Tie should only work when the next note is the same pitch.