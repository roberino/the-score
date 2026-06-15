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

import type { Score, Part, Staff, Measure, NoteEvent, Note, Rest, Chord, Duration, ClefType, TimeSignature, KeySignature, Accidental, NoteName, Articulation, GroupSymbol, TupletInfo, DynamicLevel, Volta, MidiScoreEvent, SequencePattern, TabConfig, NoteheadType } from '@shared/score'
import { pitchToMidi, pitchToTabPosition, chordToTabPositions } from '@shared/tabUtils'
import { resolveTimeSig, timeSigsEqual, resolveClef, transposeKeyFifths, measureCapacityUnits, resolveDirectiveTempo, eventDurationUnits, activeAssignmentAt, keyAccidental } from '@shared/musicUtils'

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

const NOTEHEAD_SUFFIX: Record<NoteheadType, string> = {
  'normal':   '',
  'x':        '/x',
  'circle-x': '/cx',
  'diamond':  '/d',
  'slash':    '/s',
  'triangle': '/ti',
}

function buildKey(pitch: { noteName: string; octave: number; accidental: string | null }, noteheadType?: NoteheadType): string {
  const suffix = noteheadType ? NOTEHEAD_SUFFIX[noteheadType] : ''
  return `${pitch.noteName.toLowerCase()}/${pitch.octave}${suffix}`
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

// ── Accidental display computation ────────────────────────────────────────────
// Determines which accidental symbol to display for each note/chord pitch in a
// measure, applying three spec rules:
//   1. Carry-forward: an accidental is active for all subsequent notes of the
//      same pitch and octave until the barline; redundant symbols are suppressed.
//   2. Restoration: when a note returns to the key-signature value after an
//      in-measure override, the key-sig accidental (or ♮) is shown explicitly.
//   3. Tied continuation: tieEnd notes never display their accidental symbol, but
//      their pitch is pre-seeded into the carry state so subsequent notes see it.
// Note: accidentals are computed independently per voice for simplicity. Cross-
// voice carry-forward is deferred.

type CarryAcc = 'sharp' | 'flat' | 'natural' | 'doubleSharp' | 'doubleFlat' | null

// Normalize for comparison: 'natural' and null are both "no chromatic alteration".
const normAcc = (a: CarryAcc): CarryAcc => (a === 'natural' ? null : a)

export function accToVex(acc: 'sharp' | 'flat' | 'natural' | 'doubleSharp' | 'doubleFlat'): string {
  switch (acc) {
    case 'sharp':       return '#'
    case 'flat':        return 'b'
    case 'natural':     return 'n'
    case 'doubleSharp': return '##'
    case 'doubleFlat':  return 'bb'
  }
}

// Returns Map<eventId, displayAccidentals[]> where displayAccidentals[i] is the
// accidental symbol to render for pitch i (null = render no symbol).
export function computeDisplayAccidentals(
  events: readonly NoteEvent[],
  writtenKeyFifths: number,
): Map<string, Accidental[]> {
  // carry[`${noteName}${octave}`] = in-measure override currently active
  // Missing entry = key-signature value is in effect
  const carry = new Map<string, CarryAcc>()
  const result = new Map<string, Accidental[]>()

  // Pre-seed carry from tieEnd notes: pitch is active but not displayed.
  for (const event of events) {
    if (event.type !== 'note') continue
    const note = event as Note
    if (!note.tieEnd) continue
    const keySigAcc = keyAccidental(note.pitch.noteName as NoteName, writtenKeyFifths)
    const normalizedAcc = normAcc(note.pitch.accidental)
    if (normalizedAcc !== normAcc(keySigAcc)) {
      carry.set(`${note.pitch.noteName}${note.pitch.octave}`, normalizedAcc)
    }
  }

  for (const event of events) {
    type P = { noteName: string; octave: number; accidental: Accidental; tieEnd: boolean }
    let pitches: P[]
    if (event.type === 'note') {
      const n = event as Note
      pitches = [{ noteName: n.pitch.noteName, octave: n.pitch.octave, accidental: n.pitch.accidental, tieEnd: n.tieEnd }]
    } else if (event.type === 'chord') {
      const c = event as Chord
      pitches = c.pitches.map(p => ({ noteName: p.noteName, octave: p.octave, accidental: p.accidental, tieEnd: false }))
    } else {
      continue
    }

    const displayList: Accidental[] = []

    for (const { noteName, octave, accidental: storedAcc, tieEnd } of pitches) {
      const k = `${noteName}${octave}`
      const keySigAcc = keyAccidental(noteName as NoteName, writtenKeyFifths)
      const carryAcc: CarryAcc = carry.has(k) ? carry.get(k)! : keySigAcc

      if (tieEnd) {
        displayList.push(null)  // never display on tie continuation
        continue
      }

      // null and 'natural' both mean "no chromatic alteration" — same as pitchToMidi semantics.
      const intended: CarryAcc = normAcc(storedAcc)

      let display: Accidental
      if (normAcc(carryAcc) === normAcc(intended)) {
        display = null  // reader already expects this pitch; no symbol needed
      } else if (normAcc(intended) === normAcc(keySigAcc)) {
        // Returning to key-signature pitch after an in-measure override.
        // Show the key-sig accidental (e.g. '#' in D major) or ♮ if key is natural.
        display = keySigAcc ?? 'natural'
      } else {
        // New explicit accidental.
        display = intended === null ? 'natural' : intended
      }

      displayList.push(display)

      // Update carry for subsequent notes in this measure.
      if (normAcc(intended) === normAcc(keySigAcc)) {
        carry.delete(k)
      } else {
        carry.set(k, intended)
      }
    }

    result.set(event.id, displayList)
  }

  return result
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
  selectedPitchIndex?: number,  // when set on a chord: only that notehead gets selection colour
  displayAccidentals?: readonly Accidental[],  // computed by computeDisplayAccidentals
): StaveNote {
  const stemOpts = stemDirection !== undefined ? { stem_direction: stemDirection } : {}
  const SEL_STYLE     = { fillStyle: '#3b9ddd', strokeStyle: '#3b9ddd' }
  const DEFAULT_STYLE = { fillStyle: noteColor ?? '#333333', strokeStyle: noteColor ?? '#333333' }
  const applyColor = (sn: StaveNote) => {
    if (selected)        sn.setStyle(SEL_STYLE)
    else if (noteColor)  sn.setStyle(DEFAULT_STYLE)
  }
  switch (event.type) {
    case 'note': {
      const n = event as Note
      const staveNote = new StaveNote({
        clef,
        keys: [buildKey(n.pitch, n.noteheadType)],
        duration: DURATION_MAP[n.duration] + (n.dots > 0 ? 'd'.repeat(n.dots) : ''),
        ...stemOpts,
      })
      if (n.dots > 0) Dot.buildAndAttach([staveNote], { all: true })
      const noteDisplayAcc = displayAccidentals !== undefined ? displayAccidentals[0] : n.pitch.accidental
      if (noteDisplayAcc) staveNote.addModifier(new VexAccidental(accToVex(noteDisplayAcc)), 0)
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
        keys: c.pitches.map(p => buildKey(p, c.noteheadType)),
        duration: DURATION_MAP[c.duration] + (c.dots > 0 ? 'd'.repeat(c.dots) : ''),
        ...stemOpts,
      })
      if (c.dots > 0) Dot.buildAndAttach([staveNote], { all: true })
      c.pitches.forEach((pitch, i) => {
        const chordDisplayAcc = displayAccidentals !== undefined ? displayAccidentals[i] : pitch.accidental
        if (chordDisplayAcc) staveNote.addModifier(new VexAccidental(accToVex(chordDisplayAcc)), i)
      })
      if (c.articulations.length > 0) attachArticulations(staveNote, c.articulations)
      if (selected && selectedPitchIndex !== undefined) {
        // Individual pitch selected: highlight only that notehead, others default.
        // Do NOT call setStyle() here — it overrides setKeyStyle() during VexFlow's draw pipeline.
        c.pitches.forEach((_, i) => {
          staveNote.setKeyStyle(i, i === selectedPitchIndex ? SEL_STYLE : DEFAULT_STYLE)
        })
      } else {
        applyColor(staveNote)
      }
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
  staveHeight: 140,
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
  systemRow: number   // which system row (line) this measure belongs to
  tabStaveY?: number  // y of the top TAB string line (undefined when tab is off)
  tabStringCount?: number
}

// VexFlow 5 default: spaceAboveStaffLn = 4, spacingBetweenLinesPx = 10
export const VEXFLOW_HEADROOM_PX = 40

export function computeLayout(score: Score, options: RenderOptions): MeasureLayout[] {
  const layouts: MeasureLayout[] = []
  const { canvasWidth, staveHeight, marginX, marginY, measuresPerLine } = options
  const marginRight = options.marginRight ?? marginX
  const lineWidth   = canvasWidth - marginX - marginRight   // usable px per line

  // Per-part heights (tab parts are taller than standard)
  const partExtraH = score.parts.map(part => {
    const tc = (part as any).tabConfig as TabConfig | undefined
    if (!tc || !(part as any).showTab) return 0
    return TAB_GAP_PX + (tc.stringCount - 1) * LINE_SPACING_PX + TAB_BOTTOM_MARGIN_PX
  })
  const partTotalH  = score.parts.map((_, i) => staveHeight + partExtraH[i])
  const cumPartY: number[] = [0]
  for (let i = 0; i < partTotalH.length - 1; i++) cumPartY.push(cumPartY[i] + partTotalH[i])
  const rowHeight   = cumPartY[cumPartY.length - 1] + partTotalH[partTotalH.length - 1] + 40

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

  // Pre-compute resolved sig/key/clef at every measure index — single forward pass,
  // O(n) total instead of O(n²) repeated backward scans.
  const resolvedTimeSigs: TimeSignature[] = []
  const resolvedKeySigs: KeySignature[]   = []
  const resolvedClefs: ClefType[]         = []
  {
    let ts: TimeSignature = score.timeSignature
    let ks: KeySignature  = score.keySignature
    let cl: ClefType      = firstStaff.clef as ClefType
    for (const m of firstStaff.measures) {
      if (m.timeSignature) ts = m.timeSignature
      if (m.keySignature)  ks = m.keySignature
      if (m.clef)          cl = m.clef.type
      resolvedTimeSigs.push(ts)
      resolvedKeySigs.push(ks)
      resolvedClefs.push(cl)
    }
  }
  // Per-part staff clefs (each staff may have its own clef history)
  const partStaffClefs = new Map<string, ClefType[]>()
  for (const part of score.parts) {
    const staff = part.staves[0]
    if (!staff) continue
    const clefs: ClefType[] = []
    let cl: ClefType = staff.clef as ClefType
    for (const m of staff.measures) {
      if (m.clef) cl = m.clef.type
      clefs.push(cl)
    }
    partStaffClefs.set(staff.id, clefs)
  }

  const infos: MeasureInfo[] = []
  let lineIndex      = 0
  let lineUsed       = 0
  let measuresInLine = 0

  for (let mIdx = 0; mIdx < measureCount; mIdx++) {
    const effectiveSig  = resolvedTimeSigs[mIdx]
    const effectiveKey  = resolvedKeySigs[mIdx]
    const effectiveClef = resolvedClefs[mIdx]
    const prevKey       = mIdx > 0 ? resolvedKeySigs[mIdx - 1]  : null
    const prevSig       = mIdx > 0 ? resolvedTimeSigs[mIdx - 1] : null
    const prevClef      = mIdx > 0 ? resolvedClefs[mIdx - 1]    : null
    const keyChanged  = prevKey  !== null && prevKey.fifths !== effectiveKey.fifths
    const sigChanged  = prevSig  !== null && !timeSigsEqual(effectiveSig, prevSig)
    const clefChanged = prevClef !== null && prevClef !== effectiveClef

    const showClef_mid    = clefChanged
    const showKeySig_mid  = keyChanged
    const showTimeSig_mid = sigChanged
    const showClef_start    = true
    const showKeySig_start  = effectiveKey.fifths !== 0
    const showTimeSig_start = mIdx === 0 || !timeSigsEqual(effectiveSig, prevSig!)

    let width_mid   = MIN_STAVE_WIDTH
    let width_start = MIN_STAVE_WIDTH
    for (const part of score.parts) {
      const isSeq   = (part as any).inputMode === 'sequencer'
      const pEvents = part.staves[0]?.measures[mIdx]?.voices[0]?.events ?? []
      width_mid   = Math.max(width_mid,   computeMeasureWidth(pEvents, effectiveSig, isSeq ? false : showClef_mid,   isSeq ? false : showKeySig_mid,   showTimeSig_mid,   effectiveKey))
      width_start = Math.max(width_start, computeMeasureWidth(pEvents, effectiveSig, isSeq ? false : showClef_start, isSeq ? false : showKeySig_start, showTimeSig_start, effectiveKey))
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
      const staffClefs       = partStaffClefs.get(staff.id)!
      const staffClef        = staffClefs[mIdx]
      const staffClefChanged = mIdx > 0 && staffClefs[mIdx - 1] !== staffClef
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
        const y = yBase + cumPartY[partIndex]
        const staveTopY = y + VEXFLOW_HEADROOM_PX
        const tc = (part as any).tabConfig as TabConfig | undefined
        const hasTab = tc && (part as any).showTab
        layouts.push({
          measureId:          staffMeasure.id,
          partId:             part.id,
          staffId:            staff.id,
          voiceId:            staffMeasure.voices[0]?.id ?? '',
          clef:               staffClef,
          transposeSemitones: part.transposeSemitones,
          x,
          staveTopY,
          staveY:             y,
          width,
          measureIndex:       m.mIdx,
          isLineStart:        m.isLineStart,
          showClef:           m.showClefMap.get(staff.id) ?? m.isLineStart,
          systemRow:          m.lineIndex,
          ...(hasTab ? {
            tabStaveY:      staveTopY + STAVE_HEIGHT_PX + TAB_GAP_PX,
            tabStringCount: tc!.stringCount,
          } : {}),
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

export interface RenderScoreResult {
  notePositions:    Map<string, number>
  noteStartX:       Map<string, number>   // key: `${partId}:${staffId}:${measureId}`
  layouts:          MeasureLayout[]
  noteToMeasureKey: Map<string, string>   // noteId → `${partId}:${staffId}:${measureId}`
}

export interface SelectedChordPitchInfo {
  eventId: string
  pitchIndex: number
}

// ── Multi-canvas rendering ─────────────────────────────────────────────────────
// VexFlow's canvas backend is hard-limited to 32767 physical pixels per dimension.
// For tall scores this limit is hit even at DPR=1.  The solution is to split the
// score across multiple stacked <canvas> elements — one per group of system rows.

export interface CanvasSlice {
  canvas: HTMLCanvasElement
  yOffset: number   // absolute score Y where this canvas starts
  height: number    // CSS pixel height of this canvas
}

export interface BarSelection {
  startMeasureIndex: number
  endMeasureIndex: number
  partIds: string[] | null  // null = all parts
}

/**
 * Returns the total canvas height needed for the given layouts.
 * Accounts for tab staves on the last row.
 */
export function computeTotalHeight(layouts: MeasureLayout[], options: RenderOptions): number {
  if (!layouts.length) return options.marginY + options.staveHeight
  let maxBottomY = 0
  for (const l of layouts) {
    const bottomY = l.tabStaveY !== undefined && l.tabStringCount !== undefined
      ? l.tabStaveY + (l.tabStringCount - 1) * LINE_SPACING_PX + TAB_BOTTOM_MARGIN_PX
      : l.staveY + options.staveHeight
    if (bottomY > maxBottomY) maxBottomY = bottomY
  }
  return maxBottomY + options.marginY
}

/**
 * Given a pre-computed layout, return the Y offsets at which new canvas slices
 * should start so that no single slice exceeds the browser's canvas height limit.
 * Returns [0] when the whole score fits in one canvas.
 */
export function computeSliceOffsets(
  layouts: MeasureLayout[],
  options: RenderOptions,
): number[] {
  if (!layouts.length) return [0]

  const totalHeight = computeTotalHeight(layouts, options)

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
  const maxSliceH = Math.floor(32767 / Math.max(1, dpr))
  if (totalHeight <= maxSliceH) return [0]

  // Use the systemRow field to identify row boundaries reliably (immune to variable part heights).
  const rowStartMap = new Map<number, number>()   // systemRow → min staveY in that row
  for (const l of layouts) {
    const existing = rowStartMap.get(l.systemRow)
    if (existing === undefined || l.staveY < existing) rowStartMap.set(l.systemRow, l.staveY)
  }
  const rowStartYs = [...rowStartMap.values()].sort((a, b) => a - b)

  const offsets: number[] = [0]
  let sliceStartY = 0
  for (let i = 0; i < rowStartYs.length; i++) {
    const rowEnd = i + 1 < rowStartYs.length ? rowStartYs[i + 1] : totalHeight
    if (rowEnd - sliceStartY > maxSliceH) {
      offsets.push(rowStartYs[i])
      sliceStartY = rowStartYs[i]
    }
  }
  return offsets
}

/**
 * Render a score across one or more canvas slices.
 * Each slice receives a Y-shifted subset of the layout so that no single canvas
 * exceeds the browser's physical-pixel height limit.
 *
 * Selection state (highlights, cursor, bar selection) is NOT drawn here — use
 * drawOverlay() on a separate overlay canvas after this call.
 *
 * Pass `precomputedLayouts` (from a prior `computeLayout` call) to avoid
 * recomputing the layout a second time.
 */
/**
 * Returns one Y-offset per system row, suitable for row-based canvas slicing.
 * This allows ScoreCanvas to allocate one canvas per visual row and re-render
 * only the rows containing changed measures.
 */
export function computeRowSliceOffsets(layouts: MeasureLayout[]): number[] {
  if (!layouts.length) return [0]
  const rowMinY = new Map<number, number>()
  for (const l of layouts) {
    const cur = rowMinY.get(l.systemRow)
    if (cur === undefined || l.staveY < cur) rowMinY.set(l.systemRow, l.staveY)
  }
  const rowStarts = [...rowMinY.entries()].sort((a, b) => a[0] - b[0]).map(([, y]) => y)
  // First offset must be 0 so the heading block (title/subtitle/composer, drawn
  // at canvas-local Y ≈ 0–80) is included in canvas 0 above the first stave.
  return [0, ...rowStarts.slice(1)]
}

export function renderScoreMulti(
  slices: readonly CanvasSlice[],
  score: Score,
  options: RenderOptions = DEFAULT_RENDER_OPTIONS,
  selectedChordPitchInfo: SelectedChordPitchInfo | null = null,
  precomputedLayouts?: MeasureLayout[],
  // When provided, maps are updated in-place rather than created fresh.
  // Use this for incremental renders to preserve entries for unchanged rows.
  existingMaps?: { notePositions: Map<string, number>; noteStartX: Map<string, number>; noteToMeasureKey: Map<string, string> },
): RenderScoreResult {
  const notePositions    = existingMaps?.notePositions    ?? new Map<string, number>()
  const noteStartX       = existingMaps?.noteStartX       ?? new Map<string, number>()
  const noteToMeasureKey = existingMaps?.noteToMeasureKey ?? new Map<string, string>()

  if (!score.parts[0] || !slices.length) return { notePositions, noteStartX, layouts: [], noteToMeasureKey }

  const layouts = precomputedLayouts ?? computeLayout(score, options)
  const totalHeight  = computeTotalHeight(layouts, options)

  for (let si = 0; si < slices.length; si++) {
    const slice      = slices[si]
    const nextOffset = si + 1 < slices.length ? slices[si + 1].yOffset : totalHeight

    // Shift layout Y coordinates to canvas-local space for this slice
    const sliceLayouts = computeSliceLayouts(layouts, slice.yOffset, nextOffset)

    const renderer = new VexRenderer(slice.canvas, VexRenderer.Backends.CANVAS)
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
    const effectiveDpr = Math.max(1, Math.min(dpr, Math.floor(32767 / slice.height)))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(renderer as any).ctx.resize(options.canvasWidth, slice.height, effectiveDpr)
    const ctx = renderer.getContext()
    ctx.clear()

    const lyricYMap = renderFromLayouts(
      ctx, score, sliceLayouts, new Set(), notePositions, noteStartX, noteToMeasureKey, selectedChordPitchInfo,
    )
    if (slice.yOffset === 0) drawHeadings(ctx, score, options)

    const nativeCtx = slice.canvas.getContext('2d')
    // Draw lyric text with no cursor (cursor highlight goes to the overlay canvas)
    if (nativeCtx) drawAllLyrics(nativeCtx, score, notePositions, sliceLayouts, null, lyricYMap)
  }

  return { notePositions, noteStartX, layouts, noteToMeasureKey }
}

/**
 * Filter and Y-shift layouts to the local coordinate space of one canvas slice.
 */
export function computeSliceLayouts(
  allLayouts: MeasureLayout[],
  yOffset: number,
  nextOffset: number,
): MeasureLayout[] {
  return allLayouts
    .filter(l => l.staveY >= yOffset && l.staveY < nextOffset)
    .map(l => ({
      ...l,
      staveY:    l.staveY    - yOffset,
      staveTopY: l.staveTopY - yOffset,
      ...(l.tabStaveY !== undefined ? { tabStaveY: l.tabStaveY - yOffset } : {}),
    }))
}

/**
 * Draw selection/cursor overlays onto an overlay canvas that is stacked on top
 * of the corresponding base canvas slice.  The overlay canvas must have the
 * same physical dimensions as the base canvas.
 *
 * All coordinates in `sliceLayouts` must already be in slice-local space
 * (i.e. passed through computeSliceLayouts first).
 */
export function drawOverlay(
  canvas: HTMLCanvasElement,
  sliceLayouts: MeasureLayout[],
  score: Score,
  notePositions: Map<string, number>,
  noteToMeasureKey: Map<string, string>,
  noteStartX: Map<string, number>,
  selectedNoteIds: ReadonlySet<string>,
  cursor: RenderCursorOptions | null,
  selectedMeasureId: string | null,
  lyricCursorNoteId: string | null,
  barSelection: BarSelection | null,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)

  if (barSelection)       drawBarSelection(canvas, barSelection, sliceLayouts)
  if (selectedMeasureId)  drawMeasureHighlight(canvas, selectedMeasureId, sliceLayouts)

  // Note selection: single spanning rectangle per visual row
  if (selectedNoteIds.size > 0) {
    ctx.save()
    // Group by (partId, staffId, staveTopY) — each unique staveTopY is one visual row
    type RowGroup = { minX: number; maxX: number; layout: MeasureLayout }
    const rowGroups = new Map<string, RowGroup>()
    for (const noteId of selectedNoteIds) {
      const noteX = notePositions.get(noteId)
      if (noteX === undefined) continue
      const measureKey = noteToMeasureKey.get(noteId)
      if (!measureKey) continue
      const colonA = measureKey.indexOf(':')
      const colonB = measureKey.indexOf(':', colonA + 1)
      const partId   = measureKey.slice(0, colonA)
      const staffId  = measureKey.slice(colonA + 1, colonB)
      const measureId = measureKey.slice(colonB + 1)
      const layout = sliceLayouts.find(l => l.partId === partId && l.staffId === staffId && l.measureId === measureId)
      if (!layout) continue
      const key = `${partId}:${staffId}:${layout.staveTopY}`
      const existing = rowGroups.get(key)
      if (existing) {
        existing.minX = Math.min(existing.minX, noteX)
        existing.maxX = Math.max(existing.maxX, noteX)
      } else {
        rowGroups.set(key, { minX: noteX, maxX: noteX, layout })
      }
    }
    ctx.fillStyle   = 'rgba(59, 157, 221, 0.20)'
    ctx.strokeStyle = 'rgba(59, 157, 221, 0.50)'
    ctx.lineWidth   = 1
    for (const { minX, maxX, layout } of rowGroups.values()) {
      const rx = minX - 8
      const ry = layout.staveTopY - 8
      const rw = (maxX + 8) - (minX - 8)
      const rh = STAVE_HEIGHT_PX + 16
      ctx.fillRect(rx, ry, rw, rh)
      ctx.strokeRect(rx, ry, rw, rh)
    }
    ctx.restore()
  }

  if (cursor?.cursorMeasureId) drawCursor(canvas, cursor, sliceLayouts, score, notePositions, noteStartX)

  // Lyric cursor underline (the rest of lyric text is drawn in the base render)
  if (lyricCursorNoteId) {
    const x = notePositions.get(lyricCursorNoteId)
    if (x !== undefined) {
      const mKey = noteToMeasureKey.get(lyricCursorNoteId)
      if (mKey) {
        const colonA   = mKey.indexOf(':')
        const colonB   = mKey.indexOf(':', colonA + 1)
        const layout   = sliceLayouts.find(l =>
          l.partId === mKey.slice(0, colonA) &&
          l.staffId === mKey.slice(colonA + 1, colonB) &&
          l.measureId === mKey.slice(colonB + 1)
        )
        if (layout) {
          const lyricY = layout.staveTopY + LYRIC_Y_OFFSET
          ctx.save()
          ctx.strokeStyle = '#0e639c'
          ctx.lineWidth   = 1.5
          ctx.beginPath()
          ctx.moveTo(x - 12, lyricY + 3)
          ctx.lineTo(x + 12, lyricY + 3)
          ctx.stroke()
          ctx.restore()
        }
      }
    }
  }
}

// ── Single-canvas entry point (kept for backward compatibility / export use) ───

export function renderScore(
  canvas: HTMLCanvasElement,
  score: Score,
  options: RenderOptions = DEFAULT_RENDER_OPTIONS,
  selectedNoteIds: ReadonlySet<string> = new Set(),
  cursor: RenderCursorOptions | null = null,
  selectedMeasureId: string | null = null,
  lyricCursorNoteId: string | null = null,
  selectedChordPitchInfo: SelectedChordPitchInfo | null = null
): RenderScoreResult {
  const layouts = computeLayout(score, options)
  const totalHeight = computeTotalHeight(layouts, options)
  const slice: CanvasSlice = { canvas, yOffset: 0, height: totalHeight }
  const result = renderScoreMulti([slice], score, options, selectedChordPitchInfo, layouts)
  // For single-canvas use, draw overlays directly onto the same canvas
  const sliceLocalLayouts = computeSliceLayouts(layouts, 0, totalHeight)
  drawOverlay(canvas, sliceLocalLayouts, score, result.notePositions, result.noteToMeasureKey,
    result.noteStartX, selectedNoteIds, cursor, selectedMeasureId, lyricCursorNoteId, null)
  return result
}

// ── Tab staff renderer ────────────────────────────────────────────────────────
// Draws the tab staff for one measure using pre-computed note X positions.
// All string lines, barlines, fret numbers, and the TAB label are drawn with
// the native Canvas2D API so no VexFlow layout pass is needed.

function drawTabMeasure(
  nCtx: CanvasRenderingContext2D,
  layout: MeasureLayout,
  measure: Measure,
  tabStaveY: number,
  stringCount: number,
  tabConfig: TabConfig,
  transposeSemitones: number,
  notePositions: Map<string, number>,
): void {
  const { x, width, isLineStart } = layout
  const stringSpacing = LINE_SPACING_PX
  const tabBottom     = tabStaveY + (stringCount - 1) * stringSpacing

  nCtx.save()

  // ── String lines ───────────────────────────────────────────────────────────
  nCtx.strokeStyle = '#555'
  nCtx.lineWidth   = 0.8
  for (let s = 0; s < stringCount; s++) {
    const lineY = tabStaveY + s * stringSpacing
    nCtx.beginPath()
    nCtx.moveTo(x, lineY)
    nCtx.lineTo(x + width, lineY)
    nCtx.stroke()
  }

  // ── Barlines ───────────────────────────────────────────────────────────────
  const drawVBar = (bx: number, lw = 1) => {
    nCtx.strokeStyle = '#555'
    nCtx.lineWidth   = lw
    nCtx.beginPath()
    nCtx.moveTo(bx, tabStaveY)
    nCtx.lineTo(bx, tabBottom)
    nCtx.stroke()
  }

  drawVBar(x)  // left barline
  const barline = measure.barline ?? 'single'
  if (barline === 'final') {
    drawVBar(x + width - 2, 1)
    drawVBar(x + width,     3)
  } else if (barline === 'double' || barline === 'repeat-end') {
    drawVBar(x + width - 3, 1)
    drawVBar(x + width,     1)
  } else {
    drawVBar(x + width, 1)
  }

  // ── TAB label (line-start measures only) ───────────────────────────────────
  if (isLineStart) {
    nCtx.font        = 'bold 10px sans-serif'
    nCtx.fillStyle   = '#555'
    nCtx.textAlign   = 'center'
    nCtx.textBaseline = 'middle'
    const labelX = x - 16
    const midY   = tabStaveY + (stringCount - 1) * stringSpacing / 2
    const letters = ['T', 'A', 'B']
    const yStep   = Math.min(stringSpacing, 11)
    const totalH  = (letters.length - 1) * yStep
    letters.forEach((ch, i) => nCtx.fillText(ch, labelX, midY - totalH / 2 + i * yStep))
  }

  // ── Fret numbers ───────────────────────────────────────────────────────────
  const events = measure.voices[0]?.events ?? []

  nCtx.font          = '9px monospace'
  nCtx.textAlign     = 'center'
  nCtx.textBaseline  = 'middle'

  for (const event of events) {
    if (event.type === 'rest') continue
    const noteX = notePositions.get(event.id)
    if (noteX === undefined) continue

    let positions: Array<{ string: number; fret: number } | null>

    if (event.type === 'note') {
      const midi = pitchToMidi(event.pitch.noteName, event.pitch.octave, event.pitch.accidental) - transposeSemitones
      positions = [pitchToTabPosition(midi, tabConfig)]
    } else {
      // chord — map pitches to MIDI, subtract transposeSemitones
      const midis = event.pitches.map(p =>
        pitchToMidi(p.noteName, p.octave, p.accidental) - transposeSemitones
      )
      positions = chordToTabPositions(midis, tabConfig)
    }

    for (const pos of positions) {
      if (!pos) continue
      // pos.string: 1 = highest/thinnest string (top line of tab)
      const lineIdx = pos.string - 1   // 0 = top string line
      const lineY   = tabStaveY + lineIdx * stringSpacing
      const txt     = String(pos.fret)
      const tw      = nCtx.measureText(txt).width
      const pad     = 2
      // White background to erase the string line beneath the number
      nCtx.fillStyle = '#ffffff'
      nCtx.fillRect(noteX - tw / 2 - pad, lineY - 5.5, tw + pad * 2, 11)
      nCtx.fillStyle = '#111'
      nCtx.fillText(txt, noteX, lineY)
    }
  }

  nCtx.restore()
}

// ── Render all measures from precomputed layouts ──────────────────────────────

export function renderFromLayouts(
  ctx: RenderContext,
  score: Score,
  layouts: MeasureLayout[],
  selectedNoteIds: ReadonlySet<string>,
  notePositions: Map<string, number>,
  noteStartX: Map<string, number>,
  noteToMeasureKey: Map<string, string>,
  selectedChordPitchInfo: SelectedChordPitchInfo | null = null
): Map<string, number> {   // returns measureId → lyricY
  // Build fast lookup: staffId → staff / part
  type StaffEntry = { staff: Staff; part: Part }
  const staffMap = new Map<string, StaffEntry>()
  for (const part of score.parts) {
    for (const staff of part.staves) {
      staffMap.set(staff.id, { staff, part })
    }
  }

  // Pre-compute per-staff resolved time/key sigs — single forward pass per staff,
  // O(n) total instead of O(n²) repeated backward scans in the main loop.
  const staffTimeSigsMap = new Map<string, TimeSignature[]>()
  const staffKeySigsMap  = new Map<string, KeySignature[]>()
  for (const [staffId, { staff }] of staffMap.entries()) {
    const timeSigs: TimeSignature[] = []
    const keySigs: KeySignature[]   = []
    let ts: TimeSignature = score.timeSignature
    let ks: KeySignature  = score.keySignature
    for (const m of staff.measures) {
      if (m.timeSignature) ts = m.timeSignature
      if (m.keySignature)  ks = m.keySignature
      timeSigs.push(ts)
      keySigs.push(ks)
    }
    staffTimeSigsMap.set(staffId, timeSigs)
    staffKeySigsMap.set(staffId, keySigs)
  }

  // ── Pre-pass: row max note overhang for row-consistent below-stave positioning
  // Keyed by staveY so all measures in the same row use the same pedal/MIDI baseline.
  const rowOverhangMap = new Map<number, number>()
  for (const layout of layouts) {
    const entry = staffMap.get(layout.staffId)
    if (!entry) continue
    const mIdx = layout.measureIndex
    const overhang = lowestNoteOverhangPx(entry.staff.measures[mIdx], layout.clef)
    rowOverhangMap.set(layout.staveY, Math.max(rowOverhangMap.get(layout.staveY) ?? 0, overhang))
  }

  const measureLyricY = new Map<string, number>()

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

    const mIdx    = layout.measureIndex
    const measure = staff.measures[mIdx]
    if (!measure) continue
    const prevMeasure = staff.measures[mIdx - 1]

    const keySigs      = staffKeySigsMap.get(layout.staffId)!
    const timeSigs     = staffTimeSigsMap.get(layout.staffId)!
    const effectiveKey = keySigs[mIdx]
    const prevKey      = mIdx > 0 ? keySigs[mIdx - 1]  : null
    const effectiveSig = timeSigs[mIdx]
    const prevSig      = mIdx > 0 ? timeSigs[mIdx - 1] : null

    // Volta bracket for this measure (first part only — one bracket per system)
    const voltaOpts = (part === score.parts[0])
      ? resolveVoltaOpts(layout.measureIndex, score.voltas ?? [])
      : undefined

    const isSequencer = (part as any).inputMode === 'sequencer'

    const { stave, staveNotes, events } = renderMeasure(
      ctx, measure, prevMeasure,
      effectiveKey, prevKey,
      effectiveSig, prevSig, score.timeSignature,
      layout.clef, layout.transposeSemitones,
      layout.x, layout.staveY, layout.width,
      layout.measureIndex, layout.isLineStart, layout.showClef,
      selectedNoteIds, notePositions,
      voltaOpts, selectedChordPitchInfo,
      isSequencer
    )

    const measureKey = `${layout.partId}:${layout.staffId}:${layout.measureId}`
    events.forEach((e, i) => {
      staveNoteMap.set(e.id, staveNotes[i])
      eventStaveMap.set(e.id, stave)
      noteToMeasureKey.set(e.id, measureKey)
    })

    const staveNoteStartX = stave.getNoteStartX()
    noteStartX.set(measureKey, staveNoteStartX)

    // Sequencer parts: draw mini-grid overlay on top of the normal stave rendering
    if ((part as any).inputMode === 'sequencer') {
      const nativeCtxSeq: CanvasRenderingContext2D | null =
        typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null
      if (nativeCtxSeq) {
        const assignments = (part as any).sequenceAssignments ?? []
        const patterns    = (part as any).sequencePatterns    ?? []
        const activeAssignment = activeAssignmentAt(assignments, mIdx)
        const pattern: SequencePattern | null = (activeAssignment?.patternId)
          ? patterns.find((p: any) => p.id === activeAssignment.patternId) ?? null
          : null
        const isAssignmentStart = assignments.some((a: any) => a.startMeasureIndex === mIdx && a.patternId !== null)
        const patternIdx = pattern ? patterns.indexOf(pattern) : -1
        const regionLabel = pattern?.label ?? (patternIdx >= 0 ? `Sequence ${patternIdx + 1}` : undefined)
        drawSequencerMeasureOverlay(nativeCtxSeq, layout, staveNoteStartX, pattern, isAssignmentStart, regionLabel)
      }
    }

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

    // ── Below-stave Y positions ─────────────────────────────────────────────
    // Use the greater of the pitch-based row overhang (consistent within the row)
    // and the actual stem extents for this measure (so downward stems don't clash).
    // VexFlow: topY = stem tip (large Y for stem-down), baseY = notehead side.
    const rowOverhang  = rowOverhangMap.get(layout.staveY) ?? 0
    const staveBottom  = layout.staveTopY + STAVE_HEIGHT_PX
    let   measureMaxStemY = staveBottom
    for (const sn of staveNotes) {
      try {
        const ext = sn.getStemExtents()
        measureMaxStemY = Math.max(measureMaxStemY, Math.max(ext.topY, ext.baseY))
      } catch { /* no stem */ }
    }
    const stemOverhang     = Math.max(0, measureMaxStemY - staveBottom)
    const effectiveOverhang = Math.max(rowOverhang, stemOverhang)
    const pedalY       = staveBottom + Math.max(PEDAL_BASE_BELOW_STAVE, effectiveOverhang + 26)
    const midiY        = pedalY + MIDI_BELOW_PEDAL
    const rawLyricY    = staveBottom + Math.max(LYRIC_BASE_BELOW_STAVE, effectiveOverhang + 8)
    const lyricY       = Math.min(rawLyricY, pedalY - 18)
    measureLyricY.set(layout.measureId, lyricY)

    drawDirectives(ctx, layout, measure, staff, score, part === score.parts[0], stave.getNoteStartX(), pedalY)
    // Pedal marks below the stave
    if (measure.pedalMarks?.length) {
      drawPedalMarks(ctx, layout, measure, staff, score, stave.getNoteStartX(), pedalY)
    }
    // MIDI score events below the stave
    if (measure.midiEvents?.length) {
      drawMidiEvents(ctx, layout, measure, staff, score, stave.getNoteStartX(), midiY)
    }
    // Note-attached dynamics below the stave
    if (staveNotes.length > 0) {
      drawNoteDynamics(ctx, staveNotes, events, pedalY)
    }

    // ── Tab staff ────────────────────────────────────────────────────────────
    if (layout.tabStaveY !== undefined && layout.tabStringCount !== undefined) {
      const nCtxTab: CanvasRenderingContext2D | null =
        typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null
      const tabCfg = (part as any).tabConfig as TabConfig | undefined
      if (nCtxTab && tabCfg) {
        drawTabMeasure(
          nCtxTab, layout, measure,
          layout.tabStaveY, layout.tabStringCount, tabCfg,
          part.transposeSemitones, notePositions,
        )
      }
    }
  }

  // ── Second pass: group connectors (brackets, braces, barline spans) ─────────
  drawGroupConnectors(ctx, score, partStaveTop, partStaveBottom, mIdxIsLineStart)

  // ── Third pass: ties and slurs ──────────────────────────────────────────────
  const nativeCtx: CanvasRenderingContext2D | null =
    typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null

  for (const part of score.parts) {
    for (const staff of part.staves) {
      drawTiesForStaff(ctx, staff, staveNoteMap, eventStaveMap)
      if (nativeCtx) {
        drawSlursForStaff(nativeCtx, staff, staveNoteMap, eventStaveMap)
        drawHairpinsForStaff(nativeCtx, staff, staveNoteMap, eventStaveMap)
      }
    }
  }

  return measureLyricY
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
  noteStartX: number,
  pedalY: number,
): void {
  const nativeCtx: CanvasRenderingContext2D | null =
    typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null
  if (!nativeCtx) return

  const mIdx = layout.measureIndex
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

  // ── Dynamic (below stave, left-aligned at note start) ─────────────────────
  const dynDirs = directives.filter(d => d.category === 'dynamic')
  if (dynDirs.length > 0) {
    nativeCtx.font      = 'bold italic 13px Edwin, serif'
    nativeCtx.fillStyle = '#111'
    nativeCtx.textAlign = 'left'
    nativeCtx.fillText(dynDirs.map(d => d.text).join(' '), noteStartX, pedalY - 14)
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
  staveNotes: StaveNote[],
  events: NoteEvent[],
  pedalY: number,
): void {
  const nativeCtx: CanvasRenderingContext2D | null =
    typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null
  if (!nativeCtx) return

  // pedalY is already stem-aware (computed in the main loop using getStemExtents).
  // Place dynamics 14px above the pedal baseline (which already clears stem tips).
  const y = pedalY - 14

  nativeCtx.save()
  nativeCtx.font      = 'bold italic 13px Edwin, serif'
  nativeCtx.fillStyle = '#111'
  nativeCtx.textAlign = 'left'
  nativeCtx.textBaseline = 'alphabetic'

  events.forEach((event, i) => {
    const dynamic = (event as any).dynamic as DynamicLevel | undefined
    if (!dynamic) return
    const x = staveNotes[i].getAbsoluteX()
    nativeCtx.fillText(dynamic, x, y)
  })

  nativeCtx.restore()
}

// ── Draw pedal marks for one measure ─────────────────────────────────────────

function drawPedalMarks(
  ctx: RenderContext,
  layout: MeasureLayout,
  measure: Measure,
  staff: Staff,
  score: Score,
  noteStartX: number,
  pedalY: number,
): void {
  const nativeCtx: CanvasRenderingContext2D | null =
    typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null
  if (!nativeCtx) return

  const marks = measure.pedalMarks ?? []
  if (marks.length === 0) return

  const mIdx        = staff.measures.findIndex(m => m.id === measure.id)
  const timeSig     = resolveTimeSig(staff.measures, mIdx, score.timeSignature)
  const capacity    = measureCapacityUnits(timeSig)
  const noteAreaWidth = layout.x + layout.width - noteStartX
  const y = pedalY

  nativeCtx.save()
  // U+E650 = keyboardPedalPed, U+E655 = keyboardPedalUp (SMuFL, Bravura loaded by VexFlow)
  nativeCtx.font          = '16px Bravura, Academico'
  nativeCtx.fillStyle     = '#2a2a8a'
  nativeCtx.textBaseline  = 'alphabetic'
  nativeCtx.textAlign     = 'left'

  for (const mark of marks) {
    const x = noteStartX + (mark.beatPosition / capacity) * noteAreaWidth
    nativeCtx.fillText(mark.type === 'down' ? '' : '', x, y)
  }

  nativeCtx.restore()
}

// ── Draw MIDI score events for one measure ────────────────────────────────────

function midiEventLabel(e: MidiScoreEvent): string {
  switch (e.type) {
    case 'cc':    return `CC${e.cc!.controller}:${e.cc!.value}`
    case 'pc':    return `PC${e.pc!.program}`
    case 'pb':    return `PB${e.pb!.value >= 0 ? '+' : ''}${e.pb!.value}`
    case 'sysex': return 'SysEx'
  }
}

function drawMidiEvents(
  ctx: RenderContext,
  layout: MeasureLayout,
  measure: Measure,
  staff: Staff,
  score: Score,
  noteStartX: number,
  midiY: number,
): void {
  const nativeCtx: CanvasRenderingContext2D | null =
    typeof (ctx as any).context2D !== 'undefined' ? (ctx as any).context2D : null
  if (!nativeCtx) return

  const events = measure.midiEvents ?? []
  if (events.length === 0) return

  const mIdx    = staff.measures.findIndex(m => m.id === measure.id)
  const timeSig = resolveTimeSig(staff.measures, mIdx, score.timeSignature)
  const capacity = measureCapacityUnits(timeSig)
  const noteAreaWidth = layout.x + layout.width - noteStartX
  const y = midiY

  nativeCtx.save()
  nativeCtx.font          = '9px monospace'
  nativeCtx.textBaseline  = 'middle'
  nativeCtx.textAlign     = 'left'

  for (const e of events) {
    const x = noteStartX + (e.beatPosition / capacity) * noteAreaWidth
    const label = midiEventLabel(e)
    const textW = nativeCtx.measureText(label).width

    nativeCtx.fillStyle = 'rgba(0,0,0,0.55)'
    nativeCtx.fillRect(x - 1, y - 7, textW + 4, 14)

    nativeCtx.fillStyle = '#4EC9B0'
    nativeCtx.fillText(label, x + 1, y)
  }

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
  voltaOpts?: VoltaOpts,
  selectedChordPitchInfo?: SelectedChordPitchInfo | null,
  sequencerMode?: boolean
): MeasureRenderResult {
  const stave = new Stave(x, y, width)

  const keyChanged  = prevKey !== null && prevKey.fifths !== effectiveKey.fifths
  const sigChanged  = prevSig !== null && !timeSigsEqual(effectiveSig, prevSig)

  // Written key for this part (transposed from concert key)
  const writtenFifths = transposeKeyFifths(effectiveKey.fifths, transposeSemitones)

  // Clef: full size at system starts, small size for mid-score changes. Suppressed for sequencer rows.
  if (showClef && !sequencerMode) {
    if (isLineStart) {
      stave.addClef(clefType)
    } else {
      stave.addClef(clefType, 'small')
    }
  }

  // Key sig: show at system starts (if non-C in written key) and when concert key changes. Suppressed for sequencer rows and percussion staves.
  const showKeySig = ((isLineStart && writtenFifths !== 0) || keyChanged) && !sequencerMode && clefType !== 'percussion'
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

  // Sequencer rows: erase the five staff lines VexFlow just drew and replace with a
  // plain track band + midline. All note/rest rendering is then skipped entirely.
  if (sequencerMode) {
    const nCtx = typeof (ctx as any).context2D !== 'undefined'
      ? (ctx as any).context2D as CanvasRenderingContext2D
      : null
    if (nCtx) {
      const topY = y + VEXFLOW_HEADROOM_PX
      nCtx.save()
      nCtx.fillStyle = '#ffffff'
      nCtx.fillRect(x + 1, topY, width - 1, STAVE_HEIGHT_PX)
      nCtx.fillStyle = 'rgba(0,0,0,0.06)'
      nCtx.fillRect(x + 1, topY, width - 1, STAVE_HEIGHT_PX)
      nCtx.strokeStyle = 'rgba(0,0,0,0.18)'
      nCtx.lineWidth = 1
      nCtx.beginPath()
      const mid = topY + STAVE_HEIGHT_PX / 2
      nCtx.moveTo(x + 1, mid)
      nCtx.lineTo(x + width, mid)
      nCtx.stroke()
      nCtx.restore()
    }
    return { stave, staveNotes: [], events: [] as NoteEvent[] }
  }

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
    const dispAcc0 = computeDisplayAccidentals(events0, writtenFifths)
    const dispAcc1 = computeDisplayAccidentals(events1, writtenFifths)
    const sns0 = events0.map(e => noteEventToStaveNote(e, selectedNoteIds.has(e.id), clefType, 1, undefined,
      selectedChordPitchInfo?.eventId === e.id ? selectedChordPitchInfo.pitchIndex : undefined,
      dispAcc0.get(e.id)))
    const sns1 = events1.map(e => noteEventToStaveNote(e, selectedNoteIds.has(e.id), clefType, -1, '#2d8f4e',
      selectedChordPitchInfo?.eventId === e.id ? selectedChordPitchInfo.pitchIndex : undefined,
      dispAcc1.get(e.id)))

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

  const dispAcc = computeDisplayAccidentals(events, writtenFifths)
  const staveNotes = events.map(e => noteEventToStaveNote(e, selectedNoteIds.has(e.id), clefType, stemDir, noteColor,
    selectedChordPitchInfo?.eventId === e.id ? selectedChordPitchInfo.pitchIndex : undefined,
    dispAcc.get(e.id)))
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
// Uses VexFlow StaveTie. When source and destination notes sit on the same
// visual row (matching stave Y), a single StaveTie spans the barline so the
// arc is continuous. Split partial arcs are only used when the tie crosses
// onto a different row.

function drawTiesForStaff(
  ctx: RenderContext,
  staff: Staff,
  staveNoteMap: Map<string, StaveNote>,
  eventStaveMap: Map<string, Stave>,
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
        for (let j = eIdx + 1; j < events.length; j++) {
          if (events[j].type === 'note') { destNote = events[j] as Note; break }
        }
        if (!destNote && mIdx + 1 < staff.measures.length) {
          for (const e of staff.measures[mIdx + 1].voices[vIdx]?.events ?? []) {
            if (e.type === 'note') { destNote = e as Note; break }
          }
        }

        const dstSN = destNote ? staveNoteMap.get(destNote.id) ?? null : null

        const srcStave = eventStaveMap.get(note.id)
        const dstStave = destNote ? eventStaveMap.get(destNote.id) : undefined
        const sameRow  = srcStave && dstStave && Math.abs(srcStave.getY() - dstStave.getY()) < 2

        if (sameRow && dstSN) {
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

    // Auto-detect from start note's stem direction: stem-up → slur below, stem-down → slur above
    const stemUp  = fromSN.getStemDirection() === 1
    const above   = slur.placement != null ? slur.placement === 'above' : !stemUp
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

    // Same visual row if stave Y positions match (each measure has its own Stave object,
    // so fromStave === toStave only holds within a single measure; use Y to detect same row)
    const sameRow = Math.abs(fromStave.getY() - toStave.getY()) < 2

    ctx2d.save()
    ctx2d.strokeStyle = '#111'
    ctx2d.lineWidth   = 1.5

    if (sameRow) {
      // Single continuous arc across however many barlines on the same row.
      // Cap arc height so long multi-bar slurs don't over-curve.
      const span = x2 - x1
      const arc  = sign * Math.min(30, Math.max(10, span * 0.08))
      const midX = (x1 + x2) / 2
      const midY = (y1 + y2) / 2
      ctx2d.beginPath()
      ctx2d.moveTo(x1, y1)
      ctx2d.quadraticCurveTo(midX, midY + arc, x2, y2)
      ctx2d.stroke()
    } else {
      // Cross-row: arc from start note to right edge of its row, then
      // arc from left edge of destination row to end note.
      const rightEdge = fromStave.getX() + fromStave.getWidth()
      const arc1 = sign * Math.max(10, (rightEdge - x1) * 0.15)
      ctx2d.beginPath()
      ctx2d.moveTo(x1, y1)
      ctx2d.quadraticCurveTo((x1 + rightEdge) / 2, y1 + arc1, rightEdge, y1)
      ctx2d.stroke()
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
// the stem extents of all notes in the hairpin range so beamed/downward stems
// don't overlap the wedge.
// VexFlow Stem.getExtents(): topY = stem TIP (large Y for stem-down), baseY = notehead side.
// Using Math.max(topY, baseY) gives the lowest canvas point regardless of stem direction.
function hairpinY(
  staff: Staff,
  fromNoteId: string,
  toNoteId: string,
  staveNoteMap: Map<string, StaveNote>,
  defaultY: number,
): number {
  // Find measure-level range for the hairpin
  let fromMIdx = -1, toMIdx = staff.measures.length - 1
  for (let mi = 0; mi < staff.measures.length; mi++) {
    for (const voice of staff.measures[mi].voices) {
      for (const ev of voice.events) {
        if (ev.id === fromNoteId) fromMIdx = mi
        if (ev.id === toNoteId)   toMIdx   = mi
      }
    }
  }
  if (fromMIdx === -1) return defaultY

  let maxY = defaultY
  for (let mi = fromMIdx; mi <= toMIdx; mi++) {
    for (const voice of staff.measures[mi].voices) {
      for (const ev of voice.events) {
        if (ev.type === 'rest') continue
        const sn = staveNoteMap.get(ev.id)
        if (!sn) continue
        try {
          const ext = sn.getStemExtents()
          maxY = Math.max(maxY, Math.max(ext.topY, ext.baseY) + 8)
        } catch { /* no stem */ }
      }
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
      const y2 = hairpinY(staff, hairpin.fromNoteId, hairpin.toNoteId, staveNoteMap, defaultY2)

      drawHairpinWedge(ctx2d, x1, rightEdge, y1, isCrescendo, 0, splitFrac)
      drawHairpinWedge(ctx2d, leftEdge, x2, y2, isCrescendo, splitFrac, 1)
    }

    ctx2d.restore()
  }
}

// ── Sequencer measure overlay ─────────────────────────────────────────────────
// Draws a dimmed fill over the stave body and a mini step-grid thumbnail
// showing which steps have active cells.

function drawSequencerMeasureOverlay(
  nativeCtx: CanvasRenderingContext2D,
  layout: MeasureLayout,
  noteStartX: number,
  pattern: SequencePattern | null,
  isRegionStart?: boolean,
  regionLabel?: string,
): void {
  const noteAreaLeft  = noteStartX
  const noteAreaRight = layout.x + layout.width - 2
  const noteAreaW     = noteAreaRight - noteAreaLeft
  const top    = layout.staveTopY
  const height = STAVE_HEIGHT_PX

  nativeCtx.save()

  // The white band + midline were already drawn by renderMeasure; this overlay
  // previously dimmed VexFlow stave lines but that's no longer needed.
  nativeCtx.fillStyle = 'rgba(0,0,0,0)'
  nativeCtx.fillRect(noteAreaLeft, top, noteAreaW, height)

  // Sequence label: drawn above the band at the first bar of each region
  if (isRegionStart && regionLabel) {
    nativeCtx.font = 'bold 10px sans-serif'
    nativeCtx.fillStyle = '#3b9ddd'
    nativeCtx.textAlign = 'left'
    nativeCtx.fillText(regionLabel, noteAreaLeft, top - 5)
  }

  if (pattern && pattern.stepsPerBar > 0 && noteAreaW > 0) {
    const steps = pattern.stepsPerBar
    const cellW = noteAreaW / steps

    // Determine pitch range from active cells
    const allPitches = pattern.steps.flatMap(col => col.map(c => c.pitch))
    if (allPitches.length > 0) {
      const minP = Math.min(...allPitches)
      const maxP = Math.max(...allPitches)
      const range = Math.max(1, maxP - minP)

      for (let step = 0; step < steps; step++) {
        const cells = pattern.steps[step]
        if (!cells || cells.length === 0) continue
        for (const cell of cells) {
          const normY = 1 - (cell.pitch - minP) / range   // 0 = bottom, 1 = top
          const cellH = Math.max(2, height / Math.max(steps, 8))
          const cellX = noteAreaLeft + step * cellW
          const cellY = top + normY * (height - cellH)
          nativeCtx.fillStyle = 'rgba(59,157,221,0.6)'
          nativeCtx.fillRect(cellX + 1, cellY, Math.max(1, cellW - 1), cellH)
        }
      }
    } else {
      // No active cells — just draw faint column dividers
      nativeCtx.strokeStyle = 'rgba(0,0,0,0.08)'
      nativeCtx.lineWidth = 0.5
      for (let step = 1; step < steps; step++) {
        const x = noteAreaLeft + step * cellW
        nativeCtx.beginPath()
        nativeCtx.moveTo(x, top)
        nativeCtx.lineTo(x, top + height)
        nativeCtx.stroke()
      }
    }
  }

  nativeCtx.restore()
}

// ── Cursor overlay ────────────────────────────────────────────────────────────

export const LINE_SPACING_PX        = 10
export const STAVE_HEIGHT_PX        = 4 * LINE_SPACING_PX
export const TAB_GAP_PX             = 12   // gap between std-stave bottom and first tab string
export const TAB_BOTTOM_MARGIN_PX   = 10   // space below last tab string

// ── Below-stave layout constants ─────────────────────────────────────────────
// Stack order from stave bottom: lyrics → note dynamics → pedal marks → MIDI events.
// PEDAL_BASE_BELOW_STAVE and LYRIC_Y_OFFSET are exported for ScoreCanvas hit-zone sizing.
export const LYRIC_Y_OFFSET          = 56  // fallback lyric baseline: px below staveTopY
export const PEDAL_BASE_BELOW_STAVE  = 34  // pedal baseline offset from staveBottom (no overhang)
const        MIDI_BELOW_PEDAL        = 22  // MIDI label center below pedalY
const        LYRIC_BASE_BELOW_STAVE  = 16  // lyric baseline offset from staveBottom (no overhang)

// ── Lyric rendering ───────────────────────────────────────────────────────────

function drawAllLyrics(
  ctx2d: CanvasRenderingContext2D,
  score: Score,
  notePositions: Map<string, number>,
  layouts: MeasureLayout[],
  lyricCursorNoteId: string | null,
  lyricYMap: Map<string, number>,
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
        const lyricY = lyricYMap.get(measure.id) ?? (layout.staveTopY + LYRIC_Y_OFFSET)

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

function drawBarSelection(
  canvas: HTMLCanvasElement,
  barSelection: BarSelection,
  layouts: MeasureLayout[]
): void {
  const { startMeasureIndex, endMeasureIndex, partIds } = barSelection
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) return

  const partSet = partIds ? new Set(partIds) : null
  const grouped = new Map<number, MeasureLayout[]>()

  for (const l of layouts) {
    if (l.measureIndex < startMeasureIndex || l.measureIndex > endMeasureIndex) continue
    if (partSet && !partSet.has(l.partId)) continue
    const col = grouped.get(l.measureIndex) ?? []
    col.push(l)
    grouped.set(l.measureIndex, col)
  }

  ctx2d.save()
  ctx2d.fillStyle   = 'rgba(33, 150, 243, 0.10)'
  ctx2d.strokeStyle = 'rgba(33, 150, 243, 0.45)'
  ctx2d.lineWidth   = 1.5

  for (const colLayouts of grouped.values()) {
    if (!colLayouts.length) continue
    const top    = Math.min(...colLayouts.map(l => l.staveTopY)) - 8
    const bottom = Math.max(...colLayouts.map(l => l.staveTopY)) + STAVE_HEIGHT_PX + 8
    const left   = colLayouts[0].x
    const width  = colLayouts[0].width
    ctx2d.fillRect(left, top, width, bottom - top)
    ctx2d.strokeRect(left, top, width, bottom - top)
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
  layouts: MeasureLayout[],
  score: Score,
  notePositions: Map<string, number>,
  noteStartX: Map<string, number>
): void {
  const layout = layouts.find(l => l.measureId === cursor.cursorMeasureId)
  if (!layout) return

  // Prefer the actual VexFlow-rendered X of the note/rest at the cursor beat.
  // VexFlow spaces notes non-linearly (minimum widths, beaming, etc.), so a
  // simple linear fraction produces visible misalignment for short durations.
  let cursorX: number | null = null
  const part    = score.parts.find(p => p.id === layout.partId)
  const staff   = part?.staves.find(s => s.id === layout.staffId)
  const measure = staff?.measures.find(m => m.id === layout.measureId)

  if (measure) {
    outer: for (const voice of measure.voices) {
      if (!voice) continue
      let acc = 0
      for (const event of voice.events) {
        if (acc === cursor.cursorBeatPosition) {
          const x = notePositions.get(event.id)
          if (x !== undefined) { cursorX = x; break outer }
        }
        acc += eventDurationUnits(event)
        if (acc > cursor.cursorBeatPosition) break
      }
    }
  }

  // Fallback for cursor past all events: proportional with correct note-area bounds.
  if (cursorX === null) {
    const key       = `${layout.partId}:${layout.staffId}:${layout.measureId}`
    const noteStart = noteStartX.get(key) ?? layout.x + 20
    const fraction  = cursor.totalCapacityUnits > 0
      ? cursor.cursorBeatPosition / cursor.totalCapacityUnits
      : 0
    cursorX = noteStart + fraction * (layout.x + layout.width - noteStart)
  }

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
