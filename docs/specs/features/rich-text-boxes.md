# Rich Text Boxes

## Goal

Allow the user to place freely-moveable text boxes anywhere on the score canvas for annotations, rehearsal notes, performance directions, or any other free-form text.

## Decisions

| Question | Answer |
|---|---|
| Formatting | Basic UI (Bold, Italic, Underline, font size, colour) + Source toggle for advanced HTML editing |
| Anchoring | Absolute canvas position (x, y at zoom=1) |
| Creation | Double-click on empty canvas space in Select or Eraser mode |
| PDF export | Included — plain text approximation (HTML stripped) |

## Markup tradeoffs

The "basic UI + source toggle" approach stores text as sanitised HTML (`<b>`, `<i>`, `<u>`, `<span style="font-size|color">`).

| Risk | Mitigation |
|---|---|
| PDF fidelity — browser antialiasing ≠ canvas rendering | Bold/italic respected; colour/size approximated |
| HTML hygiene from paste | Allow-list sanitiser runs on every commit |
| Malformed source HTML | Sanitiser re-parses on save; bad tags are stripped, not stored |

## Data model

```typescript
interface TextBox {
  id: string
  x: number        // canvas px at zoom=1
  y: number
  width: number    // box width at zoom=1 (default 220)
  html: string     // sanitised HTML
}

// Added to Score:
textBoxes: TextBox[]  // default []
```

## Commands

- `ADD_TEXT_BOX { box: TextBox }` — insert a new box
- `UPDATE_TEXT_BOX { id, html?, x?, y?, width? }` — mutate one or more fields
- `DELETE_TEXT_BOX { id }` — remove a box

## UI

### Creation
Double-click on empty canvas space (no note, barline, clef, or heading hit) while in Select or Eraser mode → new box at that position, immediately in edit mode.

### States per box
| State | Visual |
|---|---|
| Idle | Renders HTML; transparent border; drag handle visible on hover |
| Selected | Blue border; Delete/Backspace removes the box |
| Editing | contentEditable div; formatting toolbar appears above the box |

### Formatting toolbar (edit mode)
`[B] [I] [U] [size▾] [colour▾] [⟨/⟩ Source] [✕]`

- B / I / U via `document.execCommand`
- Font size: Small (11), Normal (14), Large (18), Huge (24)
- Colour: small palette (black, red, blue, green, grey)
- Source toggle: reveals a `<textarea>` with raw HTML; sanitised on switch-back
- ✕ closes edit mode (also: Escape, click outside)

### Moving
Drag the handle bar at the top of the box. Position stored unscaled; rendered at `x * zoom, y * zoom`.

### Resizing
CSS `resize: horizontal` on the content area. Width captured via ResizeObserver on blur and dispatched as `UPDATE_TEXT_BOX`.

## PDF export

Text boxes are overlaid on the first page of the PDF using jsPDF's `text()` API. Coordinate mapping: `x_mm = box.x × (210 / 1200)`, `y_mm = box.y × (210 / 1200)`. HTML is stripped to plain text. Multi-page mapping is a future enhancement.

## Scope

- `src/shared/score.ts` — `TextBox` type, `Score.textBoxes`
- `src/shared/commands.ts` — three new commands + reducers
- `src/renderer/components/TextBoxLayer.tsx` — new component
- `src/renderer/components/ScoreCanvas.tsx` — double-click handler, render layer
- `src/renderer/engine/pdfExporter.ts` — overlay text on page 1
- `src/renderer/store/appStore.ts` — normalise `textBoxes` on load
