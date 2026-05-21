// ─────────────────────────────────────────────────────────────────────────────
// Notation renderer
//
// Translates the Score model → VexFlow stave objects → HTML5 Canvas.
// This is the core rendering pipeline. Keep it pure (no React, no store).
// ─────────────────────────────────────────────────────────────────────────────

import {
  Renderer as VexRenderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Voice as VexVoice,
  Formatter,
  Beam,
  Dot,
  Fraction,
  Accidental as VexAccidental,
  Articulation as VexArticulation,
  Ornament,
  Tuplet as VexTuplet,
  VoltaType,
  BarlineType,
  type RenderContext
} from 'vexflow'

import type { Score, Part, Staff, Measure, NoteEvent, Note, Rest, Chord, Duration, ClefType, TimeSignature, KeySignature, Articulation, GroupSymbol, TupletInfo, DynamicLevel, Volta } from '@shared/score'
import { resolveTimeSig, timeSigsEqual, resolveKeySig, resolveClef, transposeKeyFifths, measureCapacityUnits, resolveDirectiveTempo } from '@shared/musicUtils'

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

export const HEADING_MARGIN_Y = 100   // canvas top reserved for the heading block

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

const ARTICULATION_CODE: Partial<Record<Articulation, string>> = {
  staccato: 'a.',
  accent:   'a>',
  tenuto:   'a-',
  marcato:  'a^',
  fermata:  'a@a',
}
const ORNAMENT_CODE: Partial<Record<Articulation, string>> = {
  trill:           'tr',
  mordent:         'mordent',
  'mordent-upper': 'mordentInverted',
  turn:            'turn',
}

function attachArticulations(staveNote: StaveNote, articulations: readonly Articulation[]): void {
  for (const art of articulations) {
    const ac = ARTICULATION_CODE[art]
    if (ac) { staveNote.addModifier(new VexArticulation(ac)); continue }
    const oc = ORNAMENT_CODE[art]
    if (oc) staveNote.addModifier(new Ornament(oc))
  }
}

function noteEventToStaveNote(
  event: NoteEvent,
  selected: boolean,
  clef: string,
  stemDirection?: number,
  noteColor?: string,
): StaveNote {
  const stemOpts = stemDirection !== undefined ? { stem_direction: stemDirection } : {}
  const applyColor = (sn: StaveNote) => {
    if (selected)        sn.setStyle({ fillStyle: '#3b9ddd', strokeStyle: '#3b9ddd' })
    else if (noteColor)  sn.setStyle({ fillStyle: noteColor, strokeStyle: noteColor })
  }
  switch (event.type) {
    case 'note': {
      const n = event as Note
      const staveNote = new StaveNote({
        clef,
        keys: [pitchToVexKey(n.pitch)],
        duration: DURATION_MAP[n.duration] + (n.dots > 0 ? 'd'.repeat(n.dots) : ''),
        ...stemOpts,
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
      if (n.articulations.length > 0) attachArticulations(staveNote, n.articulations)
      applyColor(staveNote)
      return staveNote
    }
    case 'rest': {
      const r = event as Rest
      const staveNote = new StaveNote({
        clef,
        keys: [CLEF_REST_KEY[clef] ?? 'b/4'],
        duration: DURATION_MAP[r.duration] + (r.dots > 0 ? 'd'.repeat(r.dots) : '') + 'r',
        ...stemOpts,
      })
      if (r.dots > 0) Dot.buildAndAttach([staveNote], { all: true })
      applyColor(staveNote)
      return staveNote
    }
    case 'chord': {
      const c = event as Chord
      const staveNote = new StaveNote({
        clef,
        keys: c.pitches.map(pitchToVexKey),
        duration: DURATION_MAP[c.duration] + (c.dots > 0 ? 'd'.repeat(c.dots) : ''),
        ...stemOpts,
      })
      if (c.dots > 0) Dot.buildAndAttach([staveNote], { all: true })
      if (c.articulations.length > 0) attachArticulations(staveNote, c.articulations)
      applyColor(staveNote)
      return staveNote
    }
  }
}

// ── Render options ────────────────────────────────────────────────────────────

export interface RenderOptions {
  canvasWidth: number
  measuresPerLine: number   // hard cap on measures per line (safety valve)
  staveWidth: number        // fallback / minimum stave width
  staveHeight: number
  marginX: number           // left margin (wider when part labels are shown)
  marginRight: number       // right margin (always ~2 cm)
  marginY: number
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  canvasWidth: 1200,
  measuresPerLine: 8,
  staveWidth: 260,
  staveHeight: 120,
  marginX: 75,
  marginRight: 75,
  marginY: HEADING_MARGIN_Y,
}

export const LABEL_MARGIN_X = 140   // marginX when part labels are shown

// ── Heading layout ─────────────────────────────────────────────────────────────
// Click-target rectangles for each heading field (canvas CSS-pixel coordinates).
// Drawn text baselines match these zones so the overlay input aligns correctly.

export interface HeadingFieldBound {
  field: 'title' | 'subtitle' | 'composer' | 'arranger'
  x: number
  y: number
  width: number
  height: number
  font: string              // CSS canvas font string used for both drawing and the overlay input
  textAlign: 'center' | 'right'
}

export function headingFieldBounds(canvasWidth: number, marginX: number): HeadingFieldBound[] {
  const inner = canvasWidth - 2 * marginX
  const mid   = marginX + inner * 0.6   // right 40%: composer + arranger
  const rightW = canvasWidth - mid - marginX
  // Composer/arranger are checked BEFORE subtitle so right-side clicks
  // open the correct editor (subtitle's zone spans the full inner width).
  return [
    { field: 'title',    x: marginX, y: 6,  width: inner,  height: 36, font: 'bold 22px serif',    textAlign: 'center' },
    { field: 'composer', x: mid,     y: 44, width: rightW, height: 22, font: 'italic 12px serif',  textAlign: 'right'  },
    { field: 'subtitle', x: marginX, y: 44, width: inner,  height: 22, font: '13px serif',         textAlign: 'center' },
    { field: 'arranger', x: mid,     y: 66, width: rightW, height: 22, font: '11px serif',         textAlign: 'right'  },
  ]
}

// ── Draw heading block ────────────────────────────────────────────────────────

function drawHeadings(ctx: RenderContext, score: Score, options: RenderOptions): void {
  const nativeCtx: CanvasRenderingContext2D | null =
    typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null
  if (!nativeCtx) return

  const { canvasWidth, marginX } = options
  const cx   = canvasWidth / 2
  const rEdge = canvasWidth - marginX

  const meta = score.metadata
  // Fall back gracefully for scores saved before subtitle/arranger existed
  const title    = meta.title    || ''
  const subtitle = (meta as any).subtitle || ''
  const composer = meta.composer || ''
  const arranger = (meta as any).arranger || ''

  nativeCtx.save()

  // Title
  nativeCtx.textAlign = 'center'
  if (title) {
    nativeCtx.font      = 'bold 22px serif'
    nativeCtx.fillStyle = '#111'
    nativeCtx.fillText(title, cx, 34)
  } else {
    nativeCtx.font      = '13px sans-serif'
    nativeCtx.fillStyle = '#ccc'
    nativeCtx.fillText('Click to add title', cx, 34)
  }

  // Subtitle (centered on full canvas, same axis as title)
  nativeCtx.textAlign = 'center'
  if (subtitle) {
    nativeCtx.font      = '13px serif'
    nativeCtx.fillStyle = '#333'
    nativeCtx.fillText(subtitle, cx, 60)
  } else {
    nativeCtx.font      = '11px sans-serif'
    nativeCtx.fillStyle = '#ddd'
    nativeCtx.fillText('subtitle', cx, 60)
  }

  // Composer (right-aligned)
  nativeCtx.textAlign = 'right'
  if (composer) {
    nativeCtx.font      = 'italic 12px serif'
    nativeCtx.fillStyle = '#333'
    nativeCtx.fillText(composer, rEdge, 60)
  } else {
    nativeCtx.font      = '11px sans-serif'
    nativeCtx.fillStyle = '#ddd'
    nativeCtx.fillText('composer', rEdge, 60)
  }

  // Arranger (right-aligned)
  if (arranger) {
    nativeCtx.font      = '11px serif'
    nativeCtx.fillStyle = '#333'
    nativeCtx.fillText(arranger, rEdge, 78)
  } else {
    nativeCtx.font      = '11px sans-serif'
    nativeCtx.fillStyle = '#ddd'
    nativeCtx.fillText('arranger', rEdge, 78)
  }

  nativeCtx.restore()
}

// ── Flag right-clearance ──────────────────────────────────────────────────────
// Flags on short notes extend to the right of the stem tip. VexFlow's formatter
// does not account for this when distributing notes across the note area, so the
// last note's flags can bleed into (or past) the end barline. We reduce the
// formatter width by the flag extent of the shortest note in the measure.

function flagRightClearance(events: readonly NoteEvent[]): number {
  for (const ev of events) {
    if (ev.duration === '64th')  return 20  // 4 flags
    if (ev.duration === '32nd')  return 16  // 3 flags
    if (ev.duration === '16th')  return 12  // 2 flags
  }
  return 0
}

// ── Width calculation constants ───────────────────────────────────────────────

const PX_PER_64TH_UNIT  = 3.2   // px per 64th-note unit (drives duration-based width)
const MIN_PX_PER_NOTE   = 24    // minimum px per note head (extra room for accidentals/beams)
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
  ) + flagRightClearance(events)

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
  const marginRight = options.marginRight ?? marginX
  const totalParts  = score.parts.length
  const rowHeight   = staveHeight * totalParts + 40
  const lineWidth   = canvasWidth - marginX - marginRight   // usable px per line

  const firstPart  = score.parts[0]
  if (!firstPart) return layouts
  const firstStaff = firstPart.staves[0]
  if (!firstStaff) return layouts
  const measureCount = firstStaff.measures.length

  // ── Phase 1: determine natural widths and assign each measure to a line ─────

  interface MeasureInfo {
    mIdx:         number
    naturalWidth: number
    isLineStart:  boolean
    lineIndex:    number
    showClefMap:  Map<string, boolean>   // staffId → showClef
  }

  const infos: MeasureInfo[] = []
  let lineIndex      = 0
  let lineUsed       = 0
  let measuresInLine = 0

  for (let mIdx = 0; mIdx < measureCount; mIdx++) {
    const effectiveSig  = resolveTimeSig(firstStaff.measures, mIdx, score.timeSignature)
    const effectiveKey  = resolveKeySig(firstStaff.measures, mIdx, score.keySignature)
    const effectiveClef = resolveClef(firstStaff.measures, mIdx, firstStaff.clef)
    const prevKey       = mIdx > 0 ? resolveKeySig(firstStaff.measures, mIdx - 1, score.keySignature) : null
    const prevSig       = mIdx > 0 ? resolveTimeSig(firstStaff.measures, mIdx - 1, score.timeSignature) : null
    const prevClef      = mIdx > 0 ? resolveClef(firstStaff.measures, mIdx - 1, firstStaff.clef) : null
    const keyChanged  = prevKey  !== null && prevKey.fifths !== effectiveKey.fifths
    const sigChanged  = prevSig  !== null && !timeSigsEqual(effectiveSig, prevSig)
    const clefChanged = prevClef !== null && prevClef !== effectiveClef

    const showClef_mid    = clefChanged
    const showKeySig_mid  = keyChanged
    const showTimeSig_mid = sigChanged
    const showClef_start    = true
    const showKeySig_start  = effectiveKey.fifths !== 0
    const showTimeSig_start = !timeSigsEqual(effectiveSig, score.timeSignature) || mIdx === 0

    let width_mid   = MIN_STAVE_WIDTH
    let width_start = MIN_STAVE_WIDTH
    for (const part of score.parts) {
      const pEvents = part.staves[0]?.measures[mIdx]?.voices[0]?.events ?? []
      width_mid   = Math.max(width_mid,   computeMeasureWidth(pEvents, effectiveSig, showClef_mid,   showKeySig_mid,   showTimeSig_mid,   effectiveKey))
      width_start = Math.max(width_start, computeMeasureWidth(pEvents, effectiveSig, showClef_start, showKeySig_start, showTimeSig_start, effectiveKey))
    }

    let isLineStart: boolean
    let naturalWidth: number

    if (mIdx === 0) {
      isLineStart  = true
      naturalWidth = width_start
      lineUsed     = 0
    } else {
      const wouldExceed = lineUsed + width_mid > lineWidth
      const hitCap      = measuresInLine >= measuresPerLine
      if (wouldExceed || hitCap) {
        lineIndex++
        lineUsed       = 0
        measuresInLine = 0
        isLineStart    = true
        naturalWidth   = width_start
      } else {
        isLineStart  = false
        naturalWidth = width_mid
      }
    }

    const showClefMap = new Map<string, boolean>()
    for (const part of score.parts) {
      const staff = part.staves[0]
      if (!staff) continue
      const staffClef        = resolveClef(staff.measures, mIdx, staff.clef)
      const prevStaffClef    = mIdx > 0 ? resolveClef(staff.measures, mIdx - 1, staff.clef) : null
      const staffClefChanged = prevStaffClef !== null && prevStaffClef !== staffClef
      showClefMap.set(staff.id, isLineStart || staffClefChanged)
    }

    infos.push({ mIdx, naturalWidth, isLineStart, lineIndex, showClefMap })
    lineUsed += naturalWidth
    measuresInLine++
  }

  const totalLines = lineIndex + 1

  // ── Phase 2: justify all non-last lines to fill lineWidth exactly ──────────

  const byLine = new Map<number, MeasureInfo[]>()
  for (const m of infos) {
    if (!byLine.has(m.lineIndex)) byLine.set(m.lineIndex, [])
    byLine.get(m.lineIndex)!.push(m)
  }

  const finalWidth = new Map<number, number>()   // mIdx → justified width

  for (const [li, group] of byLine.entries()) {
    const isLastLine   = li === totalLines - 1
    const totalNatural = group.reduce((s, m) => s + m.naturalWidth, 0)

    if (!isLastLine && group.length >= 2 && totalNatural < lineWidth) {
      // Distribute remaining space proportionally; give rounding remainder to last measure
      let used = 0
      for (let i = 0; i < group.length - 1; i++) {
        const w = Math.floor(group[i].naturalWidth * lineWidth / totalNatural)
        finalWidth.set(group[i].mIdx, w)
        used += w
      }
      finalWidth.set(group[group.length - 1].mIdx, lineWidth - used)
    } else {
      for (const m of group) finalWidth.set(m.mIdx, m.naturalWidth)
    }
  }

  // ── Phase 3: build MeasureLayout[] with justified widths ──────────────────

  const lineX = new Map<number, number>()

  for (const m of infos) {
    const width = finalWidth.get(m.mIdx) ?? m.naturalWidth
    const x     = lineX.get(m.lineIndex) ?? marginX
    const yBase = marginY + m.lineIndex * rowHeight

    score.parts.forEach((part, partIndex) => {
      part.staves.forEach((staff) => {
        const staffMeasure = staff.measures[m.mIdx]
        if (!staffMeasure) return
        const staffClef = resolveClef(staff.measures, m.mIdx, staff.clef)
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
          measureIndex:       m.mIdx,
          isLineStart:        m.isLineStart,
          showClef:           m.showClefMap.get(staff.id) ?? m.isLineStart,
        })
      })
    })

    lineX.set(m.lineIndex, x + width)
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
  selectedNoteIds: ReadonlySet<string> = new Set(),
  cursor: RenderCursorOptions | null = null,
  selectedMeasureId: string | null = null,
  lyricCursorNoteId: string | null = null
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

  renderFromLayouts(ctx, score, layouts, selectedNoteIds, notePositions)
  drawHeadings(ctx, score, options)

  const nativeCtx = canvas.getContext('2d')
  if (nativeCtx) drawAllLyrics(nativeCtx, score, notePositions, layouts, lyricCursorNoteId)

  if (selectedMeasureId) {
    drawMeasureHighlight(canvas, selectedMeasureId, layouts)
  }

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
  selectedNoteIds: ReadonlySet<string>,
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

  // Maps for second-pass tie/slur rendering
  const staveNoteMap   = new Map<string, StaveNote>()   // eventId → StaveNote
  const eventStaveMap  = new Map<string, Stave>()        // eventId → Stave

  // Maps for group connector rendering: "partId:mIdx" → top/bottom stave of that part
  const partStaveTop    = new Map<string, Stave>()   // first (topmost) stave per part per measure
  const partStaveBottom = new Map<string, Stave>()   // last (bottommost) stave per part per measure
  // Track which mIdx values are line starts
  const mIdxIsLineStart = new Map<number, boolean>()

  // Whether any group connector will be drawn (bracket or brace spanning 2+ parts).
  // The bracket glyph extends ~17px left of stave.getX(), so labels need extra clearance.
  const hasGroupConnector = (() => {
    const counts = new Map<string, number>()
    for (const part of score.parts) {
      if (part.groupId) counts.set(part.groupId, (counts.get(part.groupId) ?? 0) + 1)
    }
    for (const n of counts.values()) if (n >= 2) return true
    return false
  })()

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

    // Volta bracket for this measure (first part only — one bracket per system)
    const voltaOpts = (part === score.parts[0])
      ? resolveVoltaOpts(layout.measureIndex, score.voltas ?? [])
      : undefined

    const { stave, staveNotes, events } = renderMeasure(
      ctx, measure, prevMeasure,
      effectiveKey, prevKey,
      effectiveSig, prevSig, score.timeSignature,
      layout.clef, layout.transposeSemitones,
      layout.x, layout.staveY, layout.width,
      layout.measureIndex, layout.isLineStart, layout.showClef,
      selectedNoteIds, notePositions,
      voltaOpts
    )

    events.forEach((e, i) => {
      staveNoteMap.set(e.id, staveNotes[i])
      eventStaveMap.set(e.id, stave)
    })

    // Collect stave references for group connector drawing
    const pKey = `${layout.partId}:${mIdx}`
    if (!partStaveTop.has(pKey)) partStaveTop.set(pKey, stave)
    partStaveBottom.set(pKey, stave)  // last stave written wins → bottommost
    mIdxIsLineStart.set(mIdx, layout.isLineStart)

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
        nativeCtx.fillText(label, layout.x - (hasGroupConnector ? 22 : 8), layout.staveTopY + 20)
        nativeCtx.restore()
      }
    }

    // Directives: drawn in the VexFlow headroom zone above the top staff line
    drawDirectives(ctx, layout, measure, staff, score, part === score.parts[0], stave.getNoteStartX())
    // Note-attached dynamics below the stave
    if (staveNotes.length > 0) {
      drawNoteDynamics(ctx, layout, measure, staff, staveNotes, events)
    }
  }

  // ── Second pass: group connectors (brackets, braces, barline spans) ─────────
  drawGroupConnectors(ctx, score, partStaveTop, partStaveBottom, mIdxIsLineStart)

  // ── Third pass: ties and slurs ──────────────────────────────────────────────
  const nativeCtx: CanvasRenderingContext2D | null =
    typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null

  for (const part of score.parts) {
    for (const staff of part.staves) {
      drawTiesForStaff(ctx, staff, staveNoteMap)
      if (nativeCtx) {
        drawSlursForStaff(nativeCtx, staff, staveNoteMap, eventStaveMap)
        drawHairpinsForStaff(nativeCtx, staff, staveNoteMap, eventStaveMap)
      }
    }
  }
}

// ── Group connectors (brackets, braces, spanning barlines) ────────────────────

function drawGroupConnectors(
  ctx: RenderContext,
  score: Score,
  partStaveTop:    Map<string, Stave>,
  partStaveBottom: Map<string, Stave>,
  mIdxIsLineStart: Map<number, boolean>,
): void {
  // Collect groups: groupId → { symbol, partIds in score order }
  const groupMap = new Map<string, { symbol: GroupSymbol; partIds: string[] }>()
  for (const part of score.parts) {
    if (!part.groupId) continue
    if (!groupMap.has(part.groupId)) {
      groupMap.set(part.groupId, { symbol: part.groupSymbol ?? 'bracket', partIds: [] })
    }
    groupMap.get(part.groupId)!.partIds.push(part.id)
  }
  if (groupMap.size === 0) return

  for (const [mIdx, isLineStart] of mIdxIsLineStart.entries()) {
    for (const { symbol, partIds } of groupMap.values()) {
      if (partIds.length < 2) continue   // nothing to connect

      const topStave    = partStaveTop.get(`${partIds[0]}:${mIdx}`)
      const bottomStave = partStaveBottom.get(`${partIds[partIds.length - 1]}:${mIdx}`)
      if (!topStave || !bottomStave) continue

      // Barline spanning right edge of every measure
      const measure    = score.parts.find(p => p.id === partIds[0])?.staves[0]?.measures[mIdx]
      const barlineType = measure?.barline
      const rightType = barlineType === 'final' || barlineType === 'repeat-end'
        ? StaveConnector.type.BOLD_DOUBLE_RIGHT
        : barlineType === 'double'
          ? StaveConnector.type.THIN_DOUBLE
          : StaveConnector.type.SINGLE_RIGHT

      new StaveConnector(topStave, bottomStave)
        .setType(rightType)
        .setContext(ctx)
        .draw()

      if (isLineStart) {
        // Bracket or brace on the left
        const leftSymType = symbol === 'brace'
          ? StaveConnector.type.BRACE
          : StaveConnector.type.BRACKET

        // For brace: the treble clef curl extends below the stave's bottom line,
        // so nudge the brace's bottom anchor up to avoid visual overlap.
        const braceBottomStave = symbol === 'brace'
          ? new Stave(bottomStave.getX(), bottomStave.getY() - 6, bottomStave.getWidth())
          : bottomStave

        new StaveConnector(topStave, braceBottomStave)
          .setType(leftSymType)
          .setContext(ctx)
          .draw()

        // Thin barline on the left connecting all staves in the group
        new StaveConnector(topStave, bottomStave)
          .setType(StaveConnector.type.SINGLE_LEFT)
          .setContext(ctx)
          .draw()
      }
    }
  }
}

// ── Staff-position helpers for directive placement ────────────────────────────

const NOTE_STEPS: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }

// Diatonic position (octave * 7 + step) of the bottom staff line per clef
const CLEF_BOTTOM_DIATONIC: Record<ClefType, number> = {
  treble:     4 * 7 + 2,  // E4
  bass:       2 * 7 + 4,  // G2
  alto:       3 * 7 + 3,  // F3
  tenor:      3 * 7 + 1,  // D3
  percussion: 4 * 7 + 2,
}

// Returns how far (px) the lowest pitched note in the measure extends below the bottom staff line.
function lowestNoteOverhangPx(measure: Measure, clef: ClefType): number {
  const bottomDiatonic = CLEF_BOTTOM_DIATONIC[clef]
  let maxStepsBelow = 0
  for (const voice of measure.voices) {
    for (const event of voice.events) {
      const pitches = event.type === 'note'  ? [event.pitch]
                    : event.type === 'chord' ? event.pitches
                    : []
      for (const p of pitches) {
        const stepsBelow = bottomDiatonic - (p.octave * 7 + NOTE_STEPS[p.noteName])
        if (stepsBelow > maxStepsBelow) maxStepsBelow = stepsBelow
      }
    }
  }
  return maxStepsBelow * 5  // 5px per diatonic step (LINE_SPACING_PX / 2)
}

// ── Draw performance directives for one measure ───────────────────────────────

function drawDirectives(
  ctx: RenderContext,
  layout: MeasureLayout,
  measure: Measure,
  staff: Staff,
  score: Score,
  isFirstPart: boolean,
  noteStartX: number
): void {
  const nativeCtx: CanvasRenderingContext2D | null =
    typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null
  if (!nativeCtx) return

  const mIdx = staff.measures.findIndex(m => m.id === measure.id)
  const directives = measure.directives ?? []

  nativeCtx.save()
  nativeCtx.textBaseline = 'alphabetic'

  // ── Tempo (first part only) ─────────────────────────────────────────────────
  if (isFirstPart) {
    const tempoDirs = directives.filter(d => d.category === 'tempo')
    const showScoreTempo = mIdx === 0 && tempoDirs.length === 0

    if (tempoDirs.length > 0 || showScoreTempo) {
      nativeCtx.font      = 'bold italic 13px Edwin, serif'
      nativeCtx.fillStyle = '#111'
      nativeCtx.textAlign = 'left'

      let label: string
      if (tempoDirs.length > 0) {
        label = tempoDirs.map(d => {
          if (d.bpm) return d.text ? `${d.text}  ♩=${d.bpm}` : `♩=${d.bpm}`
          return d.text
        }).join('  ')
      } else {
        const bpm = resolveDirectiveTempo(staff.measures, mIdx, score.tempo)
        label = `♩=${bpm}`
      }
      nativeCtx.fillText(label, noteStartX + 2, layout.staveY + 14)
    }
  }

  // ── Expression (above stave) ───────────────────────────────────────────────
  const exprDirs = directives.filter(d => d.category === 'expression')
  if (exprDirs.length > 0) {
    nativeCtx.font      = 'italic 12px Edwin, serif'
    nativeCtx.fillStyle = '#444'
    nativeCtx.textAlign = 'left'
    nativeCtx.fillText(exprDirs.map(d => d.text).join(' '), noteStartX + 2, layout.staveTopY - 6)
  }

  nativeCtx.restore()
}

// ── Note-attached dynamics (below stave, per-note x position) ─────────────────

function drawNoteDynamics(
  ctx: RenderContext,
  layout: MeasureLayout,
  measure: Measure,
  staff: Staff,
  staveNotes: StaveNote[],
  events: NoteEvent[],
): void {
  const nativeCtx: CanvasRenderingContext2D | null =
    typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null
  if (!nativeCtx) return

  const mIdx = staff.measures.findIndex(m => m.id === measure.id)
  const clef = resolveClef(staff.measures, mIdx, staff.clef)
  const staveBottom = layout.staveTopY + STAVE_HEIGHT_PX

  nativeCtx.save()
  nativeCtx.font      = 'bold italic 13px Edwin, serif'
  nativeCtx.fillStyle = '#111'
  nativeCtx.textAlign = 'left'
  nativeCtx.textBaseline = 'alphabetic'

  events.forEach((event, i) => {
    const dynamic = (event as any).dynamic as DynamicLevel | undefined
    if (!dynamic) return
    // Clear past any low notes in this measure so the label never overlaps noteheads.
    const overhang = lowestNoteOverhangPx(measure, clef)
    const y = staveBottom + Math.max(14, overhang + 10)
    const x = staveNotes[i].getAbsoluteX()
    nativeCtx.fillText(dynamic, x, y)
  })

  nativeCtx.restore()
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

// ── Volta helpers ────────────────────────────────────────────────────────────

interface VoltaOpts { vexType: VoltaType; label: string }

function resolveVoltaOpts(measureIndex: number, voltas: readonly Volta[]): VoltaOpts | undefined {
  const volta = voltas.find(v => measureIndex >= v.startMeasureIndex && measureIndex <= v.endMeasureIndex)
  if (!volta) return undefined
  const isFirst = measureIndex === volta.startMeasureIndex
  const isLast  = measureIndex === volta.endMeasureIndex
  const label   = isFirst ? `${volta.number}.` : ''
  const vexType = isFirst && isLast ? VoltaType.BEGIN_END
                : isFirst           ? VoltaType.BEGIN
                : isLast            ? VoltaType.END
                :                     VoltaType.MID
  return { vexType, label }
}

// ── Render a single measure ───────────────────────────────────────────────────

interface MeasureRenderResult {
  stave: Stave
  staveNotes: StaveNote[]
  events: NoteEvent[]
}

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
  selectedNoteIds: ReadonlySet<string>,
  notePositions: Map<string, number>,
  voltaOpts?: VoltaOpts
): MeasureRenderResult {
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

  if (voltaOpts) {
    stave.setVoltaType(voltaOpts.vexType, voltaOpts.label, 0)
  }

  stave.setContext(ctx).draw()

  // Exact note area after VexFlow has placed clef/key/time preamble.
  // Short notes (16th and below) have flags that extend right of the stem —
  // beyond where VexFlow accounts for them when computing note positions.
  // Reducing the formatter width by a flag-width margin keeps the last note
  // clear of the end barline.
  const rawNoteAreaWidth = stave.getNoteEndX() - stave.getNoteStartX()
  const noteAreaWidth = rawNoteAreaWidth - flagRightClearance(measure.voices[0]?.events ?? [])

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

  const events0 = measure.voices[0]?.events ?? []
  const events1 = measure.voices[1]?.events ?? []

  const vexVoiceCfg = { numBeats: effectiveSig.numerator, beatValue: effectiveSig.denominator }
  const beamGroups  = getBeamGroups(effectiveSig)

  const buildTuplets = (evts: readonly NoteEvent[], sns: StaveNote[]) => {
    const tm = new Map<string, { notes: StaveNote[]; actual: number; normal: number }>()
    evts.forEach((e, i) => {
      const t = (e as any).tuplet as TupletInfo | undefined
      if (!t) return
      if (!tm.has(t.id)) tm.set(t.id, { notes: [], actual: t.actual, normal: t.normal })
      tm.get(t.id)!.notes.push(sns[i])
    })
    return Array.from(tm.values()).map(({ notes, actual, normal }) =>
      new VexTuplet(notes, { numNotes: actual, notesOccupied: normal, ratioed: false })
    )
  }

  const buildBeams = (sns: StaveNote[]) =>
    beamGroups ? Beam.generateBeams(sns, { groups: beamGroups }) : Beam.generateBeams(sns)

  // Whole-rest placeholder when both voices are empty
  if (events0.length === 0 && events1.length === 0) {
    const wholeRest = new StaveNote({ clef: clefType, keys: [CLEF_REST_KEY[clefType] ?? 'b/4'], duration: 'wr' })
    const vexVoice  = new VexVoice(vexVoiceCfg).setStrict(false)
    vexVoice.addTickables([wholeRest])
    new Formatter().joinVoices([vexVoice]).format([vexVoice], noteAreaWidth)
    vexVoice.draw(ctx, stave)
    return { stave, staveNotes: [], events: [] as NoteEvent[] }
  }

  // Two-voice rendering
  if (events0.length > 0 && events1.length > 0) {
    const sns0 = events0.map(e => noteEventToStaveNote(e, selectedNoteIds.has(e.id), clefType, 1))
    const sns1 = events1.map(e => noteEventToStaveNote(e, selectedNoteIds.has(e.id), clefType, -1, '#2d8f4e'))

    const vv0 = new VexVoice(vexVoiceCfg).setStrict(false)
    const vv1 = new VexVoice(vexVoiceCfg).setStrict(false)
    vv0.addTickables(sns0)
    vv1.addTickables(sns1)

    const tuplets0 = buildTuplets(events0, sns0)
    const tuplets1 = buildTuplets(events1, sns1)
    const beams0   = buildBeams(sns0)
    const beams1   = buildBeams(sns1)

    new Formatter().joinVoices([vv0, vv1]).format([vv0, vv1], noteAreaWidth)

    sns0.forEach((sn, i) => { sn.setStave(stave); notePositions.set(events0[i].id, sn.getAbsoluteX()) })
    sns1.forEach((sn, i) => { sn.setStave(stave); notePositions.set(events1[i].id, sn.getAbsoluteX()) })

    vv0.draw(ctx, stave)
    vv1.draw(ctx, stave)
    beams0.forEach(b => b.setContext(ctx).draw())
    beams1.forEach(b => b.setContext(ctx).draw())
    tuplets0.forEach(t => t.setContext(ctx).draw())
    tuplets1.forEach(t => t.setContext(ctx).draw())

    return { stave, staveNotes: [...sns0, ...sns1], events: [...events0, ...events1] as NoteEvent[] }
  }

  // Single-voice rendering (voice 0 or voice 1 alone)
  const isVoice1Only = events0.length === 0
  const events     = isVoice1Only ? events1 : events0
  const stemDir    = isVoice1Only ? -1 : undefined
  const noteColor  = isVoice1Only ? '#2d8f4e' : undefined

  const staveNotes = events.map(e => noteEventToStaveNote(e, selectedNoteIds.has(e.id), clefType, stemDir, noteColor))
  const vexVoice   = new VexVoice(vexVoiceCfg).setStrict(false)
  vexVoice.addTickables(staveNotes)

  const vexTuplets = buildTuplets(events, staveNotes)
  const beams      = buildBeams(staveNotes)

  new Formatter().joinVoices([vexVoice]).format([vexVoice], noteAreaWidth)
  staveNotes.forEach((sn, i) => {
    sn.setStave(stave)
    notePositions.set(events[i].id, sn.getAbsoluteX())
  })
  vexVoice.draw(ctx, stave)
  beams.forEach(b => b.setContext(ctx).draw())
  vexTuplets.forEach(t => t.setContext(ctx).draw())
  return { stave, staveNotes, events: events as NoteEvent[] }
}

// ── Tie rendering ─────────────────────────────────────────────────────────────
// Uses VexFlow StaveTie; null firstNote/lastNote produces partial arcs at
// measure boundaries for cross-measure ties.

function drawTiesForStaff(
  ctx: RenderContext,
  staff: Staff,
  staveNoteMap: Map<string, StaveNote>,
): void {
  for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
    const measure = staff.measures[mIdx]

    for (let vIdx = 0; vIdx < measure.voices.length; vIdx++) {
      const events = measure.voices[vIdx]?.events ?? []

      for (let eIdx = 0; eIdx < events.length; eIdx++) {
        const event = events[eIdx]
        if (event.type !== 'note') continue
        const note = event as Note
        if (!note.tieStart) continue

        const srcSN = staveNoteMap.get(note.id)
        if (!srcSN) continue

        // Find the next note in the same voice: rest of this measure, then next measure
        let destNote: Note | null = null
        let inSameMeasure = false
        for (let j = eIdx + 1; j < events.length; j++) {
          if (events[j].type === 'note') {
            destNote = events[j] as Note
            inSameMeasure = true
            break
          }
        }
        if (!destNote && mIdx + 1 < staff.measures.length) {
          for (const e of staff.measures[mIdx + 1].voices[vIdx]?.events ?? []) {
            if (e.type === 'note') { destNote = e as Note; break }
          }
        }

        const dstSN = destNote ? staveNoteMap.get(destNote.id) ?? null : null

        if (inSameMeasure && dstSN) {
          new StaveTie({ firstNote: srcSN, lastNote: dstSN, firstIndexes: [0], lastIndexes: [0] })
            .setContext(ctx).draw()
        } else if (dstSN) {
          new StaveTie({ firstNote: srcSN, lastNote: null, firstIndexes: [0], lastIndexes: [0] })
            .setContext(ctx).draw()
          new StaveTie({ firstNote: null, lastNote: dstSN, firstIndexes: [0], lastIndexes: [0] })
            .setContext(ctx).draw()
        }
      }
    }
  }
}

// ── Slur rendering ────────────────────────────────────────────────────────────
// Drawn with native canvas quadratic bezier curves. For cross-measure slurs,
// the arc is split at each stave boundary.

function drawSlursForStaff(
  ctx2d: CanvasRenderingContext2D,
  staff: Staff,
  staveNoteMap: Map<string, StaveNote>,
  eventStaveMap: Map<string, Stave>,
): void {
  if (!staff.slurs?.length) return

  for (const slur of staff.slurs) {
    const fromSN = staveNoteMap.get(slur.fromNoteId)
    const toSN   = staveNoteMap.get(slur.toNoteId)
    const fromStave = eventStaveMap.get(slur.fromNoteId)
    const toStave   = eventStaveMap.get(slur.toNoteId)
    if (!fromSN || !toSN || !fromStave || !toStave) continue

    const above   = (slur.placement ?? 'above') === 'above'
    const sign    = above ? -1 : 1

    const x1 = fromSN.getAbsoluteX() + 4
    const x2 = toSN.getAbsoluteX()   + 4

    const fromYs = fromSN.getYs()
    const toYs   = toSN.getYs()
    const y1 = above
      ? Math.min(fromStave.getYForLine(0) - 6, Math.min(...fromYs) - 8)
      : Math.max(fromStave.getYForLine(4) + 6, Math.max(...fromYs) + 8)
    const y2 = above
      ? Math.min(toStave.getYForLine(0) - 6, Math.min(...toYs) - 8)
      : Math.max(toStave.getYForLine(4) + 6, Math.max(...toYs) + 8)

    const sameLine = fromStave === toStave

    ctx2d.save()
    ctx2d.strokeStyle = '#111'
    ctx2d.lineWidth   = 1.5

    if (sameLine) {
      const span = x2 - x1
      const arc  = sign * Math.max(10, span * 0.12)
      const midX = (x1 + x2) / 2
      ctx2d.beginPath()
      ctx2d.moveTo(x1, y1)
      ctx2d.quadraticCurveTo(midX, y1 + arc, x2, y2)
      ctx2d.stroke()
    } else {
      // Split arc: source note → right edge of source stave
      const rightEdge = fromStave.getX() + fromStave.getWidth()
      const arc1 = sign * Math.max(10, (rightEdge - x1) * 0.15)
      ctx2d.beginPath()
      ctx2d.moveTo(x1, y1)
      ctx2d.quadraticCurveTo((x1 + rightEdge) / 2, y1 + arc1, rightEdge, y1)
      ctx2d.stroke()
      // Left edge of dest stave → dest note
      const leftEdge = toStave.getX()
      const arc2 = sign * Math.max(10, (x2 - leftEdge) * 0.15)
      ctx2d.beginPath()
      ctx2d.moveTo(leftEdge, y2)
      ctx2d.quadraticCurveTo((leftEdge + x2) / 2, y2 + arc2, x2, y2)
      ctx2d.stroke()
    }

    ctx2d.restore()
  }
}

// ── Hairpin rendering ─────────────────────────────────────────────────────────
// Draws crescendo / decrescendo wedges below the staff bottom line.
// Cross-row hairpins are split at the stave boundary.

const HAIRPIN_HALF_SPREAD = 7   // px at the open end
const HAIRPIN_BELOW_STAFF = 16  // px below bottom staff line (line 4)

function drawHairpinWedge(
  ctx2d: CanvasRenderingContext2D,
  x1: number, x2: number, y: number,
  isCrescendo: boolean,
  fractionStart: number,
  fractionEnd: number,
): void {
  const s1 = isCrescendo
    ? HAIRPIN_HALF_SPREAD * fractionStart
    : HAIRPIN_HALF_SPREAD * (1 - fractionStart)
  const s2 = isCrescendo
    ? HAIRPIN_HALF_SPREAD * fractionEnd
    : HAIRPIN_HALF_SPREAD * (1 - fractionEnd)

  ctx2d.beginPath()
  ctx2d.moveTo(x1, y - s1)
  ctx2d.lineTo(x2, y - s2)
  ctx2d.stroke()

  ctx2d.beginPath()
  ctx2d.moveTo(x1, y + s1)
  ctx2d.lineTo(x2, y + s2)
  ctx2d.stroke()
}

// Returns the Y coordinate below which a hairpin wedge should sit, scanning
// the stem extents of all notes in the hairpin range so beamed stems don't
// overlap the wedge.
function hairpinY(
  staff: Staff,
  fromNoteId: string,
  toNoteId: string,
  staveNoteMap: Map<string, StaveNote>,
  defaultY: number,
): number {
  let inRange = false
  let done    = false
  let maxY    = defaultY

  for (const measure of staff.measures) {
    if (done) break
    for (const event of measure.voices[0]?.events ?? []) {
      if (event.id === fromNoteId) inRange = true
      if (inRange && event.type !== 'rest') {
        const sn = staveNoteMap.get(event.id)
        if (sn) {
          try { maxY = Math.max(maxY, sn.getStemExtents().baseY + 8) } catch { /* no stem */ }
        }
      }
      if (event.id === toNoteId) { done = true; break }
    }
  }

  return maxY
}

function drawHairpinsForStaff(
  ctx2d: CanvasRenderingContext2D,
  staff: Staff,
  staveNoteMap: Map<string, StaveNote>,
  eventStaveMap: Map<string, Stave>,
): void {
  if (!staff.hairpins?.length) return

  for (const hairpin of staff.hairpins) {
    const fromSN    = staveNoteMap.get(hairpin.fromNoteId)
    const toSN      = staveNoteMap.get(hairpin.toNoteId)
    const fromStave = eventStaveMap.get(hairpin.fromNoteId)
    const toStave   = eventStaveMap.get(hairpin.toNoteId)
    if (!fromSN || !toSN || !fromStave || !toStave) continue

    const x1 = fromSN.getAbsoluteX()
    const x2 = toSN.getAbsoluteX() + 10
    const isCrescendo = hairpin.type === 'crescendo'

    ctx2d.save()
    ctx2d.strokeStyle = '#111'
    ctx2d.lineWidth   = 1.4

    if (fromStave === toStave) {
      const defaultY = fromStave.getYForLine(4) + HAIRPIN_BELOW_STAFF
      const y = hairpinY(staff, hairpin.fromNoteId, hairpin.toNoteId, staveNoteMap, defaultY)
      drawHairpinWedge(ctx2d, x1, x2, y, isCrescendo, 0, 1)
    } else {
      // Split at each stave row boundary
      const rightEdge = fromStave.getX() + fromStave.getWidth()
      const leftEdge  = toStave.getX()
      const seg1 = rightEdge - x1
      const seg2 = x2 - leftEdge
      const total = seg1 + seg2
      const splitFrac = total > 0 ? seg1 / total : 0.5

      const defaultY1 = fromStave.getYForLine(4) + HAIRPIN_BELOW_STAFF
      const defaultY2 = toStave.getYForLine(4)   + HAIRPIN_BELOW_STAFF
      const y1 = hairpinY(staff, hairpin.fromNoteId, hairpin.toNoteId, staveNoteMap, defaultY1)

      drawHairpinWedge(ctx2d, x1, rightEdge, y1, isCrescendo, 0, splitFrac)
      drawHairpinWedge(ctx2d, leftEdge, x2, defaultY2, isCrescendo, splitFrac, 1)
    }

    ctx2d.restore()
  }
}

// ── Cursor overlay ────────────────────────────────────────────────────────────

const LINE_SPACING_PX       = 10
export const STAVE_HEIGHT_PX = 4 * LINE_SPACING_PX
const LYRIC_Y_OFFSET         = 60   // px below staveTopY (20px below bottom staff line)

// ── Lyric rendering ───────────────────────────────────────────────────────────

function drawAllLyrics(
  ctx2d: CanvasRenderingContext2D,
  score: Score,
  notePositions: Map<string, number>,
  layouts: MeasureLayout[],
  lyricCursorNoteId: string | null,
): void {
  // Index layouts by measureId for fast staveTopY lookup
  const measureLayoutMap = new Map<string, MeasureLayout>()
  for (const l of layouts) {
    if (!measureLayoutMap.has(l.measureId)) measureLayoutMap.set(l.measureId, l)
  }

  ctx2d.save()
  ctx2d.font = '12px serif'
  ctx2d.textBaseline = 'alphabetic'

  for (const part of score.parts) {
    for (const staff of part.staves) {
      // Collect all voice-0 pitched events across all measures with their canvas positions
      const entries: { id: string; lyric: string | undefined; x: number; lyricY: number }[] = []

      for (const measure of staff.measures) {
        const voice = measure.voices[0]
        if (!voice) continue
        const layout = measureLayoutMap.get(measure.id)
        if (!layout) continue
        const lyricY = layout.staveTopY + LYRIC_Y_OFFSET

        for (const event of voice.events) {
          if (event.type === 'rest') continue
          const x = notePositions.get(event.id)
          if (x === undefined) continue
          entries.push({ id: event.id, lyric: (event as any).lyric, x, lyricY })
        }
      }

      // Draw syllables, hyphens, and cursor underline
      for (let i = 0; i < entries.length; i++) {
        const { id, lyric, x, lyricY } = entries[i]
        const isMidWord = lyric?.endsWith('-') ?? false

        if (id === lyricCursorNoteId) {
          ctx2d.strokeStyle = '#0e639c'
          ctx2d.lineWidth   = 1.5
          ctx2d.beginPath()
          ctx2d.moveTo(x - 12, lyricY + 3)
          ctx2d.lineTo(x + 12, lyricY + 3)
          ctx2d.stroke()
        } else if (lyric) {
          ctx2d.textAlign  = 'center'
          ctx2d.fillStyle  = '#222'
          ctx2d.fillText(isMidWord ? lyric.slice(0, -1) : lyric, x, lyricY)
        }

        if (isMidWord && i + 1 < entries.length) {
          const next = entries[i + 1]
          const midX = (x + next.x) / 2
          ctx2d.textAlign = 'center'
          ctx2d.fillStyle = '#555'
          ctx2d.font      = '10px serif'
          ctx2d.fillText('-', midX, lyricY)
          ctx2d.font      = '12px serif'
        }
      }
    }
  }

  ctx2d.restore()
}

function drawMeasureHighlight(
  canvas: HTMLCanvasElement,
  selectedMeasureId: string,
  layouts: MeasureLayout[]
): void {
  const anchor = layouts.find(l => l.measureId === selectedMeasureId)
  if (!anchor) return

  // Collect all part staves rendered at this measure column
  const column = layouts.filter(l => l.measureIndex === anchor.measureIndex)

  const top    = Math.min(...column.map(l => l.staveTopY)) - 8
  const bottom = Math.max(...column.map(l => l.staveTopY)) + STAVE_HEIGHT_PX + 8
  const left   = anchor.x
  const width  = anchor.width

  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) return

  ctx2d.save()
  ctx2d.fillStyle   = 'rgba(33, 150, 243, 0.07)'
  ctx2d.strokeStyle = 'rgba(33, 150, 243, 0.35)'
  ctx2d.lineWidth   = 1.5
  ctx2d.fillRect(left, top, width, bottom - top)
  ctx2d.strokeRect(left, top, width, bottom - top)
  ctx2d.restore()
}

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
