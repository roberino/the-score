# Tab Notation

## Overview

Tablature (tab) notation provides a visual fretboard map for guitar-family instruments. When enabled on a part, a tab staff is rendered directly below the standard notation staff for every system. Tab is derived automatically from the pitched notes already in the standard staff — it is read-only in the initial implementation. Input continues through standard notation; direct tab entry is out of scope for now.

---

## 1. Supported Instruments

The following instruments support tab. Each instrument has a fixed open-string tuning (MIDI note numbers, string 1 = highest):

| Instrument     | Strings | Open-string tuning (low → high)         | Max frets |
|----------------|---------|------------------------------------------|-----------|
| Guitar (6-str) | 6       | E2 A2 D3 G3 B3 E4 (40 45 50 55 59 64)  | 24        |
| Bass (4-str)   | 4       | E1 A1 D2 G2 (28 33 38 43)              | 24        |
| Guitar (7-str) | 7       | B1 E2 A2 D3 G3 B3 E4 (35 40 45 50 55 59 64) | 24   |
| Ukulele        | 4       | G4 C4 E4 A4 (67 60 64 69) *(re-entrant)* | 15      |

Custom tunings are **out of scope**.

---

## 2. Instrument Configuration (`instruments.json`)

Each tab-capable instrument entry in `instruments.json` gains a `tab` object:

```json
{
  "id": "guitar",
  "tab": {
    "stringCount": 6,
    "openStrings": [40, 45, 50, 55, 59, 64],
    "fretCount": 24
  }
}
```

- `openStrings` — array of MIDI note numbers for open strings, ordered **low to high** (index 0 = lowest/thickest string).
- `fretCount` — maximum playable fret; notes above this range cannot be mapped and are omitted from the tab staff.

The `instruments.ts` type definition gains a corresponding optional `tab` field so it is available at runtime.

---

## 3. Data Model

### 3.1 Part — `showTab` flag

Add an optional field to the `Part` interface in `score.ts`:

```ts
readonly showTab?: boolean   // true = render tab staff below standard staff
```

Defaults to `false` (absent). The flag is only meaningful when the part's instrument has a `tab` configuration; it is ignored otherwise.

A new command handles toggling:

```ts
{ type: 'SET_PART_SHOW_TAB'; partId: string; show: boolean }
```

This is persisted in the score document like any other part property.

### 3.2 Note/Chord — no storage changes (Phase 1)

Tab fret/string positions are **computed at render time** from the note pitch and the instrument's tuning. No additional fields are added to `Note`, `Chord`, or `Pitch` in this phase.

> **Future (Phase 2 — direct tab input):** Each `Pitch` would gain an optional `tabPosition?: { string: number; fret: number }` override that takes priority over the computed value. This is explicitly out of scope here.

---

## 4. Pitch-to-Tab Algorithm

Given a MIDI note number `m` and an instrument's `openStrings` array (length `S`) and `fretCount`:

### 4.1 Single note

For each string `s` (0 = lowest, S-1 = highest), compute `fret = m - openStrings[s]`. Collect all valid positions where `0 ≤ fret ≤ fretCount`.

Apply the following priority to select the best position:

1. Prefer frets in the range 0–7 (open position) to mirror typical beginner/intermediate voicings.
2. Among equal-range candidates, prefer the highest-numbered string (thicker string = lower number in the array; we prefer the lower-pitched string to leave higher strings free for other notes in chords).
3. If no valid position exists (pitch out of the instrument's fretboard range), the note is omitted from the tab staff (no fret number drawn on that beat).

### 4.2 Chord

Sort the chord pitches from lowest to highest MIDI note. Then use a greedy string-assignment pass:

1. Maintain a set of **available strings** (initially all strings).
2. For each pitch (low → high), find all valid positions on available strings. Pick the position using the single-note priority above, restricted to unused strings.
3. Mark that string as used.
4. If no string is available for a pitch, omit that pitch from the tab rendering (draw nothing for it).

This approach keeps voicings in open position where possible and avoids string collisions.

---

## 5. Per-Part Configuration

### 5.1 UI toggle

The **Part Settings panel** (wherever instrument properties are edited) gains a **"Show Tab"** checkbox. The checkbox is only visible/enabled when the selected instrument has a `tab` config in `instruments.json`.

### 5.2 Instrument detection

At part creation, `showTab` defaults to `false`. The app does not auto-enable tab — the user opts in explicitly.

---

## 6. Rendering

Tab is rendered using **VexFlow's `TabStave` and `TabNote`** primitives, which already handle the standard tab visual language.

### 6.1 Tab staff appearance

- **Lines:** One horizontal line per string (6 for guitar, 4 for bass/ukulele, 7 for 7-string), spaced at the same line-spacing as the standard staff.
- **Fret numbers:** Drawn at the same horizontal x-position as the corresponding note/chord in the standard staff, centred on the string line.
- **Open strings:** Fret 0 is drawn as `0`.
- **Chords:** All fret numbers for a chord are vertically aligned at the same x-position.
- **Rests:** No marking on the tab staff (the strings-lines continue blank).
- **Clef area:** The tab staff shows the literal text label `TAB` vertically in the clef position at each system start.
- **Time signature / key signature:** Not repeated on the tab staff (only on the standard staff above).

### 6.2 Staff gap

A fixed vertical gap of **12 px** (at zoom 1) separates the bottom line of the standard staff from the top line of the tab staff, giving visual breathing room.

### 6.3 Measure barlines

Barlines extend through both the standard and tab staves so they read as a unified system.

---

## 7. Score Layout Integration

### 7.1 Height calculation

`computeLayout` (in `notationRenderer.ts`) currently calculates `staveY` / `staveTopY` per measure row. When a part has `showTab: true`, the row height for that part increases by:

```
tabStaveHeight = (stringCount - 1) * LINE_SPACING_PX + 12 /* gap */ + 12 /* bottom margin */
```

This extra height must be accounted for in:
- The per-row vertical stacking logic
- The total canvas height calculation
- The overlay canvas (cursor/selection) sizing

### 7.2 MeasureLayout extension

`MeasureLayout` gains two optional fields:

```ts
tabStaveTopY?: number    // top y of the tab staff for this measure (undefined if showTab is off)
tabStringCount?: number  // number of strings, for rendering
```

These are populated by `computeLayout` when `showTab` is true and passed through to `renderScoreMulti`.

### 7.3 Click handling

The tab staff area (between `tabStaveTopY` and `tabStaveTopY + tabStaveHeight`) is **non-interactive** in Phase 1. Clicks in this region fall through to the existing handler (which will find no layout hit and do nothing, or could be explicitly guarded to no-op).

---

## 8. Export

### 8.1 PDF

The PDF export is driven by the canvas render pipeline. Because the tab staff is rendered onto the same canvas as the standard notation (via VexFlow), it is included in PDF output automatically when `showTab: true`. No separate PDF logic is needed.

### 8.2 MusicXML

MusicXML 4.0 supports tab via `<staff-details>` and `<technical>` elements (`<string>` + `<fret>`). When exporting a part with `showTab: true`:

- Add `<staff-details>` in the first measure (and wherever a staff-details change occurs) specifying `<staff-lines>` and `<staff-tuning>` for each string.
- For each `Note`/`Chord` element, add a `<technical>` child containing `<string>` (1-based, 1 = highest) and `<fret>` values derived via the pitch-to-tab algorithm.
- Rests receive no `<technical>` element.

---

## 9. Out of Scope

- **Custom tunings** — standard tunings per instrument only.
- **Direct tab input** — fret/string entered directly by clicking the tab staff; all input is via standard notation.
- **Technique markings** — bends (`b`), slides (`/`, `\`), hammer-ons/pull-offs (`h`, `p`), vibrato (`~`), harmonics, etc.
- **Multi-voice tab** — tab displays voice 0 only.
- **Capo** — not modelled.

---

## 10. Open Questions / Future Work

- **Manual fret override (Phase 2):** Allow users to click a tab note and choose an alternative string/fret position from a popup. Requires adding `tabPosition` to `Pitch` and a `SET_TAB_POSITION` command.
- **Chord diagrams:** Box-style chord diagrams above the staff (common in lead sheets) — separate feature.
- **Bass clef tab staff:** Bass tab conventionally uses a bass clef `TAB` label; the label style should match convention.
