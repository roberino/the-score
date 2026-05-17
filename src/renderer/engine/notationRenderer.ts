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
  Dot,
  Fraction,
  Accidental as VexAccidental,
  BarlineType,
  type RenderContext
} from 'vexflow'

import type { Score, Part, Staff, Measure, NoteEvent, Note, Rest, Chord, Duration, ClefType, TimeSignature, KeySignature } from '@shared/score'
import { resolveTimeSig, timeSigsEqual, resolveKeySig, resolveClef, transposeKeyFifths, measureCapacityUnits } from '@shared/musicUtils'

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

// ── Key signature mapping: fifths count → VexFlow key name ───────────────────

const FIFTHS_TO_VEX_KEY: Partial<Record<number, string>> = {
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
  [-1]: 'F', [-2]: 'Bb', [-3]: 'Eb', [-4]: 'Ab', [-5]: 'Db', [-6]: 'Gb', [-7]: 'Cb',
}

// ── Barline mapping: our model → VexFlow BarlineType ─────────────────────────

const END_BARLINE_MAP: Record<string, number> = {
  single:        BarlineType.SINGLE,
  double:        BarlineType.DOUBLE,
  final:         BarlineType.END,
  'repeat-end':  BarlineType.REPEAT_END,
}

// ── Pitch → VexFlow key string ────────────────────────────────────────────────

function pitchToVexKey(pitch: { noteName: string; octave: number; accidental: string | null }): string {
  return `${pitch.noteName.toLowerCase()}/${pitch.octave}`
}

// Middle-line pitch for each clef — used as the VexFlow rest anchor key so that
// rest glyphs are centred on the staff regardless of clef.
const CLEF_REST_KEY: Record<string, string> = {
  treble:     'b/4',  // B4  = 3rd (middle) line of treble staff
  bass:       'd/3',  // D3  = 3rd (middle) line of bass staff
  alto:       'c/4',  // C4  = 3rd (middle) line of alto staff
  tenor:      'e/4',  // E4  = 3rd (middle) line of tenor staff
  percussion: 'b/4',  // treble fallback for unpitched percussion
}

// ── Convert a NoteEvent to a VexFlow StaveNote ────────────────────────────────

function noteEventToStaveNote(event: NoteEvent, selected: boolean, clef: string): StaveNote {
  switch (event.type) {
    case 'note': {
      const n = event as Note
      const staveNote = new StaveNote({
        clef,
        keys: [pitchToVexKey(n.pitch)],
        duration: DURATION_MAP[n.duration] + (n.dots > 0 ? 'd'.repeat(n.dots) : '')
      })
      if (n.dots > 0) Dot.buildAndAttach([staveNote], { all: true })
      if (n.pitch.accidental) {
        const acc = n.pitch.accidental === 'sharp'       ? '#'
          : n.pitch.accidental === 'flat'        ? 'b'
          : n.pitch.accidental === 'natural'     ? 'n'
          : n.pitch.accidental === 'doubleSharp' ? '##'
          : 'bb'
        staveNote.addModifier(new VexAccidental(acc), 0)
      }
      if (selected) staveNote.setStyle({ fillStyle: '#3b9ddd', strokeStyle: '#3b9ddd' })
      return staveNote
    }
    case 'rest': {
      const r = event as Rest
      const staveNote = new StaveNote({
        clef,
        keys: [CLEF_REST_KEY[clef] ?? 'b/4'],
        duration: DURATION_MAP[r.duration] + (r.dots > 0 ? 'd'.repeat(r.dots) : '') + 'r'
      })
      if (r.dots > 0) Dot.buildAndAttach([staveNote], { all: true })
      if (selected) staveNote.setStyle({ fillStyle: '#3b9ddd', strokeStyle: '#3b9ddd' })
      return staveNote
    }
    case 'chord': {
      const c = event as Chord
      const staveNote = new StaveNote({
        clef,
        keys: c.pitches.map(pitchToVexKey),
        duration: DURATION_MAP[c.duration] + (c.dots > 0 ? 'd'.repeat(c.dots) : '')
      })
      if (c.dots > 0) Dot.buildAndAttach([staveNote], { all: true })
      return staveNote
    }
  }
}

// ── Render options ────────────────────────────────────────────────────────────

export interface RenderOptions {
  canvasWidth: number
  measuresPerLine: number   // maximum measures per line (hard cap)
  staveWidth: number        // fallback / minimum stave width
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

export const LABEL_MARGIN_X = 140  // marginX when part labels are shown

// ── Width calculation constants ───────────────────────────────────────────────

const PX_PER_64TH_UNIT  = 3.2   // px per 64th-note unit (drives duration-based width)
const MIN_PX_PER_NOTE   = 22    // minimum px per note head
const MIN_NOTE_AREA     = 80    // minimum note area for any measure
const RIGHT_PADDING     = 24    // right margin inside stave
const PREAMBLE_CLEF     = 30
const PREAMBLE_TIME     = 30
const PREAMBLE_KEY_PER  = 12    // px per accidental in key sig
const PREAMBLE_BASE     = 14    // left bar + small gap
const MIN_STAVE_WIDTH   = 140

function computeMeasureWidth(
  events: readonly NoteEvent[],
  effectiveSig: TimeSignature,
  showClef: boolean,
  showKeySig: boolean,
  showTimeSig: boolean,
  keySig: KeySignature,
): number {
  let preamble = PREAMBLE_BASE
  if (showClef)    preamble += PREAMBLE_CLEF
  if (showKeySig)  preamble += Math.max(Math.abs(keySig.fifths), 1) * PREAMBLE_KEY_PER
  if (showTimeSig) preamble += PREAMBLE_TIME

  const capacity  = measureCapacityUnits(effectiveSig)
  const noteArea  = Math.max(
    capacity * PX_PER_64TH_UNIT,
    events.length * MIN_PX_PER_NOTE,
    MIN_NOTE_AREA
  )

  return Math.max(preamble + noteArea + RIGHT_PADDING, MIN_STAVE_WIDTH)
}

// ── Layout ────────────────────────────────────────────────────────────────────

export interface MeasureLayout {
  measureId: string
  partId: string
  staffId: string
  voiceId: string
  clef: ClefType
  transposeSemitones: number
  x: number
  staveTopY: number   // y of the actual top staff LINE
  staveY: number      // raw y passed to new Stave()
  width: number
  measureIndex: number
  isLineStart: boolean
  showClef: boolean   // true when a clef symbol is rendered for this measure
}

// VexFlow 5 default: spaceAboveStaffLn = 4, spacingBetweenLinesPx = 10
const VEXFLOW_HEADROOM_PX = 40

export function computeLayout(score: Score, options: RenderOptions): MeasureLayout[] {
  const layouts: MeasureLayout[] = []
  const { canvasWidth, staveHeight, marginX, marginY, measuresPerLine } = options
  const totalParts = score.parts.length
  const rowHeight  = staveHeight * totalParts + 40
  const maxLineX   = canvasWidth - marginX   // rightmost allowed x + width

  const firstPart  = score.parts[0]
  if (!firstPart) return layouts
  const firstStaff = firstPart.staves[0]
  if (!firstStaff) return layouts
  const measureCount = firstStaff.measures.length

  let lineIndex           = 0
  let currentX            = marginX
  let measuresInLine      = 0

  for (let mIdx = 0; mIdx < measureCount; mIdx++) {
    const measure      = firstStaff.measures[mIdx]
    const effectiveSig  = resolveTimeSig(firstStaff.measures, mIdx, score.timeSignature)
    const effectiveKey  = resolveKeySig(firstStaff.measures, mIdx, score.keySignature)
    const effectiveClef = resolveClef(firstStaff.measures, mIdx, firstStaff.clef)
    const prevKey       = mIdx > 0 ? resolveKeySig(firstStaff.measures, mIdx - 1, score.keySignature) : null
    const prevSig       = mIdx > 0 ? resolveTimeSig(firstStaff.measures, mIdx - 1, score.timeSignature) : null
    const prevClef      = mIdx > 0 ? resolveClef(firstStaff.measures, mIdx - 1, firstStaff.clef) : null
    const events        = measure.voices[0]?.events ?? []

    const keyChanged  = prevKey  !== null && prevKey.fifths !== effectiveKey.fifths
    const sigChanged  = prevSig  !== null && !timeSigsEqual(effectiveSig, prevSig)
    const clefChanged = prevClef !== null && prevClef !== effectiveClef

    // Width if NOT a line start (no repeat clef/key/time unless first measure or changed)
    const showClef_mid    = clefChanged
    const showKeySig_mid  = keyChanged
    const showTimeSig_mid = sigChanged
    const width_mid = computeMeasureWidth(events, effectiveSig, showClef_mid, showKeySig_mid, showTimeSig_mid, effectiveKey)

    // Width if IS a line start (clef always; key if non-C; time if differs from score default)
    const showClef_start    = true
    const showKeySig_start  = effectiveKey.fifths !== 0
    const showTimeSig_start = !timeSigsEqual(effectiveSig, score.timeSignature) || mIdx === 0
    const width_start = computeMeasureWidth(events, effectiveSig, showClef_start, showKeySig_start, showTimeSig_start, effectiveKey)

    let isLineStart: boolean
    let width: number

    if (mIdx === 0) {
      // First measure is always a line start
      isLineStart = true
      width       = width_start
      currentX    = marginX
    } else {
      const wouldExceed = currentX + width_mid > maxLineX
      const hitCap      = measuresInLine >= measuresPerLine
      if (wouldExceed || hitCap) {
        // Wrap to new line
        lineIndex++
        currentX    = marginX
        measuresInLine = 0
        isLineStart = true
        width       = width_start
      } else {
        isLineStart = false
        width       = width_mid
      }
    }

    const x      = currentX
    const yBase  = marginY + lineIndex * rowHeight

    score.parts.forEach((part, partIndex) => {
      part.staves.forEach((staff) => {
        const staffMeasure = staff.measures[mIdx]
        if (!staffMeasure) return
        const staffClef     = resolveClef(staff.measures, mIdx, staff.clef)
        const prevStaffClef = mIdx > 0 ? resolveClef(staff.measures, mIdx - 1, staff.clef) : null
        const staffClefChanged = prevStaffClef !== null && prevStaffClef !== staffClef
        const y = yBase + partIndex * staveHeight
        layouts.push({
          measureId:          staffMeasure.id,
          partId:             part.id,
          staffId:            staff.id,
          voiceId:            staffMeasure.voices[0]?.id ?? '',
          clef:               staffClef,
          transposeSemitones: part.transposeSemitones,
          x,
          staveTopY:          y + VEXFLOW_HEADROOM_PX,
          staveY:             y,
          width,
          measureIndex:       mIdx,
          isLineStart,
          showClef:           isLineStart || staffClefChanged,
        })
      })
    })

    currentX += width
    measuresInLine++
  }

  return layouts
}

// ── Main render function ──────────────────────────────────────────────────────

export interface RenderCursorOptions {
  cursorMeasureId: string | null
  cursorBeatPosition: number
  totalCapacityUnits: number
}

export function renderScore(
  canvas: HTMLCanvasElement,
  score: Score,
  options: RenderOptions = DEFAULT_RENDER_OPTIONS,
  selectedNoteId: string | null = null,
  cursor: RenderCursorOptions | null = null
): Map<string, number> {
  const notePositions = new Map<string, number>()
  const renderer = new VexRenderer(canvas, VexRenderer.Backends.CANVAS)

  const firstPart = score.parts[0]
  if (!firstPart) return notePositions
  const firstStaff = firstPart.staves[0]
  if (!firstStaff) return notePositions

  const layouts = computeLayout(score, options)

  // Canvas height: bottom of last stave row + margin
  const lastLayout   = layouts[layouts.length - 1]
  const canvasHeight = lastLayout
    ? lastLayout.staveY + options.staveHeight + options.marginY
    : options.marginY + options.staveHeight

  renderer.resize(options.canvasWidth, canvasHeight)
  const ctx = renderer.getContext()
  ctx.clear()

  renderFromLayouts(ctx, score, layouts, selectedNoteId, notePositions)

  if (cursor?.cursorMeasureId) {
    drawCursor(canvas, cursor, layouts)
  }

  return notePositions
}

// ── Render all measures from precomputed layouts ──────────────────────────────

function renderFromLayouts(
  ctx: RenderContext,
  score: Score,
  layouts: MeasureLayout[],
  selectedNoteId: string | null,
  notePositions: Map<string, number>
): void {
  // Build fast lookup: staffId → staff / part
  type StaffEntry = { staff: Staff; part: Part }
  const staffMap = new Map<string, StaffEntry>()
  for (const part of score.parts) {
    for (const staff of part.staves) {
      staffMap.set(staff.id, { staff, part })
    }
  }

  for (const layout of layouts) {
    const entry = staffMap.get(layout.staffId)
    if (!entry) continue
    const { staff, part } = entry

    const mIdx   = staff.measures.findIndex(m => m.id === layout.measureId)
    if (mIdx === -1) continue
    const measure     = staff.measures[mIdx]
    const prevMeasure = staff.measures[mIdx - 1]

    const effectiveKey = resolveKeySig(staff.measures, mIdx, score.keySignature)
    const prevKey      = mIdx > 0 ? resolveKeySig(staff.measures, mIdx - 1, score.keySignature) : null
    const effectiveSig = resolveTimeSig(staff.measures, mIdx, score.timeSignature)
    const prevSig      = mIdx > 0 ? resolveTimeSig(staff.measures, mIdx - 1, score.timeSignature) : null

    renderMeasure(
      ctx, measure, prevMeasure,
      effectiveKey, prevKey,
      effectiveSig, prevSig, score.timeSignature,
      layout.clef, layout.transposeSemitones,
      layout.x, layout.staveY, layout.width,
      layout.measureIndex, layout.isLineStart, layout.showClef,
      selectedNoteId, notePositions
    )

    // Part labels: right-aligned against the stave's left edge at system starts
    if (layout.isLineStart && score.showPartLabels && part.labelVisible) {
      const label = layout.measureIndex === 0 ? part.name : part.shortName
      const nativeCtx: CanvasRenderingContext2D | null =
        typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null
      if (nativeCtx) {
        nativeCtx.save()
        nativeCtx.font = layout.measureIndex === 0 ? '13px sans-serif' : '11px sans-serif'
        nativeCtx.fillStyle = '#222'
        nativeCtx.textAlign = 'right'
        nativeCtx.fillText(label, layout.x - 8, layout.staveTopY + 20)
        nativeCtx.restore()
      }
    }
  }
}

// ── Beam groups by time signature ────────────────────────────────────────────
// Returns explicit beat groups for compound/asymmetric meters.
// Simple meters (denominator ≤ 4) return null → VexFlow default (pairs per beat).

function getBeamGroups(timeSig: TimeSignature): Fraction[] | null {
  const { numerator, denominator } = timeSig
  if (denominator <= 4) return null          // simple: 2/4, 3/4, 4/4, etc.
  if (denominator === 8) {
    if (numerator % 3 === 0) {              // compound: 6/8, 9/8, 12/8
      return Array.from({ length: numerator / 3 }, () => new Fraction(3, 8))
    }
    if (numerator === 5) return [new Fraction(2, 8), new Fraction(3, 8)]
    if (numerator === 7) return [new Fraction(2, 8), new Fraction(2, 8), new Fraction(3, 8)]
  }
  return null
}

// ── Render a single measure ───────────────────────────────────────────────────

function renderMeasure(
  ctx: RenderContext,
  measure: Measure,
  prevMeasure: Measure | undefined,
  effectiveKey: KeySignature,
  prevKey: KeySignature | null,
  effectiveSig: TimeSignature,
  prevSig: TimeSignature | null,
  scoreTimeSig: TimeSignature,
  clefType: string,
  transposeSemitones: number,
  x: number,
  y: number,
  width: number,
  measureIndex: number,
  isLineStart: boolean,
  showClef: boolean,
  selectedNoteId: string | null,
  notePositions: Map<string, number>
): void {
  const stave = new Stave(x, y, width)

  const keyChanged  = prevKey !== null && prevKey.fifths !== effectiveKey.fifths
  const sigChanged  = prevSig !== null && !timeSigsEqual(effectiveSig, prevSig)

  // Written key for this part (transposed from concert key)
  const writtenFifths = transposeKeyFifths(effectiveKey.fifths, transposeSemitones)

  // Clef: full size at system starts, small size for mid-score changes
  if (showClef) {
    if (isLineStart) {
      stave.addClef(clefType)
    } else {
      stave.addClef(clefType, 'small')
    }
  }

  // Key sig: show at system starts (if non-C in written key) and when concert key changes
  const showKeySig = (isLineStart && writtenFifths !== 0) || keyChanged
  if (showKeySig) stave.addKeySignature(FIFTHS_TO_VEX_KEY[writtenFifths] ?? 'C')

  // Time sig: show on first measure, when it changes, or when repeated at system start
  const showTimeSig = (isLineStart && measureIndex === 0)
    || sigChanged
    || (isLineStart && !timeSigsEqual(effectiveSig, scoreTimeSig))
  if (showTimeSig) stave.addTimeSignature(`${effectiveSig.numerator}/${effectiveSig.denominator}`)

  // End barline type
  if (measure.barline && measure.barline !== 'repeat-start') {
    stave.setEndBarType(END_BARLINE_MAP[measure.barline] ?? BarlineType.SINGLE)
  }

  // Repeat-begin on left edge when previous bar has repeat-start
  if (prevMeasure?.barline === 'repeat-start') {
    stave.setBegBarType(BarlineType.REPEAT_BEGIN)
  }

  stave.setContext(ctx).draw()

  // Exact note area after VexFlow has placed clef/key/time preamble
  const noteAreaWidth = stave.getNoteEndX() - stave.getNoteStartX()

  // Bar numbers at system starts (not the first measure)
  if (measureIndex > 0 && isLineStart) {
    const nativeCtx: CanvasRenderingContext2D | null =
      typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null
    if (nativeCtx) {
      nativeCtx.save()
      nativeCtx.font = '11px sans-serif'
      nativeCtx.fillStyle = '#555'
      nativeCtx.fillText(String(measureIndex + 1), x + 2, y + VEXFLOW_HEADROOM_PX - 4)
      nativeCtx.restore()
    }
  }

  const voice0 = measure.voices[0]
  const events = voice0?.events ?? []

  if (events.length === 0) {
    const wholeRest = new StaveNote({ clef: clefType, keys: [CLEF_REST_KEY[clefType] ?? 'b/4'], duration: 'wr' })
    const vexVoice  = new VexVoice({
      numBeats: effectiveSig.numerator,
      beatValue: effectiveSig.denominator,
    }).setStrict(false)
    vexVoice.addTickables([wholeRest])
    new Formatter().joinVoices([vexVoice]).format([vexVoice], noteAreaWidth)
    vexVoice.draw(ctx, stave)
    return
  }

  const staveNotes = events.map(e => noteEventToStaveNote(e, e.id === selectedNoteId, clefType))
  const vexVoice   = new VexVoice({
    numBeats: effectiveSig.numerator,
    beatValue: effectiveSig.denominator,
  }).setStrict(false)
  vexVoice.addTickables(staveNotes)
  const beamGroups = getBeamGroups(effectiveSig)
  const beams = beamGroups
    ? Beam.generateBeams(staveNotes, { groups: beamGroups })
    : Beam.generateBeams(staveNotes)
  new Formatter().joinVoices([vexVoice]).format([vexVoice], noteAreaWidth)
  // Collect absolute x of each note head after formatting (stave already drawn,
  // so getNoteStartX() is accurate). setStave() is called again internally by draw().
  staveNotes.forEach((sn, i) => {
    sn.setStave(stave)
    notePositions.set(events[i].id, sn.getAbsoluteX())
  })
  vexVoice.draw(ctx, stave)
  beams.forEach(b => b.setContext(ctx).draw())
}

// ── Cursor overlay ────────────────────────────────────────────────────────────

const LINE_SPACING_PX  = 10
const STAVE_HEIGHT_PX  = 4 * LINE_SPACING_PX

function drawCursor(
  canvas: HTMLCanvasElement,
  cursor: RenderCursorOptions,
  layouts: MeasureLayout[]
): void {
  const layout = layouts.find(l => l.measureId === cursor.cursorMeasureId)
  if (!layout) return

  const noteAreaStart = layout.x + 20
  const noteAreaWidth = layout.width - 40
  const fraction      = cursor.totalCapacityUnits > 0
    ? cursor.cursorBeatPosition / cursor.totalCapacityUnits
    : 0
  const cursorX = noteAreaStart + fraction * noteAreaWidth

  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) return

  ctx2d.save()
  ctx2d.strokeStyle  = '#2196F3'
  ctx2d.lineWidth    = 2
  ctx2d.globalAlpha  = 0.85
  ctx2d.beginPath()
  ctx2d.moveTo(cursorX, layout.staveTopY - 6)
  ctx2d.lineTo(cursorX, layout.staveTopY + STAVE_HEIGHT_PX + 6)
  ctx2d.stroke()
  ctx2d.restore()
}
