# Lyrics

Syllable-by-syllable text attached to notes, with mid-word hyphens and melisma extender lines.

## Goals

- Single verse of lyrics attached to voice 0 of each part
- Import / export via MusicXML `<lyric>` round-trip
- Dedicated Lyric mode with keyboard-driven navigation

## Data model

`lyric?: string` on `Note` and `Chord` (never on `Rest`).

Encoding rules:
- Word-ending syllable: stored as-is, e.g. `"lo"`
- Mid-word syllable: trailing hyphen, e.g. `"hel-"`
- Melisma: last word-ending syllable followed by notes that have no lyric

## Command

`SET_LYRIC { noteId: string; lyric: string | undefined }`

Searches the whole score tree by `noteId` (no part/staff context needed), sets or deletes `lyric`. Follows the `SET_NOTE_DYNAMIC` pattern.

## Rendering

`drawAllLyrics(ctx2d, score, notePositions, layouts, lyricCursorNoteId)` called from `renderScore` after VexFlow rendering.

- Text: 12 px serif, centered on note X, 60 px below staveTopY
- Mid-word hyphen: small `-` centered between consecutive syllables
- Melisma extender: horizontal line from end of syllable text to next lyric note
- Cursor note: blue underline drawn; text omitted (input field shows it instead)

## Editing UX

- **Entry**: press `L` to enter Lyric mode (from any mode except select-with-note-selected, which keeps `L` for slur)
- **Cursor**: starts at the selected note (if pitched) or the first pitched note in voice 0
- **Input**: floating `<input>` overlaid at the cursor note's lyric position
- **Space / Enter**: commit syllable (word end), advance / exit
- **Hyphen**: commit syllable with trailing `-` (mid-word), advance
- **Tab / Shift+Tab**: advance / retreat without committing
- **Backspace** on empty: clear current note's lyric, retreat
- **Escape**: exit lyric mode → select mode

## MusicXML

Export:
```xml
<lyric number="1">
  <syllabic>begin|middle|end|single</syllabic>
  <text>hel</text>
</lyric>
```

Import: maps `syllabic` → trailing hyphen (`begin`/`middle` → add `-`; `end`/`single` → no suffix).

## Acceptance criteria

- [ ] Typing lyrics advances through notes; hyphens and melisma lines render
- [ ] Lyrics survive save / load (stored in `.notation` JSON)
- [ ] MusicXML export contains `<lyric>` elements; import restores them
- [ ] `SET_LYRIC` is undoable
