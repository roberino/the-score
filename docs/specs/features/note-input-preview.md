# Spec: Note Input Preview (Mouse Cursor Guide)

## Overview

This spec covers two closely related improvements to mouse-based note input:

1. **Bug fix** — clicks on a stave currently insert a note on the stave above due to a hit-zone overlap bug in `findClickedLayout`. This must be fixed as a prerequisite.
2. **Preview grid** — while hovering over the score canvas in Note or Rest mode, a live preview shows the exact pitch and beat position where a click will place a note. The preview renders directly on the canvas, not as a DOM overlay.

---

## Part 1: Hit-Zone Bug Fix

### Root Cause

`findClickedLayout` (ScoreCanvas.tsx:306) uses `Array.find()` which returns the first layout whose hit zone contains the cursor. Each stave's hit zone extends `LEDGER_MARGIN = 50 px` above `staveTopY` and 50 px below the stave bottom. When two staves are close together vertically (as with a piano grand staff, or parts with small inter-stave gaps), the upper stave's zone extends into the lower stave's territory. Since `find()` returns the first (upper) match, clicks near the top of the lower stave resolve to the wrong layout.

### Fix

Replace the `find()` call with a "nearest centre" search across all in-zone layouts:

```typescript
function findClickedLayout(
  x: number,
  y: number,
  layouts: MeasureLayout[]
): MeasureLayout | undefined {
  const LEDGER_MARGIN = 50
  const STAVE_HEIGHT  = 4 * LINE_SPACING_PX

  const candidates = layouts.filter(l =>
    x >= l.x &&
    x <= l.x + l.width &&
    y >= l.staveTopY - LEDGER_MARGIN &&
    y <= l.staveTopY + STAVE_HEIGHT + LEDGER_MARGIN
  )

  if (!candidates.length) return undefined

  // When multiple staves overlap at this Y, prefer the one whose
  // vertical centre is closest to the click.
  const centre = (l: MeasureLayout) => l.staveTopY + STAVE_HEIGHT / 2
  return candidates.reduce((best, l) =>
    Math.abs(y - centre(l)) < Math.abs(y - centre(best)) ? l : best
  )
}
```

This fix must be applied to both `handleCanvasClick` and `handleCanvasMouseMove` — they both call `findClickedLayout`.

---

## Part 2: Note Input Preview

### Goal

While in Note or Rest mode and hovering over the canvas, draw a real-time preview that answers two questions simultaneously:

- **What pitch** will be entered (vertical position → staff line/space → pitch name)
- **Where in the measure** will it go (horizontal position → beat column)

### Visual Design

The preview is composed of three layers drawn on the canvas in `handleCanvasMouseMove`, cleared on mouse leave and on mode exit.

#### Layer 1 — Staff line/space highlight (horizontal band)

A full-width translucent band spanning the hovered measure highlights the staff line or space the cursor is targeting.

- Width: the full measure width
- Height: `LINE_SPACING_PX / 2` (5 px) — one staff "slot"
- Y: snapped to the nearest half-line-spacing step from `staveTopY`
- Colour: `rgba(99, 179, 237, 0.18)` (light blue tint)
- Extends slightly beyond the stave for ledger-line positions (up to 3 ledger lines above/below)

The band makes it immediately obvious which line or space you are on, especially when moving between adjacent slots.

#### Layer 2 — Ghost note head

A semi-transparent note head drawn at the snapped position:

- X: the beat-column X (see Layer 3 below), offset by the standard notehead x-shift VexFlow would use
- Y: the snapped step Y
- Rendered as a filled oval matching VexFlow's notehead proportions (`~8 × 6 px`)
- Opacity: 0.45
- Colour: same blue as the selection colour (`#3B82F6`)
- For rests (Rest mode): draw the rest glyph instead of a notehead, at the same beat-column position

The ghost head gives sub-pixel feedback on the exact position; the user sees what will appear after clicking.

#### Layer 3 — Beat-column indicator (vertical line)

A thin vertical line marks the beat position where the note will be inserted.

- Height: spans from `staveTopY - LEDGER_MARGIN/2` to `staveTopY + STAVE_HEIGHT + LEDGER_MARGIN/2`
- X: the X coordinate of the next available beat slot at the horizontal cursor position (resolved from `noteStartXRef` / existing event X positions)
- Width: 1 px
- Colour: `rgba(59, 130, 246, 0.55)`

Beat-column snapping rules (same as the existing click handler):
1. If the cursor is within 20 px of an existing note/rest X, snap to that event's X (replace that event).
2. Otherwise snap to the end-of-voice X (append position).

#### Layer 4 — Pitch label (optional, low priority)

A small text label (`"C4"`, `"F#5"`, etc.) rendered 8 px above the ghost note head.

- Font: `10px sans-serif`, fill `#3B82F6`
- Suppressed when the cursor is within 3 ledger lines of a pitch already visible (i.e., within the standard staff range) to avoid clutter — only shown for ledger-line notes where the pitch is harder to read.

### Coordinate Snapping

The step used for the ghost head and band is computed identically to what a click would produce:

```typescript
const step    = yToStep(canvasY, layout.staveTopY, LINE_SPACING_PX)
const { noteName, octave } = stepToPitch(step, clef)
const snappedY = layout.staveTopY + step * (LINE_SPACING_PX / 2)
```

This ensures the preview and the resulting note are always at the same position — no surprises on click.

### State

The preview is ephemeral render state, not React state. It lives in a ref:

```typescript
interface NoteInputPreview {
  layoutId:   string        // measureId — identifies which measure is previewed
  step:       number        // snapped staff step
  snappedY:   number        // canvas Y of the snapped position
  beatX:      number        // canvas X of the beat column
  noteName:   NoteName
  octave:     number
  clef:       ClefType
}

const noteInputPreviewRef = useRef<NoteInputPreview | null>(null)
```

On each `mousemove`, the ref is updated and the canvas is re-rendered. On `mouseleave` (and on mode change), the ref is set to `null` and the canvas is re-rendered to clear the preview.

### Render Integration

The preview is drawn as a post-pass on top of the existing canvas render. Two approaches are viable:

**Option A — Overlay canvas (recommended):** Add a second `<canvas>` element positioned absolutely over the score canvas, same size. The preview draws only to this overlay; the main canvas is never touched. This avoids re-running the full score render on every mouse move.

**Option B — Re-render pass:** Call a lightweight `drawPreview(ctx, preview)` function after each full render. Only viable if full renders are fast enough to not feel laggy at 60 fps mouse moves — unlikely for large scores.

**Recommended: Option A.** The overlay canvas has `pointer-events: none` so all mouse events pass through to the main canvas div.

### Overlay Canvas Lifecycle

- Created alongside the existing canvas setup
- Resized in the same `ResizeObserver` callback
- Cleared on every `mousemove` before redrawing (the preview layer is always fully repainted from scratch — it's fast, just 3–4 draw calls)
- Cleared fully on `mouseleave`, mode change, or click

### Suppression Cases

Do not show the preview when:
- Input mode is not `'note'` or `'rest'`
- The cursor is not over a valid measure (`findClickedLayout` returns `undefined`)
- The part under the cursor is in `inputMode: 'sequencer'`
- The measure is full and no note can be inserted (show the `invalid` cursor instead, no ghost head)
- The part's stave is percussion and the mode is `'note'` (pitch-less; the notehead position is always a fixed drum-map slot — out of scope for this spec)

---

## Acceptance Criteria

### Bug fix

1. With two parts on the same system row, clicking the top line of the lower stave inserts the note on the lower stave, not the upper.
2. Clicking between two staves (in the gap) resolves to the nearer stave.

### Preview

3. Moving the mouse over a stave in Note mode immediately shows the horizontal band snapped to the nearest half-line-spacing slot.
4. The ghost note head appears at the correct pitch position and moves smoothly between slots as the cursor crosses line/space boundaries.
5. The vertical beat-column line snaps to the nearest existing event within 20 px, or to the append position otherwise.
6. The pitch label appears only for notes beyond the standard staff range (more than 2 ledger lines out).
7. The preview clears instantly on mouse leave.
8. The preview clears when the mode switches away from Note/Rest.
9. The preview has no measurable effect on full-score render performance (uses overlay canvas, not re-render).
10. Clicking while the preview is visible inserts the note exactly at the previewed position — the preview is truthful.

---

## Out of Scope

- Chord preview (multiple ghost heads)
- Stem direction preview
- Accidental preview (primed accidental applied to ghost head)
- Tab notation preview
- Drum/percussion stave preview
