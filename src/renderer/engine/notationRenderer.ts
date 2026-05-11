// ─────────────────────────────────────────────────────────────────────────────
// Notation renderer
//
// Translates the Score model → VexFlow stave objects → HTML5 Canvas.
// This is the core rendering pipeline. Keep it pure (no React, no store).
// ─────────────────────────────────────────────────────────────────────────────

import {
  Renderer as VexRenderer,
  Stave,
  StaveNote,
  Voice as VexVoice,
  Formatter,
  Beam,
  Accidental as VexAccidental,
  type RenderContext
} from 'vexflow'

import type { Score, Part, Staff, Measure, NoteEvent, Note, Rest, Chord, Duration, ClefType } from '@shared/score'

// ── Duration mapping: our model → VexFlow key ────────────────────────────────

const DURATION_MAP: Record<Duration, string> = {
  whole:   'w',
  half:    'h',
  quarter: 'q',
  eighth:  '8',
  '16th':  '16',
  '32nd':  '32',
  '64th':  '64'
}

// ── Pitch → VexFlow key string  e.g. { noteName: 'C', octave: 4 } → "c/4" ───

function pitchToVexKey(pitch: { noteName: string; octave: number; accidental: string | null }): string {
  return `${pitch.noteName.toLowerCase()}/${pitch.octave}`
}

// ── Convert a NoteEvent to a VexFlow StaveNote ────────────────────────────────

function noteEventToStaveNote(event: NoteEvent, selected: boolean): StaveNote {
  switch (event.type) {
    case 'note': {
      const n = event as Note
      const staveNote = new StaveNote({
        keys: [pitchToVexKey(n.pitch)],
        duration: DURATION_MAP[n.duration] + (n.dots > 0 ? 'd'.repeat(n.dots) : '')
      })
      if (n.pitch.accidental) {
        const acc = n.pitch.accidental === 'sharp'       ? '#'
          : n.pitch.accidental === 'flat'        ? 'b'
          : n.pitch.accidental === 'natural'     ? 'n'
          : n.pitch.accidental === 'doubleSharp' ? '##'
          : 'bb'
        staveNote.addModifier(new VexAccidental(acc), 0)
      }
      if (selected) {
        staveNote.setStyle({ fillStyle: '#3b9ddd', strokeStyle: '#3b9ddd' })
      }
      return staveNote
    }
    case 'rest': {
      const r = event as Rest
      const staveNote = new StaveNote({
        keys: ['b/4'],
        duration: DURATION_MAP[r.duration] + (r.dots > 0 ? 'd'.repeat(r.dots) : '') + 'r'
      })
      if (selected) {
        staveNote.setStyle({ fillStyle: '#3b9ddd', strokeStyle: '#3b9ddd' })
      }
      return staveNote
    }
    case 'chord': {
      const c = event as Chord
      return new StaveNote({
        keys: c.pitches.map(pitchToVexKey),
        duration: DURATION_MAP[c.duration]
      })
    }
  }
}

// ── Render options ────────────────────────────────────────────────────────────

export interface RenderOptions {
  canvasWidth: number
  measuresPerLine: number
  staveWidth: number
  staveHeight: number
  marginX: number
  marginY: number
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  canvasWidth: 1200,
  measuresPerLine: 4,
  staveWidth: 260,
  staveHeight: 120,
  marginX: 40,
  marginY: 60
}

// ── Layout ────────────────────────────────────────────────────────────────────
// Pure function: computes bounding positions for each measure without rendering.

export interface MeasureLayout {
  measureId: string
  partId: string
  staffId: string
  voiceId: string
  clef: ClefType
  x: number
  staveTopY: number   // y of the actual top staff LINE (not VexFlow stave.y)
  staveY: number      // raw y passed to new Stave() — needed for the renderer
  width: number
}

// VexFlow 5 default: spaceAboveStaffLn = 4, spacingBetweenLinesPx = 10
// So the top staff line sits 40px below the stave.y parameter.
const VEXFLOW_HEADROOM_PX = 40

export function computeLayout(score: Score, options: RenderOptions): MeasureLayout[] {
  const layouts: MeasureLayout[] = []
  const { measuresPerLine, staveWidth, staveHeight, marginX, marginY } = options
  const totalParts = score.parts.length
  const rowHeight = staveHeight * totalParts + 40

  score.parts.forEach((part, partIndex) => {
    part.staves.forEach((staff) => {
      staff.measures.forEach((measure, measureIndex) => {
        const lineIndex = Math.floor(measureIndex / measuresPerLine)
        const colIndex  = measureIndex % measuresPerLine
        const x         = marginX + colIndex * staveWidth
        const y         = marginY + lineIndex * rowHeight + partIndex * staveHeight
        layouts.push({
          measureId: measure.id,
          partId:    part.id,
          staffId:   staff.id,
          voiceId:   measure.voices[0]?.id ?? '',
          clef:      staff.clef,
          x,
          staveTopY: y + VEXFLOW_HEADROOM_PX,   // actual top staff line
          staveY:    y,                           // raw VexFlow stave.y
          width:     staveWidth,
        })
      })
    })
  })

  return layouts
}

// ── Main render function ──────────────────────────────────────────────────────

export interface RenderCursorOptions {
  cursorMeasureId: string | null
  cursorBeatPosition: number          // in 64th-note units
  totalCapacityUnits: number          // 64th-note units per measure
}

export function renderScore(
  canvas: HTMLCanvasElement,
  score: Score,
  options: RenderOptions = DEFAULT_RENDER_OPTIONS,
  selectedNoteId: string | null = null,
  cursor: RenderCursorOptions | null = null
): void {
  const renderer = new VexRenderer(canvas, VexRenderer.Backends.CANVAS)

  const firstPart = score.parts[0]
  if (!firstPart) return
  const firstStaff = firstPart.staves[0]
  if (!firstStaff) return

  const measureCount = firstStaff.measures.length
  const lineCount = Math.ceil(measureCount / options.measuresPerLine)
  const canvasHeight = options.marginY + lineCount * (options.staveHeight * score.parts.length + 40)

  renderer.resize(options.canvasWidth, canvasHeight)
  const ctx = renderer.getContext()
  ctx.clear()

  renderParts(ctx, score.parts, options, selectedNoteId)

  if (cursor?.cursorMeasureId) {
    drawCursor(canvas, score, options, cursor)
  }
}

function renderParts(
  ctx: RenderContext,
  parts: readonly Part[],
  options: RenderOptions,
  selectedNoteId: string | null
): void {
  parts.forEach((part, partIndex) => {
    part.staves.forEach((staff) => {
      renderStaff(ctx, staff, partIndex, parts.length, options, selectedNoteId)
    })
  })
}

function renderStaff(
  ctx: RenderContext,
  staff: Staff,
  partIndex: number,
  totalParts: number,
  options: RenderOptions,
  selectedNoteId: string | null
): void {
  const { measuresPerLine, staveWidth, staveHeight, marginX, marginY } = options
  const rowHeight = staveHeight * totalParts + 40

  staff.measures.forEach((measure, measureIndex) => {
    const lineIndex  = Math.floor(measureIndex / measuresPerLine)
    const colIndex   = measureIndex % measuresPerLine

    const x = marginX + colIndex * staveWidth
    const y = marginY + lineIndex * rowHeight + partIndex * staveHeight

    renderMeasure(ctx, measure, staff.clef, x, y, staveWidth, measureIndex === 0, selectedNoteId)
  })
}

function renderMeasure(
  ctx: RenderContext,
  measure: Measure,
  clefType: string,
  x: number,
  y: number,
  width: number,
  isFirstMeasure: boolean,
  selectedNoteId: string | null
): void {
  const stave = new Stave(x, y, width)

  if (isFirstMeasure) {
    stave.addClef(clefType)
    stave.addTimeSignature('4/4')
  }

  stave.setContext(ctx).draw()

  const voice0 = measure.voices[0]
  if (!voice0 || voice0.events.length === 0) return

  const staveNotes = voice0.events.map(e => noteEventToStaveNote(e, e.id === selectedNoteId))

  const vexVoice = new VexVoice({
    numBeats: 4,
    beatValue: 4
  }).setStrict(false)

  vexVoice.addTickables(staveNotes)

  const beams = Beam.generateBeams(staveNotes)

  new Formatter()
    .joinVoices([vexVoice])
    .format([vexVoice], width - 40)

  vexVoice.draw(ctx, stave)
  beams.forEach(b => b.setContext(ctx).draw())
}

// ── Cursor overlay ────────────────────────────────────────────────────────────

const LINE_SPACING_PX = 10
const STAVE_HEIGHT_PX = 4 * LINE_SPACING_PX  // 40px

function drawCursor(
  canvas: HTMLCanvasElement,
  score: Score,
  options: RenderOptions,
  cursor: RenderCursorOptions
): void {
  const layouts = computeLayout(score, options)
  const layout = layouts.find(l => l.measureId === cursor.cursorMeasureId)
  if (!layout) return

  const noteAreaStart = layout.x + 20
  const noteAreaWidth = layout.width - 40
  const fraction = cursor.totalCapacityUnits > 0
    ? cursor.cursorBeatPosition / cursor.totalCapacityUnits
    : 0
  const cursorX = noteAreaStart + fraction * noteAreaWidth

  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) return

  ctx2d.save()
  ctx2d.strokeStyle = '#2196F3'
  ctx2d.lineWidth = 2
  ctx2d.globalAlpha = 0.85
  ctx2d.beginPath()
  ctx2d.moveTo(cursorX, layout.staveTopY - 6)
  ctx2d.lineTo(cursorX, layout.staveTopY + STAVE_HEIGHT_PX + 6)
  ctx2d.stroke()
  ctx2d.restore()
}
