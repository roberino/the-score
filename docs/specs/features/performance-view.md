# Performance View

The performance view presents each staff as a horizontal track in a DAW-style tabular layout. Rather than showing notation, each track displays a **piano roll visualisation** of its note events — notes as horizontal rectangles positioned vertically by pitch. The view is read-only and focused on playback observation.

It is navigable via a tab alongside Score and Routing.

---

## 1. Layout

```
┌─────────────────┬──────────────────────────────────────────────────────┐
│                 │  1        2        3        4        5        6       │  ← ruler
├─────────────────┼──────────────────────────────────────────────────────┤
│ [icon] Piano    │  ░░░  ██    ░  ██████  ░░░  ██  ░░░░░  ████  ░░░     │
│  🔇  ◉  ──●──  │                                                        │
├─────────────────┼──────────────────────────────────────────────────────┤
│ [icon] Piano    │  ██░░░░░  ██    ░░░  ██████░░  ██  ░░░  ████  ░░     │
│  🔇  ◉  ──●──  │  (bass staff)                                          │
├─────────────────┼──────────────────────────────────────────────────────┤
│ [icon] Violin   │  ░░  ████░░  ██░░░░  ████  ░░░░  ██████  ░░░         │
│  🔇  ◉  ──●──  │                                                        │
└─────────────────┴──────────────────────────────────────────────────────┘
```

- **Left panel** — fixed-width track header for each row.
- **Right panel** — scrollable piano roll canvas; scrolls horizontally.
- **Top ruler** — measure numbers, fixed (does not scroll vertically).

---

## 2. Track rows

Each **staff** gets its own row. A piano part with treble and bass staves produces two adjacent rows. Row height is fixed.

### 2.1 Track header

The header occupies a fixed left column and contains:

| Element | Detail |
|---|---|
| Instrument icon | Same icons used in Routing view (sourced from wiki-commons assets) |
| Part name | Full name of the part |
| Mute button | Toggles part mute. Consistent with existing mute behaviour in score view. |
| Solo button | Solos this part during playback (all others muted). One solo active at a time; selecting another solo shifts it. |
| Volume control | Horizontal slider controlling part volume. Reflects and updates the same `part.volume` used elsewhere. |

For a multi-staff part (e.g. piano), both staff rows share the same header — the header cell spans the full height of both rows.

### 2.2 Piano roll track body

Each row's body is a compressed piano roll:

- **X axis** — time, scaled uniformly by measures. All measures have equal width.
- **Y axis** — MIDI pitch. The visible range spans the full chromatic range present across all parts in the score, with a small padding above and below. The range is fixed at load/render time; it does not change during playback.
- **Notes** — horizontal filled rectangles. Width proportional to note duration; height is 1 pitch unit within the compressed row.
- **Note colour** — matches the part accent colour (same blue `#3b9ddd` used for sequencer cells, voice-2 green `#2d8f4e` for second-voice notes). Rests produce no rectangle.
- **Sequencer parts** — use the same mini-grid step preview already rendered in score view (step columns × pitch rows within the row height), consistent with the score view display.

---

## 3. Time axis and ruler

- A **ruler strip** runs across the top of the track canvas, showing measure numbers (1, 2, 3 …).
- **Barlines** are drawn as thin vertical lines spanning all track rows at each measure boundary.
- **No zoom** — horizontal scale is fixed. The measure width is chosen to fit all measures within the canvas width where possible; if the score is long, the canvas is wider than the viewport and horizontal scrolling is used.

---

## 4. Playback

### 4.1 Playback cursor

A thin vertical line spans all track rows and indicates the current playback position, consistent with the cursor in score view. The cursor moves in real time during playback.

### 4.2 Auto-scroll

During playback the track canvas scrolls horizontally to keep the playback cursor visible. The cursor is held roughly one-third from the left edge of the viewport so the user can see upcoming content.

### 4.3 Controls

The existing play/stop controls (including the Play from beginning / Play from here split-button from the Advanced Playback spec) operate identically in this view. No additional playback controls are added for MVP.

---

## 5. Interaction

The performance view is **read-only** for note editing:

- No note editing or selection from this view.
- Mute, solo, and volume controls in the track header are interactive (they affect playback state).
- Clicking a bar in the track body navigates to that measure in the Score view (see §6.2).

---

## 6. Navigation

### 6.1 Tab access

The view is accessible via a **Performance** tab in the main tab bar, at the same level as Score and Routing. Switching to the view does not affect playback state or the score cursor position.

### 6.2 Navigate to score from a bar click

Clicking anywhere in a track row's canvas area navigates to the corresponding measure in the Score view:

1. The app switches to the **Score** tab.
2. The score's note-entry cursor is moved to beat 1 of the clicked measure (beat position 0).
3. The Score view scrolls to bring that measure into view.

The measure is identified by the horizontal click position: `measureIndex = floor(clickX / measureWidth)`, where `clickX` is the x offset within the canvas cell. The cursor is placed in the first part's staff at that measure index.

This interaction is not available during active playback — clicks on the track body are ignored while the score is playing.

---

## 7. Out of scope for MVP

- Horizontal zoom
- Enhanced playback controls (loop, metronome, tempo override)
- Note selection or editing from the piano roll
- Per-staff pitch range configuration
- Track reordering
- Track colour customisation
