import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import type { Command } from '@shared/commands'
import * as Tone from 'tone'
import {
  computeLayout,
  computeSliceOffsets,
  computeSliceLayouts,
  renderScoreMulti,
  drawOverlay,
  type CanvasSlice,
  DEFAULT_RENDER_OPTIONS,
  LABEL_MARGIN_X,
  HEADING_MARGIN_Y,
  STAVE_HEIGHT_PX,
  LYRIC_Y_OFFSET,
  PEDAL_BASE_BELOW_STAVE,
  headingFieldBounds,
  type MeasureLayout,
  type HeadingFieldBound,
  type SelectedChordPitchInfo,
} from '../engine/notationRenderer'
import { createNote, createRest, type NoteName, type Accidental, type Articulation, type Note, type Chord, type Pitch, type NoteEvent, type BarlineType, type TimeSignature, type KeySignature, type ClefType, type Directive, type Slur, type DynamicLevel, type Volta, type Duration, type MidiScoreEvent, type PedalMark } from '@shared/score'
import { v4 as uuid } from 'uuid'
import {
  DURATION_UNITS,
  dottedUnits,
  measureCapacityUnits,
  closestOctave,
  stepToPitch,
  yToStep,
  KEY_TO_DURATION,
  remainingUnits,
  resolveTimeSig,
  timeSigsEqual,
  resolveKeySig,
  resolveDirectiveDynamic,
  resolveDirectiveMidiProgram,
  eventDurationUnits,
  shiftPitchBySemitones,
  buildPlaybackSequence,
  buildMeasureTimeline,
  firstRestBeat,
  type MeasureTimeEntry,
} from '@shared/musicUtils'
import { pitchToHz } from '../engine/audioEngine'
import { previewNote } from '../engine/notePreview'
import { pitchToMidi, midiOutputEngine } from '../engine/midiOutputEngine'
import { TimeSignaturePicker } from './TimeSignaturePicker'
import { CircleOfFifths } from './CircleOfFifths'
import { ClefPicker } from './ClefPicker'
import { DirectivePicker } from './DirectivePicker'
import { MidiEventPicker } from './MidiEventPicker'
import { PedalMarkPicker } from './PedalMarkPicker'
import { VirtualKeyboard } from './VirtualKeyboard'
import { useMidiInput } from '../hooks/useMidiInput'
import type { NoteInput } from '../services/midiService'
import { TextBoxLayer, makeTextBox } from './TextBoxLayer'

// ── Pencil cursor (note/rest insertion hover) ─────────────────────────────────
// Material Design edit icon scaled to 20×20; hotspot at pencil tip (bottom-left).
const PENCIL_CURSOR = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24'%3E%3Cpath d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z' fill='%23333'/%3E%3C/svg%3E\") 2 18, crosshair"

// ── Preview helper ────────────────────────────────────────────────────────────

function triggerInputPreview(
  noteName: string, octave: number, accidental: string | null | undefined,
  volDb: number, isPizz: boolean, transposeSemitones: number,
  audioMode: 'builtin' | 'midi-out' = 'builtin',
  midiChannel = 0,
  midiProgram = 0,
): void {
  if (audioMode === 'midi-out') {
    const midiNote = pitchToMidi(noteName, octave, accidental, transposeSemitones)
    const velocity = Math.max(1, Math.min(127, Math.round(Math.pow(10, volDb / 20) * 100)))
    midiOutputEngine.previewNote(midiNote, velocity, midiChannel, midiProgram)
  } else {
    const hz = pitchToHz(noteName, octave, accidental ?? null, transposeSemitones)
    void previewNote(hz, volDb, isPizz)
  }
}

// ── Rest-replace helpers ──────────────────────────────────────────────────────

function findEventAtBeat(events: readonly NoteEvent[], beat: number): { event: NoteEvent; index: number } | null {
  let acc = 0
  for (let i = 0; i < events.length; i++) {
    if (acc === beat) return { event: events[i], index: i }
    acc += eventDurationUnits(events[i])
    if (acc > beat) break
  }
  return null
}

const REST_DECOMP: Array<{ units: number; duration: Duration; dots: 0 | 1 }> = [
  { units: 64, duration: 'whole',   dots: 0 },
  { units: 48, duration: 'half',    dots: 1 },
  { units: 32, duration: 'half',    dots: 0 },
  { units: 24, duration: 'quarter', dots: 1 },
  { units: 16, duration: 'quarter', dots: 0 },
  { units: 12, duration: 'eighth',  dots: 1 },
  { units: 8,  duration: 'eighth',  dots: 0 },
  { units: 6,  duration: '16th',    dots: 1 },
  { units: 4,  duration: '16th',    dots: 0 },
  { units: 3,  duration: '32nd',    dots: 1 },
  { units: 2,  duration: '32nd',    dots: 0 },
  { units: 1,  duration: '64th',    dots: 0 },
]

function decomposeToRests(units: number): Array<{ duration: Duration; dots: 0 | 1 }> {
  const result: Array<{ duration: Duration; dots: 0 | 1 }> = []
  let remaining = units
  while (remaining > 0) {
    const match = REST_DECOMP.find(d => d.units <= remaining)
    if (!match) break
    result.push({ duration: match.duration, dots: match.dots })
    remaining -= match.units
  }
  return result
}

// Collects all consecutive rests starting at `startIdx`, replaces them with `newEvent`,
// and fills any remainder with optimally compacted rests.
// Returns the command batch + total rest space, or null if the note doesn't fit.
function buildRestReplaceCommands(
  events: readonly NoteEvent[],
  startIdx: number,
  units: number,
  newEvent: NoteEvent,
  partId: string, staffId: string, measureId: string, voiceId: string,
): { cmds: Command[]; totalRestSpace: number } | null {
  let totalRestSpace = 0
  const restIds: string[] = []
  for (let i = startIdx; i < events.length; i++) {
    if (events[i].type !== 'rest') break
    totalRestSpace += eventDurationUnits(events[i])
    restIds.push(events[i].id)
  }
  if (restIds.length === 0 || units > totalRestSpace) return null
  const cmds: Command[] = [
    { type: 'REPLACE_NOTE', partId, staffId, measureId, voiceId, noteId: restIds[0], event: newEvent },
  ]
  for (let i = 1; i < restIds.length; i++) {
    cmds.push({ type: 'DELETE_NOTE', partId, staffId, measureId, voiceId, noteId: restIds[i] })
  }
  const remainder = totalRestSpace - units
  if (remainder > 0) {
    let insertIdx = startIdx + 1
    for (const r of decomposeToRests(remainder)) {
      cmds.push({ type: 'ADD_NOTE', partId, staffId, measureId, voiceId, event: { ...createRest(r.duration), dots: r.dots }, index: insertIdx++ })
    }
  }
  return { cmds, totalRestSpace }
}

// When cursor is on an existing note/chord, handles chord building (different pitch)
// or duration change (same pitch). Available space = note-units + trailing-rest-units.
function buildNoteInsertCommands(
  events: readonly NoteEvent[],
  noteIdx: number,
  units: number,
  newEvent: NoteEvent,
  partId: string, staffId: string, measureId: string, voiceId: string,
): { cmds: Command[] } | null {
  const existingNote = events[noteIdx]
  if (!existingNote || (existingNote.type !== 'note' && existingNote.type !== 'chord')) return null

  const existingUnits = eventDurationUnits(existingNote)
  let totalSpace = existingUnits
  const trailingRestIds: string[] = []
  for (let i = noteIdx + 1; i < events.length; i++) {
    if (events[i].type !== 'rest') break
    totalSpace += eventDurationUnits(events[i])
    trailingRestIds.push(events[i].id)
  }

  if (units > totalSpace) return null

  const cmds: Command[] = [
    { type: 'REPLACE_NOTE', partId, staffId, measureId, voiceId, noteId: existingNote.id, event: newEvent },
  ]
  for (const restId of trailingRestIds) {
    cmds.push({ type: 'DELETE_NOTE', partId, staffId, measureId, voiceId, noteId: restId })
  }
  const remainder = totalSpace - units
  if (remainder > 0) {
    let insertIdx = noteIdx + 1
    for (const r of decomposeToRests(remainder)) {
      cmds.push({ type: 'ADD_NOTE', partId, staffId, measureId, voiceId, event: { ...createRest(r.duration), dots: r.dots }, index: insertIdx++ })
    }
  }
  return { cmds }
}

const LINE_SPACING_PX  = 10
const BARLINE_HIT_RADIUS = 8
const CLEF_HIT_WIDTH   = 46   // approximate px width of a rendered clef symbol

// ── BarlinePicker ─────────────────────────────────────────────────────────────

const BARLINE_OPTIONS: { label: string; value: BarlineType }[] = [
  { label: 'Single',       value: 'single'       },
  { label: 'Double',       value: 'double'       },
  { label: 'Repeat Start', value: 'repeat-start' },
  { label: 'Repeat End',   value: 'repeat-end'   },
  { label: 'Final',        value: 'final'        },
]

interface BarlinePickerProps {
  measureId: string
  partId: string
  staffId: string
  isLastMeasure: boolean
  screenX: number
  screenY: number
  onClose: () => void
  onSelect: (measureId: string, partId: string, staffId: string, barline: BarlineType) => void
}

function BarlinePicker({
  measureId, partId, staffId, isLastMeasure,
  screenX, screenY, onClose, onSelect,
}: BarlinePickerProps): JSX.Element {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const handleOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-barline-picker]')) onClose()
    }
    window.addEventListener('keydown', handleKey)
    const timer = setTimeout(() => window.addEventListener('mousedown', handleOutside), 0)
    return () => {
      window.removeEventListener('keydown', handleKey)
      clearTimeout(timer)
      window.removeEventListener('mousedown', handleOutside)
    }
  }, [onClose])

  return (
    <div
      data-barline-picker=""
      style={{
        position: 'fixed', left: screenX, top: screenY,
        background: '#fff', border: '1px solid #ccc', borderRadius: 4,
        padding: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120,
      }}
    >
      {isLastMeasure && (
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4, padding: '0 4px' }}>
          Final barline is locked
        </div>
      )}
      {BARLINE_OPTIONS.map(({ label, value }) => {
        const disabled = isLastMeasure && value !== 'final'
        return (
          <button
            key={value}
            disabled={disabled}
            onClick={() => { if (!disabled) onSelect(measureId, partId, staffId, value) }}
            style={{
              padding: '3px 8px', fontSize: 12, textAlign: 'left',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.4 : 1,
              background: 'none', border: '1px solid transparent', borderRadius: 3,
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRenderOptions(zoom: number, showLabels: boolean) {
  return {
    ...DEFAULT_RENDER_OPTIONS,
    canvasWidth: Math.floor(DEFAULT_RENDER_OPTIONS.canvasWidth * zoom),
    staveWidth:  Math.floor(DEFAULT_RENDER_OPTIONS.staveWidth  * zoom),
    marginX:     showLabels ? LABEL_MARGIN_X : DEFAULT_RENDER_OPTIONS.marginX,
    marginRight: DEFAULT_RENDER_OPTIONS.marginRight,
  }
}

function canvasCoords(
  event: React.MouseEvent,
  element: HTMLElement
): { x: number; y: number } {
  // VexFlow draws in CSS (logical) pixels. Keep click coordinates in the same space.
  const rect = element.getBoundingClientRect()
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  }
}

function findClickedLayout(
  x: number,
  y: number,
  layouts: MeasureLayout[]
): MeasureLayout | undefined {
  const LEDGER_MARGIN = 50
  const STAVE_HEIGHT  = 4 * LINE_SPACING_PX   // 40px
  return layouts.find(l =>
    x >= l.x &&
    x <= l.x + l.width &&
    y >= l.staveTopY - LEDGER_MARGIN &&
    y <= l.staveTopY + STAVE_HEIGHT + LEDGER_MARGIN
  )
}

// ── Heading inline editor ─────────────────────────────────────────────────────

function HeadingEditor({
  bound, currentValue, onCommit, onCancel,
}: {
  bound: HeadingFieldBound
  currentValue: string
  onCommit: (value: string) => void
  onCancel: () => void
}): JSX.Element {
  return (
    <input
      autoFocus
      key={bound.field}
      defaultValue={currentValue}
      placeholder={bound.field.charAt(0).toUpperCase() + bound.field.slice(1)}
      style={{
        position: 'absolute',
        left:   bound.x,
        top:    bound.y,
        width:  bound.width,
        height: bound.height,
        font:   bound.font,
        textAlign: bound.textAlign,
        background: 'rgba(255, 255, 255, 0.92)',
        border: '1px solid #0e639c',
        borderRadius: 2,
        outline: 'none',
        padding: '0 4px',
        boxSizing: 'border-box',
        color: '#111',
      }}
      onBlur={e  => onCommit(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter')  { onCommit(e.currentTarget.value); e.preventDefault() }
        if (e.key === 'Escape') { onCancel(); e.preventDefault() }
      }}
    />
  )
}

// ── Lyric editor input overlay ────────────────────────────────────────────────

interface LyricEditorInputProps {
  currentLyric: string
  left: number
  top: number
  onCommit: (lyric: string | undefined) => void
  onAdvance: () => void
  onBack: () => void
  onExit: () => void
}

function LyricEditorInput({
  currentLyric, left, top, onCommit, onAdvance, onBack, onExit,
}: LyricEditorInputProps): JSX.Element {
  const committedRef = useRef(false)

  const doCommit = (value: string) => {
    committedRef.current = true
    const trimmed = value.trim()
    onCommit(trimmed || undefined)
  }

  return (
    <input
      autoFocus
      defaultValue={currentLyric}
      style={{
        position: 'absolute',
        left: left - 32,
        top:  top - 14,
        width: 64,
        font: '12px serif',
        textAlign: 'center',
        background: 'rgba(255,255,255,0.95)',
        border: '1px solid #0e639c',
        borderRadius: 2,
        outline: 'none',
        padding: '1px 4px',
        boxSizing: 'border-box' as const,
        color: '#111',
        zIndex: 200,
      }}
      onBlur={e => {
        if (!committedRef.current) {
          const trimmed = e.target.value.trim()
          onCommit(trimmed || undefined)
        }
      }}
      onKeyDown={e => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          doCommit(e.currentTarget.value)
          onAdvance()
        } else if (e.key === '-') {
          e.preventDefault()
          doCommit(e.currentTarget.value + '-')
          onAdvance()
        } else if (e.key === 'Tab') {
          e.preventDefault()
          doCommit(e.currentTarget.value)
          if (e.shiftKey) onBack(); else onAdvance()
        } else if (e.key === 'Backspace' && e.currentTarget.value === '') {
          e.preventDefault()
          onCommit(undefined)
          onBack()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          committedRef.current = true
          onExit()
        }
      }}
    />
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PickerState {
  measureId: string
  partId: string
  staffId: string
  isLastMeasure: boolean
  screenX: number
  screenY: number
}

interface TimeSigPickerState {
  measureId: string | null   // null = score-level global
  partId: string | null
  staffId: string | null
  current: TimeSignature
  screenX: number
  screenY: number
}

interface KeySigPickerState {
  measureId: string
  partId: string
  staffId: string
  current: KeySignature
  screenX: number
  screenY: number
}

interface ClefPickerState {
  measureId: string
  partId: string
  staffId: string
  current: ClefType
  screenX: number
  screenY: number
}

interface DirectivePickerState {
  measureId: string
  partId: string
  staffId: string
  existing: readonly Directive[]
  isFirstPart: boolean
  screenX: number
  screenY: number
}

interface MidiEventPickerState {
  measureId: string
  partId: string
  staffId: string
  existing: readonly MidiScoreEvent[]
  beatPosition: number
  capacity: number
  screenX: number
  screenY: number
}

interface PedalMarkPickerState {
  measureId: string
  partId: string
  staffId: string
  existing: readonly PedalMark[]
  beatPosition: number
  capacity: number
  screenX: number
  screenY: number
}

const ARTICULATION_BUTTONS: { art: Articulation; label: string; title: string }[] = [
  { art: 'staccato', label: '·',  title: 'Staccato' },
  { art: 'accent',   label: '>',  title: 'Accent' },
  { art: 'tenuto',   label: '—',  title: 'Tenuto' },
  { art: 'marcato',  label: '^',  title: 'Marcato' },
  { art: 'fermata',  label: '𝄐',  title: 'Fermata' },
  { art: 'trill',          label: 'tr', title: 'Trill' },
  { art: 'mordent',        label: 'mw', title: 'Mordent (lower)' },
  { art: 'mordent-upper',  label: 'mW', title: 'Mordent (upper)' },
  { art: 'turn',           label: '~',  title: 'Turn' },
]

export function ScoreCanvas(): JSX.Element {
  // Container div that holds all canvas slices for multi-canvas rendering
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  // Overlay div — same stacking geometry as canvasAreaRef; holds transparent canvases
  // for selection/cursor highlights drawn independently of the VexFlow base render.
  const overlayCanvasAreaRef = useRef<HTMLDivElement>(null)
  // Current slice metadata — kept in sync with the canvas elements in canvasAreaRef
  const canvasSlicesRef = useRef<CanvasSlice[]>([])
  const notePositionsRef    = useRef(new Map<string, number>())
  const noteStartXRef       = useRef(new Map<string, number>())
  const noteToMeasureKeyRef = useRef(new Map<string, string>())
  const layoutsRef          = useRef<MeasureLayout[]>([])
  const playbackTimelineRef = useRef<MeasureTimeEntry[]>([])
  const playbackCursorElRef = useRef<HTMLDivElement>(null)
  const shiftHeldRef = useRef(false)
  const [shiftHoverOnNote, setShiftHoverOnNote] = useState(false)
  const [hoverCursor, setHoverCursor] = useState<'default' | 'valid' | 'invalid' | 'hand'>('default')
  // Chord pitch cycling: tracks which chord is being cycled and the next pitch index to select
  const [chordCycleState, setChordCycleState] = useState<{ eventId: string; nextIndex: number } | null>(null)
  const [selectionMenuPos, setSelectionMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [pickerState, setPickerState] = useState<PickerState | null>(null)
  const [timeSigPickerState, setTimeSigPickerState] = useState<TimeSigPickerState | null>(null)
  const [keySigPickerState, setKeySigPickerState] = useState<KeySigPickerState | null>(null)
  const [clefPickerState, setClefPickerState] = useState<ClefPickerState | null>(null)
  const [directivePickerState, setDirectivePickerState] = useState<DirectivePickerState | null>(null)
  const [midiEventPickerState, setMidiEventPickerState] = useState<MidiEventPickerState | null>(null)
  const [pedalMarkPickerState, setPedalMarkPickerState] = useState<PedalMarkPickerState | null>(null)
  const [editingHeading, setEditingHeading] = useState<HeadingFieldBound | null>(null)
  const [slurPendingId, setSlurPendingId] = useState<string | null>(null)
  const [contextMenuTab, setContextMenuTab] = useState<'articulations' | 'volta' | 'transpose'>('articulations')
  const [transposeDir, setTransposeDir]     = useState<'up' | 'down'>('up')
  const [transposeAmt, setTransposeAmt]     = useState(1)
  const [menuDragOffset, setMenuDragOffset] = useState({ x: 0, y: 0 })
  const [isDraggingMenu, setIsDraggingMenu] = useState(false)
  const menuDragRef = useRef<{ startX: number; startY: number; startOffX: number; startOffY: number } | null>(null)

  const {
    score, zoom, inputMode,
    selectedDuration, isDotted, primedAccidental,
    activeVoice,
    cursorMeasureId, cursorBeatPosition,
    lastEnteredPitch, selectedNoteId, selectedNoteIds, selectedAnchorId,
    dispatch, dispatchBatch, setInputMode,
    setSelectedDuration, setIsDotted, toggleDot, setPrimedAccidental,
    setCursor, setLastEnteredPitch,
    setSelectedNote, setSelectedNotes, toggleSelectedNote, clearSelection,
    selectedChordPitchIndex, setSelectedChordPitch,
    setSelectedBarline,
    selectedMeasureId, setSelectedMeasure,
    moveCursorToFirstAvailable,
    keyboardVisible, toggleKeyboard,
    soundOnInput, audioMode,
    pendingResize, resizeError, resizeNote, confirmResize, cancelResize, clearResizeError,
    insertMeasure,
    deleteMeasure,
    addHairpin,
    applyTuplet,
    setNoteDynamic,
    addVolta,
    removeVolta,
    lyricCursorNoteId, setLyricCursor,
    isPlaying,
    barSelection, setBarSelection, deleteSelectedBars,
  } = useAppStore()

  // ── Articulation state ──────────────────────────────────────────────────────

  const selectedEventLocations = useMemo(() => {
    const idSet = new Set(selectedNoteIds)
    const found: { event: NoteEvent; partId: string; staffId: string; measureId: string; voiceId: string }[] = []
    for (const part of score.parts) {
      for (const staff of part.staves) {
        for (const measure of staff.measures) {
          for (const voice of measure.voices) {
            for (const ev of voice.events) {
              if (idSet.has(ev.id)) {
                found.push({ event: ev, partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id })
              }
            }
          }
        }
      }
    }
    return found
  }, [score, selectedNoteIds])

  const nonRestLocations = useMemo(
    () => selectedEventLocations.filter(x => x.event.type !== 'rest'),
    [selectedEventLocations]
  )

  const artActive = useMemo((): Partial<Record<Articulation, boolean>> => {
    if (nonRestLocations.length === 0) return {}
    const result: Partial<Record<Articulation, boolean>> = {}
    for (const { art } of ARTICULATION_BUTTONS) {
      result[art] = nonRestLocations.every(
        x => ((x.event as any).articulations as Articulation[]).includes(art)
      )
    }
    return result
  }, [nonRestLocations])

  const handleArticulationClick = useCallback((art: Articulation) => {
    if (nonRestLocations.length === 0) return
    const targets = nonRestLocations.map(({ event, partId, staffId, measureId, voiceId }) => ({
      partId, staffId, measureId, voiceId, noteId: event.id,
    }))
    const on = !artActive[art]
    dispatch({ type: 'SET_ARTICULATION', targets, articulation: art, on })
  }, [nonRestLocations, artActive, dispatch])

  // ── Render ──────────────────────────────────────────────────────────────────

  // Stable identity: null when no chord-pitch cycling is active, so normal note
  // selection does not cause chordPitchInfo to change and avoids triggering the
  // expensive base VexFlow render.
  const chordPitchInfo = useMemo<SelectedChordPitchInfo | null>(() =>
    selectedNoteId && selectedChordPitchIndex !== null
      ? { eventId: selectedNoteId, pitchIndex: selectedChordPitchIndex }
      : null,
    [selectedNoteId, selectedChordPitchIndex]
  )

  // ── Base render effect: full VexFlow re-render ────────────────────────────────
  // Only fires when score content, zoom, or chord-pitch cycling changes.
  // Selection, cursor, and bar-selection highlights are drawn by the overlay effect.
  useEffect(() => {
    const canvasArea = canvasAreaRef.current
    if (!canvasArea) return
    const options = getRenderOptions(zoom, score.showPartLabels)

    const layouts = computeLayout(score, options)
    const sliceOffsets = computeSliceOffsets(layouts, options)
    const lastLayout = layouts[layouts.length - 1]
    const totalHeight = lastLayout
      ? lastLayout.staveY + options.staveHeight + options.marginY
      : options.marginY + options.staveHeight

    // Sync canvas element count to slice count
    const existingCanvases = Array.from(canvasArea.childNodes)
      .filter((n): n is HTMLCanvasElement => n instanceof HTMLCanvasElement)
    while (existingCanvases.length > sliceOffsets.length) {
      canvasArea.removeChild(existingCanvases.pop()!)
    }
    while (existingCanvases.length < sliceOffsets.length) {
      const c = document.createElement('canvas')
      c.style.display = 'block'
      const firstNonCanvas = Array.from(canvasArea.childNodes)
        .find((n): n is ChildNode => !(n instanceof HTMLCanvasElement))
      if (firstNonCanvas) canvasArea.insertBefore(c, firstNonCanvas)
      else canvasArea.appendChild(c)
      existingCanvases.push(c)
    }

    const slices: CanvasSlice[] = existingCanvases.map((canvas, i) => ({
      canvas,
      yOffset: sliceOffsets[i],
      height: (sliceOffsets[i + 1] ?? totalHeight) - sliceOffsets[i],
    }))
    canvasSlicesRef.current = slices

    const result = renderScoreMulti(slices, score, options, chordPitchInfo, layouts)
    notePositionsRef.current    = result.notePositions
    noteStartXRef.current       = result.noteStartX
    noteToMeasureKeyRef.current = result.noteToMeasureKey
    layoutsRef.current          = result.layouts
  }, [score, zoom, chordPitchInfo])

  // ── Overlay effect: selection/cursor highlights ───────────────────────────────
  // Redraws only the cheap Canvas2D overlay; VexFlow base render is untouched.
  // Also runs after the base effect (both score and zoom are in deps) so overlay
  // canvases are always re-synced when base canvases are recreated.
  useEffect(() => {
    const canvasArea = canvasAreaRef.current
    const overlayArea = overlayCanvasAreaRef.current
    if (!canvasArea || !overlayArea) return

    const baseCanvases = Array.from(canvasArea.childNodes)
      .filter((n): n is HTMLCanvasElement => n instanceof HTMLCanvasElement)
    if (!baseCanvases.length) return

    // Sync overlay canvas count with base
    const overlayCanvases = Array.from(overlayArea.childNodes)
      .filter((n): n is HTMLCanvasElement => n instanceof HTMLCanvasElement)
    while (overlayCanvases.length > baseCanvases.length) overlayArea.removeChild(overlayCanvases.pop()!)
    while (overlayCanvases.length < baseCanvases.length) {
      const c = document.createElement('canvas')
      c.style.display = 'block'
      overlayArea.appendChild(c)
      overlayCanvases.push(c)
    }

    const slices = canvasSlicesRef.current
    if (!slices.length) return
    const layouts = layoutsRef.current
    const totalHeight = slices[slices.length - 1].yOffset + slices[slices.length - 1].height

    const capacity = measureCapacityUnits(score.timeSignature)
    const cursor = (!isPlaying && cursorMeasureId && inputMode !== 'select')
      ? { cursorMeasureId, cursorBeatPosition, totalCapacityUnits: capacity }
      : null

    for (let i = 0; i < baseCanvases.length; i++) {
      const base = baseCanvases[i]
      const overlay = overlayCanvases[i]

      // Sync overlay canvas physical + CSS dimensions to match base
      if (overlay.width !== base.width || overlay.height !== base.height) {
        overlay.width  = base.width
        overlay.height = base.height
      }
      if (overlay.style.width  !== base.style.width)  overlay.style.width  = base.style.width
      if (overlay.style.height !== base.style.height) overlay.style.height = base.style.height

      const yOffset    = slices[i]?.yOffset ?? 0
      const nextOffset = slices[i + 1]?.yOffset ?? totalHeight
      const sliceLocalLayouts = computeSliceLayouts(layouts, yOffset, nextOffset)

      drawOverlay(
        overlay, sliceLocalLayouts, score,
        notePositionsRef.current, noteToMeasureKeyRef.current, noteStartXRef.current,
        inputMode === 'select' ? new Set(selectedNoteIds) : new Set(),
        cursor, selectedMeasureId, lyricCursorNoteId, barSelection,
      )
    }
  }, [score, zoom, selectedNoteIds, cursorMeasureId, cursorBeatPosition, selectedMeasureId, lyricCursorNoteId, barSelection, inputMode, isPlaying])

  // ── Playback cursor ──────────────────────────────────────────────────────────

  // Build measure timeline whenever playback starts
  useEffect(() => {
    if (!isPlaying) return
    const tempoStaff = score.parts[0]?.staves[0]
    if (!tempoStaff) return
    const sequence = buildPlaybackSequence(tempoStaff.measures, score.voltas ?? [])
    playbackTimelineRef.current = buildMeasureTimeline(
      tempoStaff, sequence, tempoStaff, score.tempo ?? 120, score.timeSignature
    )
  }, [isPlaying, score])

  // Hide DOM div cursor whenever playback stops — canvas cursor takes over at stopped position
  useEffect(() => {
    if (isPlaying) return
    const cursor = playbackCursorElRef.current
    if (cursor) cursor.style.display = 'none'
  }, [isPlaying])

  // RAF animation loop: move cursor during playback
  useEffect(() => {
    if (!isPlaying) return
    let rafId: number

    const tick = () => {
      const cursor = playbackCursorElRef.current
      const timeline = playbackTimelineRef.current
      if (!cursor || !timeline.length) { rafId = requestAnimationFrame(tick); return }

      const t = Tone.Transport.seconds

      // Find current measure in timeline
      let entry = timeline[timeline.length - 1]
      for (const e of timeline) {
        if (t < e.startSec + e.durationSec) { entry = e; break }
      }
      const fraction = Math.max(0, Math.min(1,
        (t - entry.startSec) / Math.max(0.001, entry.durationSec)
      ))

      // Find layouts for this measure index (all parts in the column share same X)
      const colLayouts = layoutsRef.current.filter(l => l.measureIndex === entry.mIdx)
      if (!colLayouts.length) { rafId = requestAnimationFrame(tick); return }

      const first = colLayouts[0]
      const nsx   = noteStartXRef.current.get(`${first.partId}:${first.staffId}:${first.measureId}`) ?? (first.x + 20)
      const noteAreaEnd = first.x + first.width
      const x = nsx + fraction * (noteAreaEnd - nsx)

      const topY = Math.min(...colLayouts.map(l => l.staveTopY)) - 8
      const botY = Math.max(...colLayouts.map(l => l.staveTopY + STAVE_HEIGHT_PX)) + 8

      cursor.style.left    = `${x}px`
      cursor.style.top     = `${topY}px`
      cursor.style.height  = `${botY - topY}px`
      cursor.style.display = 'block'

      // Auto-scroll: keep cursor in view vertically
      const canvasArea = canvasAreaRef.current
      const scrollContainer = canvasArea?.closest<HTMLElement>('main')
      if (scrollContainer && canvasArea) {
        const areaRect = canvasArea.getBoundingClientRect()
        const containerRect = scrollContainer.getBoundingClientRect()
        const cursorAbsTop = areaRect.top - containerRect.top + scrollContainer.scrollTop + topY
        const { scrollTop, clientHeight } = scrollContainer
        const margin = 80
        if (cursorAbsTop < scrollTop + margin) {
          scrollContainer.scrollTop = cursorAbsTop - margin
        } else if (cursorAbsTop + (botY - topY) > scrollTop + clientHeight - margin) {
          scrollContainer.scrollTop = cursorAbsTop - clientHeight * 0.3
        }
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isPlaying])

  // ── Note entry helpers ──────────────────────────────────────────────────────

  const enterNote = useCallback((noteName: NoteName) => {
    if (!cursorMeasureId) return

    // Find context in score
    for (const part of score.parts) {
      for (const staff of part.staves) {
        const measure = staff.measures.find(m => m.id === cursorMeasureId)
        if (!measure) continue

        const existingVoice = measure.voices[activeVoice]
        const voiceEvents   = existingVoice?.events ?? []
        const timeSig = measure.timeSignature ?? score.timeSignature
        const dots    = isDotted ? 1 : 0 as 0 | 1
        const units   = dottedUnits(DURATION_UNITS[selectedDuration], dots)

        // Rest-replace or note-insert depending on what's at the cursor position
        const atCursor = existingVoice ? findEventAtBeat(voiceEvents, cursorBeatPosition) : null
        const octave      = closestOctave(noteName, lastEnteredPitch)
        const accidental  = primedAccidental as Accidental
        const capacity    = measureCapacityUnits(timeSig)

        if (atCursor?.event.type === 'rest') {
          const note        = createNote(noteName, octave, selectedDuration, accidental)
          const noteWithDot = { ...note, dots } as Note
          const result = buildRestReplaceCommands(voiceEvents, atCursor.index, units, noteWithDot, part.id, staff.id, measure.id, existingVoice.id)
          if (!result) {
            canvasAreaRef.current?.classList.add('cursor-reject')
            setTimeout(() => canvasAreaRef.current?.classList.remove('cursor-reject'), 200)
            return
          }
          dispatchBatch(result.cmds)
          if (soundOnInput) {
            const mIdx  = staff.measures.findIndex(m => m.id === cursorMeasureId)
            const dyn   = resolveDirectiveDynamic(staff.measures, mIdx)
            const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? part.volume))
            const midi  = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
            const partIdx = score.parts.indexOf(part)
            const ch = Math.min((part.midiChannel ?? (partIdx + 1)) - 1, 15)
            triggerInputPreview(noteWithDot.pitch.noteName, noteWithDot.pitch.octave, noteWithDot.pitch.accidental, volDb, midi === 45, part.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
          }
          setPrimedAccidental(null)
          setLastEnteredPitch(noteWithDot.pitch)
          setSelectedMeasure(null)
          const newBeat = cursorBeatPosition + units
          if (newBeat >= capacity) {
            const measureIdx  = staff.measures.findIndex(m => m.id === cursorMeasureId)
            const nextMeasure = staff.measures[measureIdx + 1]
            if (nextMeasure) setCursor(nextMeasure.id, firstRestBeat(nextMeasure.voices[activeVoice]?.events ?? []))
            else             setCursor(null, 0)
          } else {
            setCursor(cursorMeasureId, newBeat)
          }
          return
        }

        if (atCursor?.event.type === 'note' || atCursor?.event.type === 'chord') {
          const existingEvent = atCursor.event
          const isSamePitch   = existingEvent.type === 'note' &&
            existingEvent.pitch.noteName === noteName &&
            existingEvent.pitch.octave   === octave

          let newEvent: NoteEvent
          if (isSamePitch) {
            newEvent = { ...(existingEvent as Note), duration: selectedDuration, dots } as Note
          } else {
            const newPitch: Pitch = { noteName, octave, accidental: accidental ?? null }
            if (existingEvent.type === 'chord') {
              const sortedPitches = [...existingEvent.pitches, newPitch].sort((a, b) =>
                (a.octave * 7 + 'CDEFGAB'.indexOf(a.noteName)) - (b.octave * 7 + 'CDEFGAB'.indexOf(b.noteName))
              )
              newEvent = { ...existingEvent, pitches: sortedPitches, duration: selectedDuration, dots } as Chord
            } else {
              const sortedPitches = [(existingEvent as Note).pitch, newPitch].sort((a, b) =>
                (a.octave * 7 + 'CDEFGAB'.indexOf(a.noteName)) - (b.octave * 7 + 'CDEFGAB'.indexOf(b.noteName))
              )
              newEvent = {
                id: uuid(), type: 'chord', pitches: sortedPitches,
                duration: selectedDuration, dots,
                articulations: (existingEvent as Note).articulations ?? [],
              } as Chord
            }
          }

          const result = buildNoteInsertCommands(voiceEvents, atCursor.index, units, newEvent, part.id, staff.id, measure.id, existingVoice.id)
          if (!result) {
            canvasAreaRef.current?.classList.add('cursor-reject')
            setTimeout(() => canvasAreaRef.current?.classList.remove('cursor-reject'), 200)
            return
          }
          dispatchBatch(result.cmds)
          if (soundOnInput) {
            const mIdx  = staff.measures.findIndex(m => m.id === cursorMeasureId)
            const dyn   = resolveDirectiveDynamic(staff.measures, mIdx)
            const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? part.volume))
            const midi  = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
            const partIdx = score.parts.indexOf(part)
            const ch = Math.min((part.midiChannel ?? (partIdx + 1)) - 1, 15)
            const previewPitch = newEvent.type === 'chord'
              ? (newEvent as Chord).pitches[(newEvent as Chord).pitches.length - 1]
              : (newEvent as Note).pitch
            triggerInputPreview(previewPitch.noteName, previewPitch.octave, previewPitch.accidental, volDb, midi === 45, part.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
          }
          setPrimedAccidental(null)
          const lastPitch = newEvent.type === 'chord'
            ? (newEvent as Chord).pitches[(newEvent as Chord).pitches.length - 1]
            : (newEvent as Note).pitch
          setLastEnteredPitch(lastPitch)
          setSelectedMeasure(null)
          const newBeat = cursorBeatPosition + units
          if (newBeat >= capacity) {
            const measureIdx  = staff.measures.findIndex(m => m.id === cursorMeasureId)
            const nextMeasure = staff.measures[measureIdx + 1]
            if (nextMeasure) setCursor(nextMeasure.id, firstRestBeat(nextMeasure.voices[activeVoice]?.events ?? []))
            else             setCursor(null, 0)
          } else {
            setCursor(cursorMeasureId, newBeat)
          }
          return
        }

        if (remainingUnits(voiceEvents, timeSig) < units) {
          canvasAreaRef.current?.classList.add('cursor-reject')
          setTimeout(() => canvasAreaRef.current?.classList.remove('cursor-reject'), 200)
          return
        }

        const note        = createNote(noteName, octave, selectedDuration, accidental)
        const noteWithDot = { ...note, dots } as Note

        const targetVoiceId = existingVoice?.id ?? uuid()
        const addNoteCmd: Command = {
          type: 'ADD_NOTE',
          partId:    part.id,
          staffId:   staff.id,
          measureId: measure.id,
          voiceId:   targetVoiceId,
          event:     noteWithDot,
        }

        if (!existingVoice) {
          dispatchBatch([
            { type: 'ADD_VOICE', partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: targetVoiceId },
            addNoteCmd,
          ])
        } else {
          dispatch(addNoteCmd)
        }

        if (soundOnInput) {
          const mIdx  = staff.measures.findIndex(m => m.id === cursorMeasureId)
          const dyn   = resolveDirectiveDynamic(staff.measures, mIdx)
          const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? part.volume))
          const midi  = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
          const partIdx = score.parts.indexOf(part)
          const ch = Math.min((part.midiChannel ?? (partIdx + 1)) - 1, 15)
          triggerInputPreview(noteWithDot.pitch.noteName, noteWithDot.pitch.octave, noteWithDot.pitch.accidental, volDb, midi === 45, part.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
        }

        setPrimedAccidental(null)
        setLastEnteredPitch(noteWithDot.pitch)
        setSelectedMeasure(null)

        // Advance cursor
        const newBeat = cursorBeatPosition + units
        if (newBeat >= capacity) {
          const measureIdx  = staff.measures.findIndex(m => m.id === cursorMeasureId)
          const nextMeasure = staff.measures[measureIdx + 1]
          if (nextMeasure) {
            const nextVoice = nextMeasure.voices[activeVoice]
            setCursor(nextMeasure.id, firstRestBeat(nextVoice?.events ?? []))
          } else {
            setCursor(null, 0)
          }
        } else {
          setCursor(cursorMeasureId, newBeat)
        }
        return
      }
    }
  }, [score, cursorMeasureId, cursorBeatPosition, selectedDuration, isDotted,
      primedAccidental, lastEnteredPitch, activeVoice, dispatch, dispatchBatch,
      setPrimedAccidental, setLastEnteredPitch, setCursor, setSelectedMeasure,
      soundOnInput, audioMode])

  // Explicit-octave variant used by virtual keyboard and MIDI input
  const enterNoteAtPitch = useCallback((noteName: NoteName, octave: number, accidental?: Accidental, skipPreview = false) => {
    if (!cursorMeasureId) {
      setInputMode('note')
      return
    }
    for (const part of score.parts) {
      for (const staff of part.staves) {
        const measure = staff.measures.find(m => m.id === cursorMeasureId)
        if (!measure) continue
        const existingVoice = measure.voices[activeVoice]
        const voiceEvents   = existingVoice?.events ?? []
        const timeSig = measure.timeSignature ?? score.timeSignature
        const dots    = isDotted ? 1 : 0 as 0 | 1
        const units   = dottedUnits(DURATION_UNITS[selectedDuration], dots)

        const capacity  = measureCapacityUnits(timeSig)
        const atCursor  = existingVoice ? findEventAtBeat(voiceEvents, cursorBeatPosition) : null

        if (atCursor?.event.type === 'rest') {
          const note        = createNote(noteName, octave, selectedDuration, accidental ?? null)
          const noteWithDot = { ...note, dots } as Note
          const result = buildRestReplaceCommands(voiceEvents, atCursor.index, units, noteWithDot, part.id, staff.id, measure.id, existingVoice.id)
          if (!result) {
            canvasAreaRef.current?.classList.add('cursor-reject')
            setTimeout(() => canvasAreaRef.current?.classList.remove('cursor-reject'), 200)
            return
          }
          dispatchBatch(result.cmds)
          if (soundOnInput && !skipPreview) {
            const mIdx  = staff.measures.findIndex(m => m.id === cursorMeasureId)
            const dyn   = resolveDirectiveDynamic(staff.measures, mIdx)
            const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? part.volume))
            const midi  = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
            const partIdx = score.parts.indexOf(part)
            const ch = Math.min((part.midiChannel ?? (partIdx + 1)) - 1, 15)
            triggerInputPreview(noteWithDot.pitch.noteName, noteWithDot.pitch.octave, noteWithDot.pitch.accidental, volDb, midi === 45, part.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
          }
          setLastEnteredPitch(noteWithDot.pitch)
          setSelectedMeasure(null)
          const newBeat = cursorBeatPosition + units
          if (newBeat >= capacity) {
            const mIdx        = staff.measures.findIndex(m => m.id === cursorMeasureId)
            const nextMeasure = staff.measures[mIdx + 1]
            if (nextMeasure) setCursor(nextMeasure.id, firstRestBeat(nextMeasure.voices[activeVoice]?.events ?? []))
            else             setCursor(null, 0)
          } else {
            setCursor(cursorMeasureId, newBeat)
          }
          return
        }

        if (atCursor?.event.type === 'note' || atCursor?.event.type === 'chord') {
          const existingEvent = atCursor.event
          const isSamePitch   = existingEvent.type === 'note' &&
            existingEvent.pitch.noteName === noteName &&
            existingEvent.pitch.octave   === octave

          let newEvent: NoteEvent
          if (isSamePitch) {
            newEvent = { ...(existingEvent as Note), duration: selectedDuration, dots } as Note
          } else {
            const newPitch: Pitch = { noteName, octave, accidental: (accidental ?? null) as Accidental }
            if (existingEvent.type === 'chord') {
              const sortedPitches = [...existingEvent.pitches, newPitch].sort((a, b) =>
                (a.octave * 7 + 'CDEFGAB'.indexOf(a.noteName)) - (b.octave * 7 + 'CDEFGAB'.indexOf(b.noteName))
              )
              newEvent = { ...existingEvent, pitches: sortedPitches, duration: selectedDuration, dots } as Chord
            } else {
              const sortedPitches = [(existingEvent as Note).pitch, newPitch].sort((a, b) =>
                (a.octave * 7 + 'CDEFGAB'.indexOf(a.noteName)) - (b.octave * 7 + 'CDEFGAB'.indexOf(b.noteName))
              )
              newEvent = {
                id: uuid(), type: 'chord', pitches: sortedPitches,
                duration: selectedDuration, dots,
                articulations: (existingEvent as Note).articulations ?? [],
              } as Chord
            }
          }

          const result = buildNoteInsertCommands(voiceEvents, atCursor.index, units, newEvent, part.id, staff.id, measure.id, existingVoice.id)
          if (!result) {
            canvasAreaRef.current?.classList.add('cursor-reject')
            setTimeout(() => canvasAreaRef.current?.classList.remove('cursor-reject'), 200)
            return
          }
          dispatchBatch(result.cmds)
          if (soundOnInput && !skipPreview) {
            const mIdx  = staff.measures.findIndex(m => m.id === cursorMeasureId)
            const dyn   = resolveDirectiveDynamic(staff.measures, mIdx)
            const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? part.volume))
            const midi  = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
            const partIdx = score.parts.indexOf(part)
            const ch = Math.min((part.midiChannel ?? (partIdx + 1)) - 1, 15)
            const previewPitch = newEvent.type === 'chord'
              ? (newEvent as Chord).pitches[(newEvent as Chord).pitches.length - 1]
              : (newEvent as Note).pitch
            triggerInputPreview(previewPitch.noteName, previewPitch.octave, previewPitch.accidental, volDb, midi === 45, part.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
          }
          const lastPitch = newEvent.type === 'chord'
            ? (newEvent as Chord).pitches[(newEvent as Chord).pitches.length - 1]
            : (newEvent as Note).pitch
          setLastEnteredPitch(lastPitch)
          setSelectedMeasure(null)
          const newBeat = cursorBeatPosition + units
          if (newBeat >= capacity) {
            const mIdx        = staff.measures.findIndex(m => m.id === cursorMeasureId)
            const nextMeasure = staff.measures[mIdx + 1]
            if (nextMeasure) setCursor(nextMeasure.id, firstRestBeat(nextMeasure.voices[activeVoice]?.events ?? []))
            else             setCursor(null, 0)
          } else {
            setCursor(cursorMeasureId, newBeat)
          }
          return
        }

        if (remainingUnits(voiceEvents, timeSig) < units) {
          canvasAreaRef.current?.classList.add('cursor-reject')
          setTimeout(() => canvasAreaRef.current?.classList.remove('cursor-reject'), 200)
          return
        }
        const note        = createNote(noteName, octave, selectedDuration, accidental ?? null)
        const noteWithDot = { ...note, dots } as Note
        const targetVoiceId = existingVoice?.id ?? uuid()
        const addNoteCmd: Command = {
          type: 'ADD_NOTE',
          partId:    part.id,
          staffId:   staff.id,
          measureId: measure.id,
          voiceId:   targetVoiceId,
          event:     noteWithDot,
        }
        if (!existingVoice) {
          dispatchBatch([
            { type: 'ADD_VOICE', partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: targetVoiceId },
            addNoteCmd,
          ])
        } else {
          dispatch(addNoteCmd)
        }
        if (soundOnInput && !skipPreview) {
          const mIdx  = staff.measures.findIndex(m => m.id === cursorMeasureId)
          const dyn   = resolveDirectiveDynamic(staff.measures, mIdx)
          const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? part.volume))
          const midi  = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
          const partIdx = score.parts.indexOf(part)
          const ch = Math.min((part.midiChannel ?? (partIdx + 1)) - 1, 15)
          triggerInputPreview(noteWithDot.pitch.noteName, noteWithDot.pitch.octave, noteWithDot.pitch.accidental, volDb, midi === 45, part.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
        }
        setLastEnteredPitch(noteWithDot.pitch)
        setSelectedMeasure(null)
        const newBeat = cursorBeatPosition + units
        if (newBeat >= capacity) {
          const mIdx        = staff.measures.findIndex(m => m.id === cursorMeasureId)
          const nextMeasure = staff.measures[mIdx + 1]
          if (nextMeasure) setCursor(nextMeasure.id, firstRestBeat(nextMeasure.voices[activeVoice]?.events ?? []))
          else             setCursor(null, 0)
        } else {
          setCursor(cursorMeasureId, newBeat)
        }
        return
      }
    }
  }, [score, cursorMeasureId, cursorBeatPosition, selectedDuration, isDotted, activeVoice,
      dispatch, dispatchBatch, setLastEnteredPitch, setCursor, setInputMode, setSelectedMeasure,
      soundOnInput, audioMode])

  // Multi-pitch variant for chord entry from MIDI
  const enterChordAtPitch = useCallback((inputs: import('../services/midiService').NoteInput[]) => {
    if (!cursorMeasureId) {
      setInputMode('note')
      return
    }
    for (const part of score.parts) {
      for (const staff of part.staves) {
        const measure = staff.measures.find(m => m.id === cursorMeasureId)
        if (!measure) continue
        const voice   = measure.voices[0]
        const timeSig = measure.timeSignature ?? score.timeSignature
        const dots    = isDotted ? 1 : 0 as 0 | 1
        const units   = dottedUnits(DURATION_UNITS[selectedDuration], dots)
        if (remainingUnits(voice.events, timeSig) < units) {
          canvasAreaRef.current?.classList.add('cursor-reject')
          setTimeout(() => canvasAreaRef.current?.classList.remove('cursor-reject'), 200)
          return
        }
        const pitches: Pitch[] = inputs
          .map(inp => ({ noteName: inp.noteName as NoteName, octave: inp.octave, accidental: (inp.accidental ?? null) as Accidental }))
          .sort((a, b) => (a.octave * 7 + 'CDEFGAB'.indexOf(a.noteName)) - (b.octave * 7 + 'CDEFGAB'.indexOf(b.noteName)))
        const chord: Chord = { id: uuid(), type: 'chord', pitches, duration: selectedDuration, dots, articulations: [] }
        dispatch({
          type: 'ADD_NOTE',
          partId:    part.id,
          staffId:   staff.id,
          measureId: measure.id,
          voiceId:   voice.id,
          event:     chord,
        })
        // MIDI keyboard already produced sound — no preview
        setLastEnteredPitch(pitches[pitches.length - 1])
        setSelectedMeasure(null)
        const newBeat  = cursorBeatPosition + units
        const capacity = measureCapacityUnits(timeSig)
        if (newBeat >= capacity) {
          const mIdx        = staff.measures.findIndex(m => m.id === cursorMeasureId)
          const nextMeasure = staff.measures[mIdx + 1]
          if (nextMeasure) setCursor(nextMeasure.id, firstRestBeat(nextMeasure.voices[0]?.events ?? []))
          else             setCursor(null, 0)
        } else {
          setCursor(cursorMeasureId, newBeat)
        }
        return
      }
    }
  }, [score, cursorMeasureId, cursorBeatPosition, selectedDuration, isDotted,
      dispatch, setLastEnteredPitch, setCursor, setInputMode, setSelectedMeasure])

  // ── Chord assembly buffer for MIDI input ─────────────────────────────────────
  const CHORD_WINDOW_MS = 50
  const chordBufRef  = useRef<NoteInput[]>([])
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Always-current refs so the timer callback gets the latest callbacks
  const enterNoteRef  = useRef(enterNoteAtPitch)
  const enterChordRef = useRef(enterChordAtPitch)
  useEffect(() => { enterNoteRef.current  = enterNoteAtPitch  }, [enterNoteAtPitch])
  useEffect(() => { enterChordRef.current = enterChordAtPitch }, [enterChordAtPitch])

  // MIDI handler — buffers notes for CHORD_WINDOW_MS then dispatches note or chord
  const midiInputHandler = useCallback((input: NoteInput) => {
    if (inputMode === 'text') return
    if (inputMode !== 'note') setInputMode('note')

    chordBufRef.current.push(input)
    if (chordTimerRef.current !== null) clearTimeout(chordTimerRef.current)
    chordTimerRef.current = setTimeout(() => {
      chordTimerRef.current = null
      const buf = chordBufRef.current
      chordBufRef.current = []
      if (buf.length === 1) {
        enterNoteRef.current(buf[0].noteName, buf[0].octave, buf[0].accidental as Accidental | undefined, true)
      } else if (buf.length > 1) {
        enterChordRef.current(buf)
      }
    }, CHORD_WINDOW_MS)
  }, [inputMode, setInputMode])

  // Virtual keyboard still uses direct (non-buffered) path so it feels instant
  const keyboardInputHandler = useCallback((input: NoteInput) => {
    if (inputMode !== 'note') setInputMode('note')
    enterNoteAtPitch(input.noteName, input.octave, input.accidental as Accidental | undefined)
  }, [enterNoteAtPitch, inputMode, setInputMode])

  const stableKeyboardHandler = useMemo(() => keyboardInputHandler, [keyboardInputHandler])

  useMidiInput(midiInputHandler)

  const enterRest = useCallback(() => {
    if (!cursorMeasureId) return

    for (const part of score.parts) {
      for (const staff of part.staves) {
        const measureIdx = staff.measures.findIndex(m => m.id === cursorMeasureId)
        if (measureIdx === -1) continue
        const measure = staff.measures[measureIdx]

        const existingVoice = measure.voices[activeVoice]
        const voiceEvents   = existingVoice?.events ?? []
        const timeSig = resolveTimeSig(staff.measures, measureIdx, score.timeSignature)
        const dots    = isDotted ? 1 : 0 as 0 | 1
        const units   = dottedUnits(DURATION_UNITS[selectedDuration], dots)

        // Rest-replace: if cursor sits on a rest, collect all consecutive rests and replace
        const atCursor = existingVoice ? findEventAtBeat(voiceEvents, cursorBeatPosition) : null
        if (atCursor?.event.type === 'rest') {
          const rest = createRest(selectedDuration)
          const restWithDot = { ...rest, dots } as typeof rest
          const result = buildRestReplaceCommands(voiceEvents, atCursor.index, units, restWithDot, part.id, staff.id, measure.id, existingVoice.id)
          if (!result) {
            canvasAreaRef.current?.classList.add('cursor-reject')
            setTimeout(() => canvasAreaRef.current?.classList.remove('cursor-reject'), 200)
            return
          }
          dispatchBatch(result.cmds)
          const newBeat  = cursorBeatPosition + units
          const capacity = measureCapacityUnits(timeSig)
          if (newBeat >= capacity) {
            const nextMeasure = staff.measures[measureIdx + 1]
            if (nextMeasure) setCursor(nextMeasure.id, firstRestBeat(nextMeasure.voices[activeVoice]?.events ?? []))
            else             setCursor(null, 0)
          } else {
            setCursor(cursorMeasureId, newBeat)
          }
          return
        }

        // Append path (fallback when cursor is not on a rest)
        if (remainingUnits(voiceEvents, timeSig) < units) {
          canvasAreaRef.current?.classList.add('cursor-reject')
          setTimeout(() => canvasAreaRef.current?.classList.remove('cursor-reject'), 200)
          return
        }

        const rest        = createRest(selectedDuration)
        const restWithDot = { ...rest, dots } as typeof rest
        const targetVoiceId = existingVoice?.id ?? uuid()
        const addNoteCmd: Command = {
          type: 'ADD_NOTE',
          partId:    part.id,
          staffId:   staff.id,
          measureId: measure.id,
          voiceId:   targetVoiceId,
          event:     restWithDot,
        }

        if (!existingVoice) {
          dispatchBatch([
            { type: 'ADD_VOICE', partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: targetVoiceId },
            addNoteCmd,
          ])
        } else {
          dispatch(addNoteCmd)
        }

        const newBeat  = cursorBeatPosition + units
        const capacity = measureCapacityUnits(timeSig)
        if (newBeat >= capacity) {
          const nextMeasure = staff.measures[measureIdx + 1]
          if (nextMeasure) {
            setCursor(nextMeasure.id, firstRestBeat(nextMeasure.voices[activeVoice]?.events ?? []))
          } else {
            setCursor(null, 0)
          }
        } else {
          setCursor(cursorMeasureId, newBeat)
        }
        return
      }
    }
  }, [score, cursorMeasureId, cursorBeatPosition, selectedDuration, isDotted, activeVoice,
      dispatch, dispatchBatch, setCursor])

  const insertTuplet = useCallback((actual: 3 | 5 | 6, normal: 2 | 4) => {
    if (!cursorMeasureId) return
    for (const part of score.parts) {
      for (const staff of part.staves) {
        const measureIdx = staff.measures.findIndex(m => m.id === cursorMeasureId)
        if (measureIdx === -1) continue
        const measure = staff.measures[measureIdx]
        const voice   = measure.voices[0]
        const timeSig = resolveTimeSig(staff.measures, measureIdx, score.timeSignature)
        // Total units the tuplet group occupies = normal * base duration units
        const totalUnits = normal * DURATION_UNITS[selectedDuration]
        if (remainingUnits(voice.events, timeSig) < totalUnits) {
          canvasAreaRef.current?.classList.add('cursor-reject')
          setTimeout(() => canvasAreaRef.current?.classList.remove('cursor-reject'), 200)
          return
        }
        dispatch({ type: 'ADD_TUPLET', partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id, actual, normal, duration: selectedDuration })
        const newBeat = cursorBeatPosition + totalUnits
        const capacity = measureCapacityUnits(timeSig)
        if (newBeat >= capacity) {
          const next = staff.measures[measureIdx + 1]
          if (next) setCursor(next.id, firstRestBeat(next.voices[0]?.events ?? []))
          else      setCursor(null, 0)
        } else {
          setCursor(cursorMeasureId, newBeat)
        }
        return
      }
    }
  }, [score, cursorMeasureId, cursorBeatPosition, selectedDuration, dispatch, setCursor])

  const findFullNoteLocation = useCallback((noteId: string): {
    partId: string; staffId: string; measureId: string; voiceId: string
  } | null => {
    for (const part of score.parts) {
      for (const staff of part.staves) {
        for (const measure of staff.measures) {
          for (const voice of measure.voices) {
            if (voice.events.some(e => e.id === noteId)) {
              return { partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id }
            }
          }
        }
      }
    }
    return null
  }, [score])

  // ── Lyric mode helpers ──────────────────────────────────────────────────────

  const getPitchedEventIds = useCallback((): string[] => {
    const ids: string[] = []
    for (const part of score.parts) {
      for (const staff of part.staves) {
        for (const measure of staff.measures) {
          const voice = measure.voices[0]
          if (!voice) continue
          for (const ev of voice.events) {
            if (ev.type !== 'rest') ids.push(ev.id)
          }
        }
      }
    }
    return ids
  }, [score])

  const commitLyric = useCallback((noteId: string, lyric: string | undefined) => {
    dispatch({ type: 'SET_LYRIC', noteId, lyric })
  }, [dispatch])

  const advanceLyricCursor = useCallback(() => {
    const ids = getPitchedEventIds()
    const idx = lyricCursorNoteId ? ids.indexOf(lyricCursorNoteId) : -1
    if (idx !== -1 && idx + 1 < ids.length) {
      setLyricCursor(ids[idx + 1])
    } else {
      setInputMode('select')
    }
  }, [lyricCursorNoteId, getPitchedEventIds, setLyricCursor, setInputMode])

  const retreatLyricCursor = useCallback(() => {
    const ids = getPitchedEventIds()
    const idx = lyricCursorNoteId ? ids.indexOf(lyricCursorNoteId) : -1
    if (idx > 0) setLyricCursor(ids[idx - 1])
  }, [lyricCursorNoteId, getPitchedEventIds, setLyricCursor])

  const getEventLyric = useCallback((noteId: string): string => {
    for (const part of score.parts) {
      for (const staff of part.staves) {
        for (const measure of staff.measures) {
          for (const voice of measure.voices) {
            const ev = voice.events.find(e => e.id === noteId)
            if (ev && ev.type !== 'rest') return (ev as any).lyric ?? ''
          }
        }
      }
    }
    return ''
  }, [score])

  const lyricInputPos = useMemo(() => {
    if (!lyricCursorNoteId || inputMode !== 'lyric') return null
    const noteX = notePositionsRef.current.get(lyricCursorNoteId)
    if (noteX === undefined) return null
    for (const part of score.parts) {
      for (const staff of part.staves) {
        for (const measure of staff.measures) {
          for (const voice of measure.voices) {
            if (voice.events.some(e => e.id === lyricCursorNoteId)) {
              const layout = layoutsRef.current.find(l => l.measureId === measure.id && l.staffId === staff.id)
              if (layout) return { x: noteX, y: layout.staveTopY + LYRIC_Y_OFFSET }
            }
          }
        }
      }
    }
    return null
  }, [lyricCursorNoteId, inputMode, score])

  useEffect(() => {
    if (!resizeError) return
    const t = setTimeout(() => clearResizeError(), 3000)
    return () => clearTimeout(t)
  }, [resizeError])

  const deleteSelectedNotes = useCallback(() => {
    if (selectedNoteIds.length === 0) return

    if (selectedNoteIds.length === 1) {
      const id  = selectedNoteIds[0]
      const loc = findFullNoteLocation(id)
      if (!loc) return
      const part    = score.parts.find(p => p.id === loc.partId)
      const staff   = part?.staves.find(s => s.id === loc.staffId)
      const measure = staff?.measures.find(m => m.id === loc.measureId)
      const voice   = measure?.voices.find(v => v.id === loc.voiceId)
      if (!voice) return
      const evIdx = voice.events.findIndex(e => e.id === id)
      if (evIdx === -1) return
      const ev = voice.events[evIdx]

      // Individual pitch selected within a chord — remove just that pitch
      if (ev.type === 'chord' && selectedChordPitchIndex !== null) {
        dispatch({ type: 'REMOVE_CHORD_PITCH', ...loc, noteId: id, pitchIndex: selectedChordPitchIndex })
        setSelectedChordPitch(null)
        setChordCycleState(null)
        // Keep chord event selected (may now be a Note after collapse)
        setSelectedNote(id)
        return
      }

      // Find next event ID to select after the operation
      let nextId: string | null = null
      if (evIdx + 1 < voice.events.length) {
        nextId = voice.events[evIdx + 1].id
      } else if (staff) {
        const mIdx = staff.measures.findIndex(m => m.id === loc.measureId)
        for (let i = mIdx + 1; i < staff.measures.length; i++) {
          const v = staff.measures[i].voices.find(v => v.events.length > 0)
          if (v) { nextId = v.events[0].id; break }
        }
      }

      if (ev.type === 'note' || ev.type === 'chord') {
        // Replace note with a rest of the same duration
        const rest = { ...createRest(ev.duration), dots: ev.dots }
        dispatch({ type: 'REPLACE_NOTE', ...loc, noteId: id, event: rest })
      } else {
        // Remove rest entirely
        dispatch({ type: 'DELETE_NOTE', ...loc, noteId: id })
      }
      if (nextId) setSelectedNote(nextId)
      else clearSelection()
      return
    }

    // Multi-select: delete all
    const deletions: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[] = []
    for (const noteId of selectedNoteIds) {
      const loc = findFullNoteLocation(noteId)
      if (loc) deletions.push({ ...loc, noteId })
    }
    if (deletions.length > 0) {
      dispatch({ type: 'DELETE_NOTES', deletions })
      clearSelection()
    }
  }, [score, selectedNoteIds, findFullNoteLocation, dispatch, clearSelection, setSelectedNote])

  const navigateSelection = useCallback((direction: 'prev' | 'next') => {
    const anchorId = selectedNoteId ?? selectedNoteIds[selectedNoteIds.length - 1]
    if (!anchorId) return
    for (const part of score.parts) {
      for (const staff of part.staves) {
        // Build a flat list of all event IDs in voice 0 across all measures
        const flat: string[] = []
        for (const measure of staff.measures) {
          const voice = measure.voices[0]
          if (voice) for (const ev of voice.events) flat.push(ev.id)
        }
        const idx = flat.indexOf(anchorId)
        if (idx === -1) continue
        const targetIdx = direction === 'prev' ? idx - 1 : idx + 1
        if (targetIdx >= 0 && targetIdx < flat.length) {
          setSelectedNote(flat[targetIdx])
        }
        return
      }
    }
  }, [score, selectedNoteId, selectedNoteIds, setSelectedNote])

  // Locate a note event's part and staff (used for tie/slur dispatch)
  const findNoteLocation = useCallback((noteId: string): { partId: string; staffId: string } | null => {
    for (const part of score.parts) {
      for (const staff of part.staves) {
        for (const measure of staff.measures) {
          for (const voice of measure.voices) {
            if (voice.events.some(e => e.id === noteId)) return { partId: part.id, staffId: staff.id }
          }
        }
      }
    }
    return null
  }, [score])

  const toggleTie = useCallback(() => {
    if (!selectedNoteId) return
    const loc = findNoteLocation(selectedNoteId)
    if (!loc) return
    dispatch({ type: 'TOGGLE_TIE', partId: loc.partId, staffId: loc.staffId, noteId: selectedNoteId })
  }, [selectedNoteId, findNoteLocation, dispatch])

  const handleSlurKey = useCallback(() => {
    // Multi-select: apply slur across the full selection
    if (selectedNoteIds.length > 1) {
      const fromId  = selectedNoteIds[0]
      const toId    = selectedNoteIds[selectedNoteIds.length - 1]
      const fromLoc = findNoteLocation(fromId)
      const toLoc   = findNoteLocation(toId)
      if (fromLoc && toLoc && fromLoc.staffId === toLoc.staffId) {
        const slur: Slur = { id: uuid(), fromNoteId: fromId, toNoteId: toId }
        dispatch({ type: 'ADD_SLUR', partId: fromLoc.partId, staffId: fromLoc.staffId, slur })
      }
      return
    }

    if (!selectedNoteId) return
    if (slurPendingId) {
      setSlurPendingId(null)  // cancel pending
      return
    }
    // If note already has an outgoing slur, remove it
    for (const part of score.parts) {
      for (const staff of part.staves) {
        const existing = staff.slurs?.find(s => s.fromNoteId === selectedNoteId)
        if (existing) {
          dispatch({ type: 'REMOVE_SLUR', partId: part.id, staffId: staff.id, slurId: existing.id })
          return
        }
      }
    }
    // Start pending — slur commits when a different note is next selected
    setSlurPendingId(selectedNoteId)
  }, [selectedNoteId, selectedNoteIds, slurPendingId, score, dispatch, findNoteLocation])

  // Auto-commit slur when user selects a different note while slurPendingId is active.
  // findNoteLocation/dispatch intentionally omitted from deps: including findNoteLocation
  // (which changes when score changes) would re-fire the effect after the ADD_SLUR dispatch,
  // creating an infinite update loop. The closures captured at selection-change time are correct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!slurPendingId || !selectedNoteId || slurPendingId === selectedNoteId) return
    const fromLoc = findNoteLocation(slurPendingId)
    const toLoc   = findNoteLocation(selectedNoteId)
    if (fromLoc && toLoc && fromLoc.staffId === toLoc.staffId) {
      const slur: Slur = { id: uuid(), fromNoteId: slurPendingId, toNoteId: selectedNoteId }
      dispatch({ type: 'ADD_SLUR', partId: fromLoc.partId, staffId: fromLoc.staffId, slur })
    }
    setSlurPendingId(null)
  }, [selectedNoteId, slurPendingId])

  const nudgeOctave = useCallback((direction: 1 | -1) => {
    if (!selectedNoteId) return
    for (const part of score.parts) {
      for (const staff of part.staves) {
        for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
          const measure = staff.measures[mIdx]
          for (const voice of measure.voices) {
            const event = voice.events.find(e => e.id === selectedNoteId)
            if (!event || event.type !== 'note') return
            const note = event as Note
            const newOctave = note.pitch.octave + direction
            if (newOctave < 0 || newOctave > 9) return
            const updated = { ...note, pitch: { ...note.pitch, octave: newOctave } } as Note
            dispatch({
              type: 'REPLACE_NOTE',
              partId:    part.id,
              staffId:   staff.id,
              measureId: measure.id,
              voiceId:   voice.id,
              noteId:    selectedNoteId,
              event:     updated,
            })
            if (soundOnInput) {
              const dyn   = resolveDirectiveDynamic(staff.measures, mIdx)
              const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? part.volume))
              const midi  = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
              const partIdx = score.parts.indexOf(part)
              const ch = Math.min((part.midiChannel ?? (partIdx + 1)) - 1, 15)
              triggerInputPreview(updated.pitch.noteName, newOctave, updated.pitch.accidental, volDb, midi === 45, part.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
            }
            return
          }
        }
      }
    }
  }, [score, selectedNoteId, dispatch, soundOnInput, audioMode])

  const moveSelectedNotes = useCallback((direction: 'up' | 'down') => {
    if (selectedNoteIds.length === 0) return
    const delta = direction === 'up' ? 1 : -1

    // Individual pitch selected within a chord — shift only that pitch via REPLACE_NOTE
    if (selectedNoteIds.length === 1 && selectedChordPitchIndex !== null) {
      const id  = selectedNoteIds[0]
      const loc = findFullNoteLocation(id)
      if (!loc) return
      const voice = score.parts.find(p => p.id === loc.partId)
        ?.staves.find(s => s.id === loc.staffId)
        ?.measures.find(m => m.id === loc.measureId)
        ?.voices.find(v => v.id === loc.voiceId)
      const ev = voice?.events.find(e => e.id === id)
      if (!ev || ev.type !== 'chord') return
      const newPitches = ev.pitches.map((p, i) => {
        if (i !== selectedChordPitchIndex) return p
        return shiftPitchBySemitones(p.noteName, p.octave, p.accidental, delta)
      })
      const newChord = { ...ev, pitches: newPitches } as import('@shared/score').Chord
      dispatch({ type: 'REPLACE_NOTE', ...loc, noteId: id, event: newChord })
      return
    }

    const moves: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[] = []
    for (const noteId of selectedNoteIds) {
      const loc = findFullNoteLocation(noteId)
      if (loc) moves.push({ ...loc, noteId })
    }
    if (moves.length === 0) return
    dispatch({ type: 'MOVE_NOTES_STEP', moves, direction })
    if (soundOnInput && selectedNoteIds.length === 1) {
      const id = selectedNoteIds[0]
      const delta = direction === 'up' ? 1 : -1
      outer: for (const part of score.parts) {
        for (const staff of part.staves) {
          for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
            for (const voice of staff.measures[mIdx].voices) {
              const ev = voice.events.find(e => e.id === id)
              if (!ev || ev.type !== 'note') continue
              const newPitch = shiftPitchBySemitones(ev.pitch.noteName, ev.pitch.octave, ev.pitch.accidental, delta)
              const dyn   = resolveDirectiveDynamic(staff.measures, mIdx)
              const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? part.volume))
              const midi  = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
              const partIdx = score.parts.indexOf(part)
              const ch = Math.min((part.midiChannel ?? (partIdx + 1)) - 1, 15)
              triggerInputPreview(newPitch.noteName, newPitch.octave, newPitch.accidental, volDb, midi === 45, part.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
              break outer
            }
          }
        }
      }
    }
  }, [selectedNoteIds, selectedChordPitchIndex, findFullNoteLocation, dispatch, soundOnInput, score, audioMode])

  const transposeSelectedNotes = useCallback((semitones: number) => {
    if (selectedNoteIds.length === 0) return
    const moves: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[] = []
    for (const noteId of selectedNoteIds) {
      const loc = findFullNoteLocation(noteId)
      if (loc) moves.push({ ...loc, noteId })
    }
    if (moves.length > 0) dispatch({ type: 'TRANSPOSE_NOTES', moves, semitones })
  }, [selectedNoteIds, findFullNoteLocation, dispatch])

  const selectAllInMeasure = useCallback(() => {
    // Find the measure that contains the anchor/last selected note, or fall back to cursor
    const refId = selectedNoteId ?? null
    let targetPartId: string | null = null
    let targetStaffId: string | null = null
    let targetMeasureId: string | null = null

    if (refId) {
      for (const part of score.parts) {
        for (const staff of part.staves) {
          for (const measure of staff.measures) {
            if (measure.voices.some(v => v.events.some(e => e.id === refId))) {
              targetPartId    = part.id
              targetStaffId   = staff.id
              targetMeasureId = measure.id
            }
          }
        }
      }
    }
    if (!targetMeasureId) targetMeasureId = cursorMeasureId
    if (!targetMeasureId) return

    const ids: string[] = []
    for (const part of score.parts) {
      if (targetPartId && part.id !== targetPartId) continue
      for (const staff of part.staves) {
        if (targetStaffId && staff.id !== targetStaffId) continue
        const measure = staff.measures.find(m => m.id === targetMeasureId)
        if (!measure) continue
        for (const voice of measure.voices) {
          for (const event of voice.events) ids.push(event.id)
        }
        break
      }
      break
    }
    if (ids.length > 0) setSelectedNotes(ids, ids[ids.length - 1])
  }, [score, selectedNoteId, cursorMeasureId, setSelectedNotes])

  // ── Context menu drag ──────────────────────────────────────────────────────

  const handleMenuDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    menuDragRef.current = { startX: e.clientX, startY: e.clientY, startOffX: menuDragOffset.x, startOffY: menuDragOffset.y }
    setIsDraggingMenu(true)
    const onMove = (ev: MouseEvent) => {
      if (!menuDragRef.current) return
      setMenuDragOffset({
        x: menuDragRef.current.startOffX + ev.clientX - menuDragRef.current.startX,
        y: menuDragRef.current.startOffY + ev.clientY - menuDragRef.current.startY,
      })
    }
    const onUp = () => {
      menuDragRef.current = null
      setIsDraggingMenu(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [menuDragOffset])

  // ── Keyboard handler ────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Skip if user is typing in an input or a rich-text editor
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.target as HTMLElement).isContentEditable) return

      const mod = e.metaKey || e.ctrlKey

      // During playback: allow escape/select-mode switch and navigation; block mutations
      if (isPlaying) {
        if (e.key === 'Escape') { setInputMode('select'); setSlurPendingId(null); setSelectedMeasure(null); setBarSelection(null); setSelectionMenuPos(null); return }
        if (!mod && (e.key === 's' || e.key === 'S')) { setInputMode('select'); return }
        if (!mod && (e.key === 'k' || e.key === 'K')) { toggleKeyboard(); return }
        if (!mod && inputMode === 'select' && selectedNoteIds.length > 0) {
          if (e.key === 'ArrowLeft')  { e.preventDefault(); setChordCycleState(null); setSelectedChordPitch(null); navigateSelection('prev'); return }
          if (e.key === 'ArrowRight') { e.preventDefault(); setChordCycleState(null); setSelectedChordPitch(null); navigateSelection('next'); return }
        }
        return
      }

      // Escape → select mode + cancel pending slur + deselect everything
      if (e.key === 'Escape') {
        setSlurPendingId(null)
        setInputMode('select')
        setSelectedMeasure(null)
        setBarSelection(null)
        setSelectionMenuPos(null)
        return
      }

      // Select-all in measure (Ctrl/Cmd+A)
      if (mod && (e.key === 'a' || e.key === 'A') && inputMode === 'select') {
        e.preventDefault()
        selectAllInMeasure()
        return
      }

      // Insert bar after cursor/selected measure (Ctrl/Cmd+B)
      if (mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault()
        insertMeasure()
        return
      }

      // Tuplet shortcut: T in note or rest input mode → insert triplet
      if (!mod && !e.shiftKey && e.key === 't' && (inputMode === 'note' || inputMode === 'rest')) {
        insertTuplet(3, 2); return
      }
      // Tie shortcut: T (no shift, no mod) in select mode with note selected
      if (!mod && !e.shiftKey && e.key === 't' && inputMode === 'select' && selectedNoteId) {
        toggleTie(); return
      }
      // Slur shortcut: L in select mode with note selected
      if (!mod && inputMode === 'select' && selectedNoteId && (e.key === 'l' || e.key === 'L')) {
        handleSlurKey(); return
      }
      // Shift+T → switch to transpose tab (select mode, notes selected)
      if (!mod && e.shiftKey && e.key === 'T' && inputMode === 'select' && selectedNoteIds.length > 0) {
        setContextMenuTab('transpose'); return
      }

      // Arrow keys in select mode: left/right navigate, up/down transpose
      if (!mod && inputMode === 'select' && selectedNoteIds.length > 0) {
        if (e.key === 'ArrowLeft')  { e.preventDefault(); setChordCycleState(null); setSelectedChordPitch(null); navigateSelection('prev'); return }
        if (e.key === 'ArrowRight') { e.preventDefault(); setChordCycleState(null); setSelectedChordPitch(null); navigateSelection('next'); return }
        if (e.key === 'ArrowUp')    { e.preventDefault(); moveSelectedNotes('up');   return }
        if (e.key === 'ArrowDown')  { e.preventDefault(); moveSelectedNotes('down'); return }
      }
      if (inputMode === 'note' && !mod) {
        if (e.key === 'ArrowUp')   { e.preventDefault(); setPrimedAccidental('sharp'); return }
        if (e.key === 'ArrowDown') { e.preventDefault(); setPrimedAccidental('flat');  return }
        if (e.key === '0')         {                      setPrimedAccidental('natural'); return }
      }

      // Mode shortcuts (no modifier, no shift)
      if (!mod && !e.shiftKey) {
        if (e.key === 'n' || e.key === 'N') { setInputMode('note');   return }
        if (e.key === 'r' || e.key === 'R') { setInputMode('rest');   return }
        if (e.key === 's' || e.key === 'S') { setInputMode('select'); return }
        if (e.key === 't' || e.key === 'T') { setInputMode('text');   return }
        if (e.key === 'l' || e.key === 'L') { setInputMode('lyric');  return }
        if (e.key === 'm' || e.key === 'M') { setInputMode('midi');   return }
        if (e.key === 'k' || e.key === 'K') { toggleKeyboard();       return }
      }

      // Duration keys 1–7 (no modifier)
      if (!mod && KEY_TO_DURATION[e.key]) {
        const dur = KEY_TO_DURATION[e.key]
        if (inputMode === 'select') {
          if (selectedNoteIds.length === 1) {
            resizeNote(dur, 0)
            return
          }
          if (selectedNoteIds.length > 1) {
            setSelectedDuration(dur)
            const idSet = new Set(selectedNoteIds)
            const cmds: { type: 'SET_NOTE_DURATION'; partId: string; staffId: string; measureId: string; voiceId: string; noteId: string; duration: typeof dur }[] = []
            for (const part of score.parts) {
              for (const staff of part.staves) {
                for (const measure of staff.measures) {
                  for (const voice of measure.voices) {
                    for (const ev of voice.events) {
                      if (idSet.has(ev.id)) {
                        cmds.push({ type: 'SET_NOTE_DURATION', partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id, noteId: ev.id, duration: dur })
                      }
                    }
                  }
                }
              }
            }
            if (cmds.length > 0) { dispatchBatch(cmds as any); return }
          }
        }
        setSelectedDuration(dur)
        return
      }

      // Dot toggle
      if (!mod && e.key === '.') { toggleDot(); return }

      // Octave nudge on selected note (Ctrl/Cmd + arrow)
      if (mod && e.key === 'ArrowUp')   { e.preventDefault(); nudgeOctave(+1); return }
      if (mod && e.key === 'ArrowDown') { e.preventDefault(); nudgeOctave(-1); return }

      // Pitch entry (note mode, no modifier)
      if (inputMode === 'note' && !mod) {
        const PITCH_KEYS: Record<string, NoteName> = {
          a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F', g: 'G',
          A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G',
        }
        const noteName = PITCH_KEYS[e.key]
        if (noteName) { enterNote(noteName); return }
      }

      // Rest entry: Space/Enter in rest mode, or Space in note mode
      if (!mod && (e.key === ' ' || e.key === 'Enter') && (inputMode === 'rest' || inputMode === 'note')) {
        e.preventDefault()
        enterRest()
        return
      }

      // Delete / Backspace — bar selection takes priority, then measure, then notes
      if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (barSelection) {
          deleteSelectedBars()
          return
        }
        if (selectedMeasureId) {
          deleteMeasure(selectedMeasureId)
        } else {
          deleteSelectedNotes()
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    inputMode, score, selectedNoteId, selectedNoteIds, slurPendingId,
    enterNote, enterRest, deleteSelectedNotes, nudgeOctave,
    moveSelectedNotes, navigateSelection, selectAllInMeasure,
    toggleTie, handleSlurKey,
    setInputMode, setSelectedDuration, toggleDot, resizeNote, setPrimedAccidental, dispatch, dispatchBatch, toggleKeyboard,
    insertMeasure, deleteMeasure, selectedMeasureId, insertTuplet,
    barSelection, deleteSelectedBars, setBarSelection,
    isPlaying,
  ])

  // Set cursor when first entering note/rest mode
  useEffect(() => {
    if ((inputMode === 'note' || inputMode === 'rest') && !cursorMeasureId) {
      moveCursorToFirstAvailable()
    }
  }, [inputMode])

  // Hide selection context menu when leaving select mode
  useEffect(() => {
    if (inputMode !== 'select') setSelectionMenuPos(null)
  }, [inputMode])

  // ── Shift-key cursor indicator ──────────────────────────────────────────────

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeldRef.current = true }
    const up   = (e: KeyboardEvent) => {
      if (e.key === 'Shift') { shiftHeldRef.current = false; setShiftHoverOnNote(false) }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLDivElement>): void => {
    const canvas = canvasAreaRef.current
    if (!canvas) return
    const { x: canvasX, y: canvasY } = canvasCoords(event, canvas)

    // ── Shift+hover: chord-building indicator (note mode only) ─────────────
    if (inputMode === 'note' && shiftHeldRef.current) {
      const layout = findClickedLayout(canvasX, canvasY, layoutsRef.current)
      if (layout) {
        const part    = score.parts.find(p => p.id === layout.partId)
        const staff   = part?.staves.find(s => s.id === layout.staffId)
        const measure = staff?.measures.find(m => m.id === layout.measureId)
        const voice   = measure?.voices[activeVoice]
        if (voice) {
          for (const ev of voice.events) {
            if (ev.type !== 'note' && ev.type !== 'chord') continue
            const noteX = notePositionsRef.current.get(ev.id)
            if (noteX !== undefined && Math.abs(canvasX - noteX) <= 20) {
              if (!shiftHoverOnNote) setShiftHoverOnNote(true)
              return
            }
          }
        }
      }
      if (shiftHoverOnNote) setShiftHoverOnNote(false)
    } else {
      if (shiftHoverOnNote) setShiftHoverOnNote(false)
    }

    // ── Hover cursor: note/rest insertion mode ──────────────────────────────
    if (inputMode === 'note' || inputMode === 'rest') {
      const layout = findClickedLayout(canvasX, canvasY, layoutsRef.current)
      if (!layout) {
        if (hoverCursor !== 'default') setHoverCursor('default')
        return
      }
      const part    = score.parts.find(p => p.id === layout.partId)
      const staff   = part?.staves.find(s => s.id === layout.staffId)
      const measure = staff?.measures.find(m => m.id === layout.measureId)
      const voice   = measure?.voices[activeVoice]
      const voiceEvents = voice?.events ?? []
      // Valid when there's at least one rest to replace (or voice is brand-new).
      // remainingUnits() counts rests as used capacity, so a full-rest measure
      // would wrongly read as 0 remaining — check for rests directly instead.
      const hasRest = voiceEvents.length === 0 || voiceEvents.some(e => e.type === 'rest')
      const next = hasRest ? 'valid' : 'invalid'
      if (hoverCursor !== next) setHoverCursor(next)
      return
    }

    // ── Hover cursor: select mode ───────────────────────────────────────────
    if (inputMode === 'select') {
      const layout = findClickedLayout(canvasX, canvasY, layoutsRef.current)
      if (layout) {
        const part    = score.parts.find(p => p.id === layout.partId)
        const staff   = part?.staves.find(s => s.id === layout.staffId)
        const measure = staff?.measures.find(m => m.id === layout.measureId)
        if (measure) {
          for (const voice of measure.voices) {
            if (!voice) continue
            for (const ev of voice.events) {
              const noteX = notePositionsRef.current.get(ev.id)
              if (noteX !== undefined && Math.abs(canvasX - noteX) <= 20) {
                if (hoverCursor !== 'hand') setHoverCursor('hand')
                return
              }
            }
          }
        }
      }
      if (hoverCursor !== 'default') setHoverCursor('default')
      return
    }

    // ── Hover cursor: MIDI mode ─────────────────────────────────────────────
    if (inputMode === 'midi') {
      const overMidiZone = layoutsRef.current.some(l => {
        const staveBottom = l.staveTopY + STAVE_HEIGHT_PX
        return (
          canvasX >= l.x && canvasX <= l.x + l.width &&
          canvasY >= staveBottom + 2 && canvasY <= staveBottom + PEDAL_BASE_BELOW_STAVE + 42
        )
      })
      const next = overMidiZone ? 'valid' : 'default'
      if (hoverCursor !== next) setHoverCursor(next)
      return
    }

    if (hoverCursor !== 'default') setHoverCursor('default')
  }

  // ── Mouse click handler ─────────────────────────────────────────────────────

  const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const canvas = canvasAreaRef.current
    if (!canvas) return

    const { x: canvasX, y: canvasY } = canvasCoords(event, canvas)
    const options = getRenderOptions(zoom, score.showPartLabels)

    // ── Heading area (above all staves) ─────────────────────────────────────
    if (canvasY < HEADING_MARGIN_Y) {
      const bounds = headingFieldBounds(options.canvasWidth, options.marginX)
      const hit = bounds.find(b =>
        canvasX >= b.x && canvasX <= b.x + b.width &&
        canvasY >= b.y && canvasY <= b.y + b.height
      )
      if (hit) setEditingHeading(hit)
      return
    }

    const layouts = layoutsRef.current

    // ── Directive zone: headroom above each stave (Text mode only) ──────────
    if (inputMode === 'text' && !isPlaying) for (const l of layouts) {
      if (
        canvasX >= l.x && canvasX <= l.x + l.width &&
        canvasY >= l.staveY && canvasY < l.staveTopY
      ) {
        const part  = score.parts.find(p => p.id === l.partId)
        const staff = part?.staves.find(s => s.id === l.staffId)
        const measure = staff?.measures.find(m => m.id === l.measureId)
        if (!measure) break
        const rect = canvas.getBoundingClientRect()
        setDirectivePickerState({
          measureId:  l.measureId,
          partId:     l.partId,
          staffId:    l.staffId,
          existing:   measure.directives ?? [],
          isFirstPart: part === score.parts[0],
          screenX:    rect.left + canvasX,
          screenY:    rect.top  + l.staveTopY,
        })
        return
      }
    }

    // ── Pedal mark zone: below each stave (Text mode only) ──────────────────
    // Zone covers the full dynamic pedal range (base + max note overhang headroom).
    if (inputMode === 'text' && !isPlaying) for (const l of layouts) {
      const staveBottom = l.staveTopY + STAVE_HEIGHT_PX
      if (
        canvasX >= l.x && canvasX <= l.x + l.width &&
        canvasY >= staveBottom + 2 && canvasY <= staveBottom + PEDAL_BASE_BELOW_STAVE + 20
      ) {
        const part  = score.parts.find(p => p.id === l.partId)
        const staff = part?.staves.find(s => s.id === l.staffId)
        const measure = staff?.measures.find(m => m.id === l.measureId)
        if (!measure || !staff) break
        const mIdx     = staff.measures.findIndex(m => m.id === l.measureId)
        const timeSig  = resolveTimeSig(staff.measures, mIdx, score.timeSignature)
        const capacity = measureCapacityUnits(timeSig)
        const noteAreaOffset = l.isLineStart ? 70 : 20
        const noteAreaStart  = l.x + noteAreaOffset
        const noteAreaWidth  = l.width - noteAreaOffset
        const beatPos = Math.max(0, Math.min(capacity - 1, Math.round(
          (canvasX - noteAreaStart) / noteAreaWidth * capacity
        )))
        const rect = canvas.getBoundingClientRect()
        setPedalMarkPickerState({
          measureId:   l.measureId,
          partId:      l.partId,
          staffId:     l.staffId,
          existing:    measure.pedalMarks ?? [],
          beatPosition: beatPos,
          capacity,
          screenX:     rect.left + canvasX,
          screenY:     rect.top  + staveBottom + 4,
        })
        return
      }
    }

    // ── MIDI event zone: below each stave (MIDI mode only) ───────────────────
    // Zone covers both pedal level and MIDI level so either can be targeted.
    if (inputMode === 'midi' && !isPlaying) for (const l of layouts) {
      const staveBottom = l.staveTopY + STAVE_HEIGHT_PX
      if (
        canvasX >= l.x && canvasX <= l.x + l.width &&
        canvasY >= staveBottom + 2 && canvasY <= staveBottom + PEDAL_BASE_BELOW_STAVE + 42
      ) {
        const part  = score.parts.find(p => p.id === l.partId)
        const staff = part?.staves.find(s => s.id === l.staffId)
        const measure = staff?.measures.find(m => m.id === l.measureId)
        if (!measure || !staff) break
        const mIdx = staff.measures.findIndex(m => m.id === l.measureId)
        const timeSig  = resolveTimeSig(staff.measures, mIdx, score.timeSignature)
        const capacity = measureCapacityUnits(timeSig)
        // Approximate beat position from X: offset ~70px on line starts for clef/key/time
        const noteAreaOffset = l.isLineStart ? 70 : 20
        const noteAreaStart  = l.x + noteAreaOffset
        const noteAreaWidth  = l.width - noteAreaOffset
        const beatPos = Math.max(0, Math.min(capacity, Math.round(
          (canvasX - noteAreaStart) / noteAreaWidth * capacity
        )))
        const rect = canvas.getBoundingClientRect()
        setMidiEventPickerState({
          measureId:   l.measureId,
          partId:      l.partId,
          staffId:     l.staffId,
          existing:    measure.midiEvents ?? [],
          beatPosition: beatPos,
          capacity,
          screenX:     rect.left + canvasX,
          screenY:     rect.top  + staveBottom + 4,
        })
        return
      }
    }

    // ── Lyric text click: select or lyric mode → enter lyric edit for that note ──
    if (inputMode === 'select' || inputMode === 'lyric') {
      for (const l of layouts) {
        const lyricY = l.staveTopY + LYRIC_Y_OFFSET
        if (Math.abs(canvasY - lyricY) > 14) continue
        const lPart   = score.parts.find(p => p.id === l.partId)
        const lStaff  = lPart?.staves.find(s => s.id === l.staffId)
        const lMeasure = lStaff?.measures.find(m => m.id === l.measureId)
        if (!lMeasure) continue
        const lVoice = lMeasure.voices[0]
        if (!lVoice) continue
        let closest: { id: string; dist: number } | null = null
        for (const ev of lVoice.events) {
          if (ev.type === 'rest') continue
          const nx = notePositionsRef.current.get(ev.id)
          if (nx === undefined) continue
          const dist = Math.abs(canvasX - nx)
          if (dist <= 28 && (!closest || dist < closest.dist)) closest = { id: ev.id, dist }
        }
        if (closest) {
          if (inputMode !== 'lyric') setInputMode('lyric')
          setLyricCursor(closest.id)
          return
        }
      }
    }

    const layout  = findClickedLayout(canvasX, canvasY, layouts)
    if (!layout) {
      // Clicked outside all measures — clear all selections and context menus
      clearSelection()
      setSelectionMenuPos(null)
      setSelectedMeasure(null)
      return
    }

    if (inputMode === 'note') {
      if (isPlaying) return
      const part    = score.parts.find(p => p.id === layout.partId)
      const staff   = part?.staves.find(s => s.id === layout.staffId)
      const measure = staff?.measures.find(m => m.id === layout.measureId)
      if (!measure) return
      const existingVoice = measure.voices[activeVoice]
      const voiceEvents   = existingVoice?.events ?? []
      const timeSig = measure.timeSignature ?? score.timeSignature
      const dots    = isDotted ? 1 : 0 as 0 | 1
      const units   = dottedUnits(DURATION_UNITS[selectedDuration], dots)
      const capacity = measureCapacityUnits(timeSig)

      // Check if the click landed on an existing note or rest
      if (existingVoice) {
        let beatAcc = 0
        for (let i = 0; i < voiceEvents.length; i++) {
          const ev      = voiceEvents[i]
          const evUnits = eventDurationUnits(ev)
          const noteX   = notePositionsRef.current.get(ev.id)
          if (noteX !== undefined && Math.abs(canvasX - noteX) <= 20) {
            if (ev.type === 'note' || ev.type === 'chord') {
              if (event.shiftKey) {
                // Shift+click: build chord or change duration on this note
                const step      = yToStep(canvasY, layout.staveTopY, LINE_SPACING_PX)
                const pitchInfo = stepToPitch(step, layout.clef)
                const clickAccidental = primedAccidental as Accidental
                const existingEvent = ev
                const isSamePitch = existingEvent.type === 'note' &&
                  existingEvent.pitch.noteName === pitchInfo.noteName &&
                  existingEvent.pitch.octave   === pitchInfo.octave
                let newEvent: NoteEvent
                if (isSamePitch) {
                  newEvent = { ...(existingEvent as Note), duration: selectedDuration, dots } as Note
                } else {
                  const newPitch: Pitch = { noteName: pitchInfo.noteName, octave: pitchInfo.octave, accidental: clickAccidental ?? null }
                  if (existingEvent.type === 'chord') {
                    const sortedPitches = [...existingEvent.pitches, newPitch].sort((a, b) =>
                      (a.octave * 7 + 'CDEFGAB'.indexOf(a.noteName)) - (b.octave * 7 + 'CDEFGAB'.indexOf(b.noteName))
                    )
                    newEvent = { ...existingEvent, pitches: sortedPitches, duration: selectedDuration, dots } as Chord
                  } else {
                    const sortedPitches = [(existingEvent as Note).pitch, newPitch].sort((a, b) =>
                      (a.octave * 7 + 'CDEFGAB'.indexOf(a.noteName)) - (b.octave * 7 + 'CDEFGAB'.indexOf(b.noteName))
                    )
                    newEvent = {
                      id: uuid(), type: 'chord', pitches: sortedPitches,
                      duration: selectedDuration, dots,
                      articulations: (existingEvent as Note).articulations ?? [],
                    } as Chord
                  }
                }
                const result = buildNoteInsertCommands(voiceEvents, i, units, newEvent, layout.partId, layout.staffId, layout.measureId, existingVoice.id)
                if (!result) {
                  canvasAreaRef.current?.classList.add('cursor-reject')
                  setTimeout(() => canvasAreaRef.current?.classList.remove('cursor-reject'), 200)
                  return
                }
                dispatchBatch(result.cmds)
                if (soundOnInput && part) {
                  const mIdx  = staff!.measures.findIndex(m => m.id === layout.measureId)
                  const dyn   = resolveDirectiveDynamic(staff!.measures, mIdx)
                  const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? part.volume))
                  const midi  = resolveDirectiveMidiProgram(staff!.measures, mIdx, part.midiProgram)
                  const partIdx = score.parts.indexOf(part)
                  const ch = Math.min((part.midiChannel ?? (partIdx + 1)) - 1, 15)
                  const previewPitch = newEvent.type === 'chord'
                    ? (newEvent as Chord).pitches[(newEvent as Chord).pitches.length - 1]
                    : (newEvent as Note).pitch
                  triggerInputPreview(previewPitch.noteName, previewPitch.octave, previewPitch.accidental, volDb, midi === 45, part.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
                }
                setPrimedAccidental(null)
                const lastPitch = newEvent.type === 'chord'
                  ? (newEvent as Chord).pitches[(newEvent as Chord).pitches.length - 1]
                  : (newEvent as Note).pitch
                setLastEnteredPitch(lastPitch)
                const newBeat = beatAcc + units
                if (newBeat >= capacity) {
                  const mIdx = staff!.measures.findIndex(m => m.id === layout.measureId)
                  const nextMeasure = staff!.measures[mIdx + 1]
                  if (nextMeasure) setCursor(nextMeasure.id, firstRestBeat(nextMeasure.voices[activeVoice]?.events ?? []))
                  else             setCursor(null, 0)
                } else {
                  setCursor(layout.measureId, newBeat)
                }
              } else {
                // Plain click: position cursor at this note for chord-building via keyboard
                setCursor(layout.measureId, beatAcc)
              }
              return
            }
            if (ev.type === 'rest') {
              const step      = yToStep(canvasY, layout.staveTopY, LINE_SPACING_PX)
              const pitchInfo = stepToPitch(step, layout.clef)
              const accidental = primedAccidental as Accidental
              const note        = createNote(pitchInfo.noteName, pitchInfo.octave, selectedDuration, accidental)
              const noteWithDot = { ...note, dots } as Note
              const result = buildRestReplaceCommands(voiceEvents, i, units, noteWithDot, layout.partId, layout.staffId, layout.measureId, existingVoice.id)
              if (!result) return
              dispatchBatch(result.cmds)
              if (soundOnInput && part) {
                const mIdx  = staff!.measures.findIndex(m => m.id === layout.measureId)
                const dyn   = resolveDirectiveDynamic(staff!.measures, mIdx)
                const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? part.volume))
                const midi  = resolveDirectiveMidiProgram(staff!.measures, mIdx, part.midiProgram)
                const partIdx = score.parts.indexOf(part)
                const ch = Math.min((part.midiChannel ?? (partIdx + 1)) - 1, 15)
                triggerInputPreview(noteWithDot.pitch.noteName, noteWithDot.pitch.octave, noteWithDot.pitch.accidental, volDb, midi === 45, part.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
              }
              setPrimedAccidental(null)
              setLastEnteredPitch(noteWithDot.pitch)
              const newBeat = beatAcc + units
              if (newBeat >= capacity) {
                const mIdx = staff!.measures.findIndex(m => m.id === layout.measureId)
                const nextMeasure = staff!.measures[mIdx + 1]
                if (nextMeasure) setCursor(nextMeasure.id, firstRestBeat(nextMeasure.voices[activeVoice]?.events ?? []))
                else             setCursor(null, 0)
              } else {
                setCursor(layout.measureId, newBeat)
              }
              return
            }
          }
          beatAcc += evUnits
        }
      }

      // No event hit — append at end of existing events
      const freeAt = firstRestBeat(voiceEvents)
      if (freeAt >= capacity) return
      setCursor(layout.measureId, freeAt)

      const step      = yToStep(canvasY, layout.staveTopY, LINE_SPACING_PX)
      const pitchInfo = stepToPitch(step, layout.clef)
      if (remainingUnits(voiceEvents, timeSig) < units) return

      const accidental  = primedAccidental as Accidental
      const note        = createNote(pitchInfo.noteName, pitchInfo.octave, selectedDuration, accidental)
      const noteWithDot = { ...note, dots } as Note
      const targetVoiceId = existingVoice?.id ?? uuid()
      const addNoteCmd: Command = {
        type: 'ADD_NOTE',
        partId:    layout.partId,
        staffId:   layout.staffId,
        measureId: layout.measureId,
        voiceId:   targetVoiceId,
        event:     noteWithDot,
      }

      if (!existingVoice) {
        dispatchBatch([
          { type: 'ADD_VOICE', partId: layout.partId, staffId: layout.staffId, measureId: layout.measureId, voiceId: targetVoiceId },
          addNoteCmd,
        ])
      } else {
        dispatch(addNoteCmd)
      }

      if (soundOnInput) {
        const clickPart  = score.parts.find(p => p.id === layout.partId)
        const clickStaff = clickPart?.staves.find(s => s.id === layout.staffId)
        if (clickPart && clickStaff) {
          const mIdx  = clickStaff.measures.findIndex(m => m.id === layout.measureId)
          const dyn   = resolveDirectiveDynamic(clickStaff.measures, mIdx)
          const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? clickPart.volume))
          const midi  = resolveDirectiveMidiProgram(clickStaff.measures, mIdx, clickPart.midiProgram)
          const partIdx = score.parts.indexOf(clickPart)
          const ch = Math.min((clickPart.midiChannel ?? (partIdx + 1)) - 1, 15)
          triggerInputPreview(noteWithDot.pitch.noteName, noteWithDot.pitch.octave, noteWithDot.pitch.accidental, volDb, midi === 45, clickPart.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
        }
      }

      setPrimedAccidental(null)
      setLastEnteredPitch(noteWithDot.pitch)

      const newBeat = freeAt + units
      if (newBeat >= capacity) {
        const measureIdx  = staff!.measures.findIndex(m => m.id === layout.measureId)
        const nextMeasure = staff!.measures[measureIdx + 1]
        if (nextMeasure) {
          setCursor(nextMeasure.id, firstRestBeat(nextMeasure.voices[activeVoice]?.events ?? []))
        } else {
          setCursor(null, 0)
        }
      } else {
        setCursor(layout.measureId, newBeat)
      }
      return
    }

    if (inputMode === 'rest') {
      if (isPlaying) return
      const part    = score.parts.find(p => p.id === layout.partId)
      const staff   = part?.staves.find(s => s.id === layout.staffId)
      if (!staff) return
      const mIdx    = staff.measures.findIndex(m => m.id === layout.measureId)
      if (mIdx === -1) return
      const measure = staff.measures[mIdx]
      const voice   = measure.voices[0]
      const timeSig = resolveTimeSig(staff.measures, mIdx, score.timeSignature)
      const capacity = measureCapacityUnits(timeSig)
      const freeAt   = firstRestBeat(voice?.events ?? [])
      if (freeAt >= capacity) return

      setCursor(layout.measureId, freeAt)

      const dots  = isDotted ? 1 : 0 as 0 | 1
      const units = dottedUnits(DURATION_UNITS[selectedDuration], dots)
      if (remainingUnits(voice.events, timeSig) < units) return

      const rest        = createRest(selectedDuration)
      const restWithDot = { ...rest, dots } as typeof rest

      dispatch({
        type: 'ADD_NOTE',
        partId:    layout.partId,
        staffId:   layout.staffId,
        measureId: layout.measureId,
        voiceId:   layout.voiceId,
        event:     restWithDot,
      })

      setPrimedAccidental(null)

      const newBeat = freeAt + units
      if (newBeat >= capacity) {
        const nextMeasure = staff.measures[mIdx + 1]
        if (nextMeasure) {
          setCursor(nextMeasure.id, firstRestBeat(nextMeasure.voices[0]?.events ?? []))
        } else {
          setCursor(null, 0)
        }
      } else {
        setCursor(layout.measureId, newBeat)
      }
      return
    }

    if (inputMode === 'select') {
      const STAVE_HEIGHT = 4 * LINE_SPACING_PX

      // Check if click is on a displayed clef symbol (leftmost preamble area)
      for (const l of layouts) {
        if (
          l.showClef &&
          canvasX >= l.x && canvasX <= l.x + CLEF_HIT_WIDTH &&
          canvasY >= l.staveTopY - 20 && canvasY <= l.staveTopY + STAVE_HEIGHT + 20
        ) {
          if (isPlaying) return
          const rect = canvas.getBoundingClientRect()
          setSelectionMenuPos(null)
          setClefPickerState({
            measureId: l.measureId,
            partId:    l.partId,
            staffId:   l.staffId,
            current:   l.clef,
            screenX:   rect.left + l.x,
            screenY:   rect.top  + l.staveTopY + STAVE_HEIGHT + 10,
          })
          return
        }
      }

      // Check if click is on a displayed key signature (leftmost preamble area)
      for (const l of layouts) {
        if (
          canvasX >= l.x && canvasX <= l.x + 90 &&
          canvasY >= l.staveTopY - 30 && canvasY <= l.staveTopY + STAVE_HEIGHT + 30
        ) {
          const part  = score.parts.find(p => p.id === l.partId)
          const staff = part?.staves.find(s => s.id === l.staffId)
          if (!staff) continue

          const mIdx = staff.measures.findIndex(m => m.id === l.measureId)
          const effectiveKey = resolveKeySig(staff.measures, mIdx, score.keySignature)
          const prevKey = mIdx > 0 ? resolveKeySig(staff.measures, mIdx - 1, score.keySignature) : null

          const displaysKeySig = (l.isLineStart && effectiveKey.fifths !== 0)
            || (prevKey !== null && prevKey.fifths !== effectiveKey.fifths)

          if (!displaysKeySig) continue
          if (isPlaying) return

          const rect = canvas.getBoundingClientRect()
          setSelectionMenuPos(null)
          setKeySigPickerState({
            measureId: l.measureId,
            partId:    l.partId,
            staffId:   l.staffId,
            current:   effectiveKey,
            screenX:   rect.left + l.x,
            screenY:   rect.top  + l.staveTopY + STAVE_HEIGHT + 10,
          })
          return
        }
      }

      // Check if click is on a displayed time signature (left preamble area of stave)
      for (const l of layouts) {
        if (
          canvasX >= l.x && canvasX <= l.x + 70 &&
          canvasY >= l.staveTopY - 30 && canvasY <= l.staveTopY + STAVE_HEIGHT + 30
        ) {
          const part  = score.parts.find(p => p.id === l.partId)
          const staff = part?.staves.find(s => s.id === l.staffId)
          if (!staff) continue

          const mIdx = staff.measures.findIndex(m => m.id === l.measureId)
          const effectiveSig = resolveTimeSig(staff.measures, mIdx, score.timeSignature)
          const prevSig = mIdx > 0 ? resolveTimeSig(staff.measures, mIdx - 1, score.timeSignature) : null
          const sigChanged = prevSig !== null && !timeSigsEqual(effectiveSig, prevSig)

          const displaysTimeSig = sigChanged
            || (l.isLineStart && (l.measureIndex === 0 || !timeSigsEqual(effectiveSig, score.timeSignature)))

          if (!displaysTimeSig) continue
          if (isPlaying) return

          const rect = canvas.getBoundingClientRect()
          setSelectionMenuPos(null)
          setTimeSigPickerState({
            measureId: l.measureId,
            partId: l.partId,
            staffId: l.staffId,
            current: effectiveSig,
            screenX: rect.left + l.x,
            screenY: rect.top  + l.staveTopY + STAVE_HEIGHT + 10,
          })
          return
        }
      }

      // Check if click is near any measure's right barline
      for (const l of layouts) {
        const barlineCanvasX = l.x + l.width
        if (
          Math.abs(canvasX - barlineCanvasX) <= BARLINE_HIT_RADIUS &&
          canvasY >= l.staveTopY - 30 &&
          canvasY <= l.staveTopY + STAVE_HEIGHT + 30
        ) {
          const part  = score.parts.find(p => p.id === l.partId)
          const staff = part?.staves.find(s => s.id === l.staffId)
          const isLastMeasure = staff?.measures[staff.measures.length - 1]?.id === l.measureId
          if (isPlaying) return
          const rect = canvas.getBoundingClientRect()
          setSelectionMenuPos(null)
          setSelectedBarline(l.measureId)
          setPickerState({
            measureId: l.measureId,
            partId: l.partId,
            staffId: l.staffId,
            isLastMeasure: isLastMeasure ?? false,
            screenX: rect.left + barlineCanvasX + 4,
            screenY: rect.top  + l.staveTopY,
          })
          return
        }
      }

      // Note selection — find closest note in the clicked measure
      const selPart  = score.parts.find(p => p.id === layout.partId)
      const selStaff = selPart?.staves.find(s => s.id === layout.staffId)
      if (selStaff) {
        const selMIdx = selStaff.measures.findIndex(m => m.id === layout.measureId)
        if (selMIdx !== -1) {
          const selVoice = selStaff.measures[selMIdx].voices[0]
          if (selVoice && selVoice.events.length > 0) {
            let closest: { id: string; dist: number; noteX: number } | null = null
            for (const ev of selVoice.events) {
              const noteX = notePositionsRef.current.get(ev.id)
              if (noteX === undefined) continue
              const dist = Math.abs(canvasX - noteX)
              if (!closest || dist < closest.dist) closest = { id: ev.id, dist, noteX }
            }
            if (closest && closest.dist <= 20) {
              // Position cursor at the beat of the clicked event
              let clickedBeat = 0
              for (const ev of selVoice.events) {
                if (ev.id === closest.id) break
                clickedBeat += eventDurationUnits(ev)
              }
              setCursor(layout.measureId, clickedBeat)

              const rect = canvas.getBoundingClientRect()
              const menuX = rect.left + closest.noteX
              const menuY = rect.top + layout.staveTopY + 4 * LINE_SPACING_PX + 12
              if (event.shiftKey) {
                // Shift+click: range select — reset chord cycle
                setChordCycleState(null)
                setSelectedChordPitch(null)
                const anchorLoc = selectedAnchorId ? findNoteLocation(selectedAnchorId) : null
                const clickedLoc = { partId: layout.partId, staffId: layout.staffId }
                if (anchorLoc && anchorLoc.staffId === clickedLoc.staffId) {
                  // Range-select: collect all note IDs between anchor and clicked note
                  const allIds: string[] = []
                  for (const measure of selStaff.measures) {
                    for (const voice of measure.voices) {
                      for (const e of voice.events) allIds.push(e.id)
                    }
                  }
                  const fromIdx = allIds.indexOf(selectedAnchorId!)
                  const toIdx   = allIds.indexOf(closest.id)
                  if (fromIdx !== -1 && toIdx !== -1) {
                    const start = Math.min(fromIdx, toIdx)
                    const end   = Math.max(fromIdx, toIdx)
                    setSelectedNotes(allIds.slice(start, end + 1), selectedAnchorId)
                  } else {
                    toggleSelectedNote(closest.id)
                  }
                } else {
                  toggleSelectedNote(closest.id)
                }
              } else {
                setSelectedMeasure(null)
                const ev = selVoice.events.find(e => e.id === closest!.id)

                // Chord pitch cycling: first click selects all; subsequent clicks cycle individual pitches
                if (ev?.type === 'chord') {
                  if (chordCycleState?.eventId === ev.id) {
                    // Already cycling — advance to next pitch or wrap back to all-selected
                    if (chordCycleState.nextIndex >= ev.pitches.length) {
                      // Wrap: back to all selected
                      setSelectedNote(ev.id)
                      setSelectedChordPitch(null)
                      setChordCycleState({ eventId: ev.id, nextIndex: 0 })
                    } else {
                      const pitchIdx = chordCycleState.nextIndex
                      setSelectedNote(ev.id)
                      setSelectedChordPitch(pitchIdx)
                      setChordCycleState({ eventId: ev.id, nextIndex: pitchIdx + 1 })
                    }
                  } else {
                    // First click on this chord: select all pitches, set up cycle
                    setSelectedNote(ev.id)
                    setSelectedChordPitch(null)
                    setChordCycleState({ eventId: ev.id, nextIndex: 0 })
                  }
                } else {
                  // Note or rest: plain selection, reset cycle
                  setSelectedNote(closest.id)
                  setChordCycleState(null)
                }

                if (ev) {
                  setSelectedDuration(ev.duration)
                  setIsDotted(ev.dots > 0)
                  if (soundOnInput && selPart && ev.type !== 'rest') {
                    const mIdx  = selMIdx
                    const dyn   = resolveDirectiveDynamic(selStaff.measures, mIdx)
                    const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? selPart.volume))
                    const midi  = resolveDirectiveMidiProgram(selStaff.measures, mIdx, selPart.midiProgram)
                    const isPizz = midi === 45
                    const partIdx = score.parts.indexOf(selPart)
                    const ch = Math.min((selPart.midiChannel ?? (partIdx + 1)) - 1, 15)
                    if (ev.type === 'note') {
                      triggerInputPreview(ev.pitch.noteName, ev.pitch.octave, ev.pitch.accidental, volDb, isPizz, selPart.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
                    } else if (ev.type === 'chord') {
                      const top = ev.pitches[ev.pitches.length - 1]
                      triggerInputPreview(top.noteName, top.octave, top.accidental, volDb, isPizz, selPart.transposeSemitones, audioMode, ch, Math.max(0, midi - 1))
                    }
                  }
                }
              }
              setPickerState(null)
              setKeySigPickerState(null)
              setTimeSigPickerState(null)
              setClefPickerState(null)
              setSelectionMenuPos({ x: menuX, y: menuY })
              return
            }
          }
        }
      }

      // No note hit — empty space within a stave: bar selection
      setSelectedBarline(null)
      setPickerState(null)
      setChordCycleState(null)
      setSelectionMenuPos(null)

      const clickedMeasureIndex = layout.measureIndex
      const clickedPartId = layout.partId

      if (barSelection) {
        const inRange = clickedMeasureIndex >= barSelection.startMeasureIndex &&
                        clickedMeasureIndex <= barSelection.endMeasureIndex

        if (inRange && event.shiftKey) {
          // Phase 2 additive: add this part to a narrowed selection
          const currentParts = barSelection.partIds ?? score.parts.map(p => p.id)
          if (!currentParts.includes(clickedPartId)) {
            setBarSelection({ ...barSelection, partIds: [...currentParts, clickedPartId] })
          }
        } else if (inRange && !event.shiftKey) {
          // Phase 2 narrow: narrow to this part only
          setBarSelection({ ...barSelection, partIds: [clickedPartId] })
          setContextMenuTab('volta')
          setSelectionMenuPos({ x: event.clientX, y: event.clientY })
        } else if (!inRange && event.shiftKey && clickedMeasureIndex > barSelection.endMeasureIndex) {
          // Phase 1 extend forward: widen range, reset part filter to all
          setBarSelection({
            startMeasureIndex: barSelection.startMeasureIndex,
            endMeasureIndex: clickedMeasureIndex,
            partIds: null,
          })
          setContextMenuTab('volta')
          setSelectionMenuPos({ x: event.clientX, y: event.clientY })
        } else {
          // Start a new bar selection
          clearSelection()
          setBarSelection({ startMeasureIndex: clickedMeasureIndex, endMeasureIndex: clickedMeasureIndex, partIds: null })
          setContextMenuTab('volta')
          setSelectionMenuPos({ x: event.clientX, y: event.clientY })
        }
      } else {
        // No existing bar selection: start one
        clearSelection()
        setBarSelection({ startMeasureIndex: clickedMeasureIndex, endMeasureIndex: clickedMeasureIndex, partIds: null })
        setContextMenuTab('volta')
        setSelectionMenuPos({ x: event.clientX, y: event.clientY })
      }
    }
  }

  // ── Barline picker handlers ─────────────────────────────────────────────────

  // ── Double-click: create text box on empty space (select mode) ───────────────

  const handleCanvasDblClick = useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    if (inputMode !== 'select') return
    const canvas = canvasAreaRef.current
    if (!canvas) return
    const { x: canvasX, y: canvasY } = canvasCoords(event, canvas)
    // Don't create a text box if we're in the heading area or on notation
    if (canvasY < HEADING_MARGIN_Y) return
    const layout  = findClickedLayout(canvasX, canvasY, layoutsRef.current)
    if (layout) return  // clicked on a stave — not empty space
    const box = makeTextBox(canvasX / zoom, canvasY / zoom)
    dispatch({ type: 'ADD_TEXT_BOX', box })
  }, [inputMode, zoom, score, dispatch])

  const closePicker = useCallback(() => {
    setPickerState(null)
    setSelectedBarline(null)
  }, [setSelectedBarline])

  const handleBarlineSelect = useCallback((
    measureId: string, partId: string, staffId: string, barline: BarlineType
  ) => {
    dispatch({ type: 'SET_BARLINE', partId, staffId, measureId, barline })
    setPickerState(null)
    setSelectedBarline(null)
  }, [dispatch, setSelectedBarline])

  // ── Key sig picker handlers ─────────────────────────────────────────────────

  const closeKeySigPicker = useCallback(() => setKeySigPickerState(null), [])

  const handleKeySigSelect = useCallback((key: KeySignature) => {
    const s = keySigPickerState
    if (!s) return
    dispatch({ type: 'SET_KEY', partId: s.partId, staffId: s.staffId, measureId: s.measureId, key })
    setKeySigPickerState(null)
  }, [keySigPickerState, dispatch])

  // ── Directive picker handlers ───────────────────────────────────────────────

  const handleDirectiveAdd = useCallback((directive: Directive) => {
    const s = directivePickerState
    if (!s) return
    dispatch({ type: 'ADD_DIRECTIVE', partId: s.partId, staffId: s.staffId, measureId: s.measureId, directive })
    setDirectivePickerState(prev => prev ? { ...prev, existing: [...prev.existing, directive] } : null)
  }, [directivePickerState, dispatch])

  const handleDirectiveRemove = useCallback((directiveId: string) => {
    const s = directivePickerState
    if (!s) return
    dispatch({ type: 'REMOVE_DIRECTIVE', partId: s.partId, staffId: s.staffId, measureId: s.measureId, directiveId })
    setDirectivePickerState(prev => prev ? { ...prev, existing: prev.existing.filter(d => d.id !== directiveId) } : null)
  }, [directivePickerState, dispatch])

  // ── MIDI event picker handlers ──────────────────────────────────────────────

  const handleMidiEventAdd = useCallback((event: MidiScoreEvent) => {
    const s = midiEventPickerState
    if (!s) return
    dispatch({ type: 'ADD_MIDI_EVENT', partId: s.partId, staffId: s.staffId, measureId: s.measureId, event })
    setMidiEventPickerState(prev => prev ? { ...prev, existing: [...prev.existing, event] } : null)
  }, [midiEventPickerState, dispatch])

  const handleMidiEventRemove = useCallback((eventId: string) => {
    const s = midiEventPickerState
    if (!s) return
    dispatch({ type: 'REMOVE_MIDI_EVENT', partId: s.partId, staffId: s.staffId, measureId: s.measureId, eventId })
    setMidiEventPickerState(prev => prev ? { ...prev, existing: prev.existing.filter(e => e.id !== eventId) } : null)
  }, [midiEventPickerState, dispatch])

  // ── Pedal mark picker handlers ──────────────────────────────────────────────

  const handlePedalMarkAdd = useCallback((mark: PedalMark) => {
    const s = pedalMarkPickerState
    if (!s) return
    dispatch({ type: 'ADD_PEDAL_MARK', partId: s.partId, staffId: s.staffId, measureId: s.measureId, mark })
    setPedalMarkPickerState(prev => prev ? { ...prev, existing: [...prev.existing, mark] } : null)
  }, [pedalMarkPickerState, dispatch])

  const handlePedalMarkRemove = useCallback((markId: string) => {
    const s = pedalMarkPickerState
    if (!s) return
    dispatch({ type: 'REMOVE_PEDAL_MARK', partId: s.partId, staffId: s.staffId, measureId: s.measureId, markId })
    setPedalMarkPickerState(prev => prev ? { ...prev, existing: prev.existing.filter(m => m.id !== markId) } : null)
  }, [pedalMarkPickerState, dispatch])

  // ── Clef picker handlers ────────────────────────────────────────────────────

  const closeClefPicker = useCallback(() => setClefPickerState(null), [])

  const handleClefSelect = useCallback((clef: ClefType) => {
    const s = clefPickerState
    if (!s) return
    dispatch({ type: 'SET_CLEF', partId: s.partId, staffId: s.staffId, measureId: s.measureId, clef })
    setClefPickerState(null)
  }, [clefPickerState, dispatch])

  // ── Time sig picker handlers ────────────────────────────────────────────────

  const closeTimeSigPicker = useCallback(() => setTimeSigPickerState(null), [])

  const handleTimeSigSelect = useCallback((sig: TimeSignature) => {
    const s = timeSigPickerState
    if (!s) return
    if (s.measureId && s.partId && s.staffId) {
      dispatch({ type: 'SET_TIME', partId: s.partId, staffId: s.staffId, measureId: s.measureId, time: sig })
    } else {
      dispatch({ type: 'SET_SCORE_TIME', time: sig })
    }
    setTimeSigPickerState(null)
  }, [timeSigPickerState, dispatch])

  // Close pickers when leaving their relevant mode
  useEffect(() => {
    if (inputMode !== 'select') {
      setPickerState(null)
      setTimeSigPickerState(null)
      setKeySigPickerState(null)
      setClefPickerState(null)
    }
    if (inputMode !== 'text') {
      setDirectivePickerState(null)
      setPedalMarkPickerState(null)
    }
    if (inputMode !== 'midi') {
      setMidiEventPickerState(null)
    }
  }, [inputMode])

  useEffect(() => {
    if (selectedNoteIds.length === 0 && !barSelection) setSelectionMenuPos(null)
  }, [selectedNoteIds.length, barSelection])

  // Reset drag offset whenever menu position changes (new selection)
  useEffect(() => {
    setMenuDragOffset({ x: 0, y: 0 })
  }, [selectionMenuPos])

  // ── Cursor style per mode ───────────────────────────────────────────────────

  const cursorStyle =
    (inputMode === 'note' || inputMode === 'rest')
      ? shiftHoverOnNote         ? 'copy'
        : hoverCursor === 'valid'   ? PENCIL_CURSOR
        : hoverCursor === 'invalid' ? 'not-allowed'
        : 'crosshair'
    : inputMode === 'select'
      ? hoverCursor === 'hand'   ? 'pointer' : 'default'
    : inputMode === 'midi'
      ? hoverCursor === 'valid'  ? 'crosshair' : 'default'
    : inputMode === 'text'       ? 'text'
    : inputMode === 'lyric'      ? 'text'
    : 'default'

  return (
    <>
      <div style={{
        background: '#ffffff',
        borderRadius: 4,
        display: 'inline-block',
        minWidth: '100%',
        position: 'relative',
      }}>
        <div
          ref={canvasAreaRef}
          onClick={handleCanvasClick}
          onDoubleClick={handleCanvasDblClick}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={() => { setShiftHoverOnNote(false); setHoverCursor('default') }}
          style={{ cursor: cursorStyle, display: 'block' }}
        />
        {/* Overlay canvas layer: selection/cursor highlights drawn without VexFlow */}
        <div
          ref={overlayCanvasAreaRef}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', display: 'block' }}
        />
        <TextBoxLayer zoom={zoom} />
        <div
          ref={playbackCursorElRef}
          style={{
            display: 'none',
            position: 'absolute',
            top: 0,
            left: 0,
            width: 2,
            background: 'rgba(30, 140, 255, 0.65)',
            pointerEvents: 'none',
            zIndex: 20,
            borderRadius: 1,
          }}
        />
        {inputMode === 'lyric' && lyricCursorNoteId && lyricInputPos && (
          <LyricEditorInput
            key={lyricCursorNoteId}
            currentLyric={getEventLyric(lyricCursorNoteId)}
            left={lyricInputPos.x}
            top={lyricInputPos.y}
            onCommit={lyric => commitLyric(lyricCursorNoteId, lyric)}
            onAdvance={advanceLyricCursor}
            onBack={retreatLyricCursor}
            onExit={() => setInputMode('select')}
          />
        )}
        {editingHeading && (
          <HeadingEditor
            bound={editingHeading}
            currentValue={(score.metadata as any)[editingHeading.field] ?? ''}
            onCommit={value => {
              dispatch({ type: 'SET_HEADING', field: editingHeading.field, value })
              setEditingHeading(null)
            }}
            onCancel={() => setEditingHeading(null)}
          />
        )}
      </div>
      {pickerState && (
        <BarlinePicker
          measureId={pickerState.measureId}
          partId={pickerState.partId}
          staffId={pickerState.staffId}
          isLastMeasure={pickerState.isLastMeasure}
          screenX={pickerState.screenX}
          screenY={pickerState.screenY}
          onClose={closePicker}
          onSelect={handleBarlineSelect}
        />
      )}
      {timeSigPickerState && (
        <TimeSignaturePicker
          current={timeSigPickerState.current}
          screenX={timeSigPickerState.screenX}
          screenY={timeSigPickerState.screenY}
          onClose={closeTimeSigPicker}
          onSelect={handleTimeSigSelect}
        />
      )}
      {keySigPickerState && (
        <CircleOfFifths
          current={keySigPickerState.current}
          screenX={keySigPickerState.screenX}
          screenY={keySigPickerState.screenY}
          onClose={closeKeySigPicker}
          onSelect={handleKeySigSelect}
        />
      )}
      {clefPickerState && (
        <ClefPicker
          current={clefPickerState.current}
          screenX={clefPickerState.screenX}
          screenY={clefPickerState.screenY}
          onClose={closeClefPicker}
          onSelect={handleClefSelect}
        />
      )}
      {keyboardVisible && (
        <VirtualKeyboard
          onNotePress={stableKeyboardHandler}
          onClose={toggleKeyboard}
        />
      )}
      {directivePickerState && (
        <DirectivePicker
          existing={directivePickerState.existing}
          showTempo={directivePickerState.isFirstPart}
          screenX={directivePickerState.screenX}
          screenY={directivePickerState.screenY}
          onAdd={handleDirectiveAdd}
          onRemove={handleDirectiveRemove}
          onClose={() => setDirectivePickerState(null)}
        />
      )}
      {midiEventPickerState && (
        <MidiEventPicker
          existing={midiEventPickerState.existing}
          capacity={midiEventPickerState.capacity}
          initialBeat={midiEventPickerState.beatPosition}
          screenX={midiEventPickerState.screenX}
          screenY={midiEventPickerState.screenY}
          onAdd={handleMidiEventAdd}
          onRemove={handleMidiEventRemove}
          onClose={() => setMidiEventPickerState(null)}
        />
      )}
      {pedalMarkPickerState && (
        <PedalMarkPicker
          existing={pedalMarkPickerState.existing}
          capacity={pedalMarkPickerState.capacity}
          initialBeat={pedalMarkPickerState.beatPosition}
          screenX={pedalMarkPickerState.screenX}
          screenY={pedalMarkPickerState.screenY}
          onAdd={handlePedalMarkAdd}
          onRemove={handlePedalMarkRemove}
          onClose={() => setPedalMarkPickerState(null)}
        />
      )}
      {((selectedNoteIds.length > 0 || barSelection !== null) && inputMode === 'select' && selectionMenuPos !== null) && (() => {
        const isBar    = barSelection !== null && selectedNoteIds.length === 0
        const isSingle = selectedNoteIds.length === 1
        const isMulti  = selectedNoteIds.length > 1

        // Summary text for the drag handle header
        let summaryText: string
        if (isBar) {
          const { startMeasureIndex: si, endMeasureIndex: ei, partIds } = barSelection!
          const barRange = si === ei ? `Bar ${si + 1}` : `Bars ${si + 1}–${ei + 1}`
          const partLabel = partIds
            ? partIds.length === 1
              ? score.parts.find(p => p.id === partIds![0])?.name ?? '1 part'
              : `${partIds.length} parts`
            : 'All parts'
          summaryText = `${barRange} · ${partLabel}`
        } else if (isMulti) {
          summaryText = `${selectedNoteIds.length} notes`
        } else {
          summaryText = '1 note'
        }

        // Resolve tie state (single note only)
        let hasTie = false
        if (isSingle && selectedNoteId) {
          outer: for (const part of score.parts) {
            for (const staff of part.staves) {
              for (const measure of staff.measures) {
                for (const voice of measure.voices) {
                  const ev = voice.events.find(e => e.id === selectedNoteId)
                  if (ev?.type === 'note' && (ev as Note).tieStart) { hasTie = true; break outer }
                }
              }
            }
          }
        }

        // Resolve dynamic (single note only)
        let currentDynamic: DynamicLevel | undefined
        if (isSingle && selectedNoteId) {
          outer: for (const part of score.parts) {
            for (const staff of part.staves) {
              for (const measure of staff.measures) {
                for (const voice of measure.voices) {
                  const ev = voice.events.find(e => e.id === selectedNoteId)
                  if (ev) { currentDynamic = (ev as any).dynamic; break outer }
                }
              }
            }
          }
        }

        // Measure range for Volta tab — from bar selection or note selection
        let effectiveStart = -1, effectiveEnd = -1
        if (isBar) {
          effectiveStart = barSelection!.startMeasureIndex
          effectiveEnd   = barSelection!.endMeasureIndex
        } else {
          const selIdSet = new Set(selectedNoteIds)
          let selMin = Infinity, selMax = -Infinity
          const firstStaff = score.parts[0]?.staves[0]
          if (firstStaff) {
            firstStaff.measures.forEach((m, idx) => {
              for (const voice of m.voices) {
                if (voice.events.some(e => selIdSet.has(e.id))) {
                  selMin = Math.min(selMin, idx)
                  selMax = Math.max(selMax, idx)
                }
              }
            })
          }
          if (selMax >= selMin && selMin !== Infinity) { effectiveStart = selMin; effectiveEnd = selMax }
        }
        const hasRange = effectiveStart !== -1
        const existingVolta: Volta | undefined = hasRange
          ? (score.voltas ?? []).find(v => v.startMeasureIndex === effectiveStart && v.endMeasureIndex === effectiveEnd)
          : undefined

        // Slur state (note selections only)
        const hasOutgoingSlur = !isBar && !slurPendingId && selectedNoteId != null && score.parts.some(p =>
          p.staves.some(s => s.slurs?.some(sl => sl.fromNoteId === selectedNoteId))
        )

        const menuW = 380
        const rawLeft = selectionMenuPos.x - menuW / 2 + menuDragOffset.x
        const rawTop  = selectionMenuPos.y + menuDragOffset.y
        const left = Math.max(8, Math.min(rawLeft, window.innerWidth - menuW - 8))
        const top  = Math.max(8, Math.min(rawTop, window.innerHeight - 300))

        const btnBase: React.CSSProperties = {
          padding: '3px 8px', borderRadius: 3, border: '1px solid #555',
          background: '#2d2d2d', color: '#ccc', cursor: 'pointer', fontSize: 11,
        }
        const btnActive: React.CSSProperties  = { ...btnBase, background: '#0e639c', color: '#fff', border: '1px solid #0e639c' }
        const btnDisabled: React.CSSProperties = { ...btnBase, color: '#555', cursor: 'not-allowed' }
        const DYNAMICS: DynamicLevel[] = ['pp', 'p', 'mp', 'mf', 'f', 'ff']
        const NAMED_INTERVALS = [
          { label: 'm2', semitones: 1 }, { label: 'M2', semitones: 2 },
          { label: 'm3', semitones: 3 }, { label: 'M3', semitones: 4 },
          { label: 'P4', semitones: 5 }, { label: 'Tritone', semitones: 6 },
          { label: 'P5', semitones: 7 }, { label: 'm6', semitones: 8 },
          { label: 'M6', semitones: 9 }, { label: 'm7', semitones: 10 },
          { label: 'M7', semitones: 11 }, { label: 'P8', semitones: 12 },
        ]
        const tabs: Array<{ key: typeof contextMenuTab; label: string }> = [
          { key: 'articulations', label: 'Articulations' },
          { key: 'volta',         label: 'Volta' },
          { key: 'transpose',     label: 'Transpose' },
        ]

        return (
          <div
            style={{
              position: 'fixed', left, top,
              background: '#1e1e1e', border: '1px solid #444', borderRadius: 6,
              padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
              zIndex: 1000, boxShadow: '0 4px 16px rgba(0,0,0,0.5)', fontSize: 12, color: '#d4d4d4',
              minWidth: menuW,
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            {/* Drag handle + summary + close */}
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: isDraggingMenu ? 'grabbing' : 'grab', userSelect: 'none' }}
              onMouseDown={handleMenuDragStart}
            >
              <span style={{ color: '#888', fontSize: 11 }}>⠿ {summaryText}</span>
              <button
                onClick={() => { clearSelection(); setBarSelection(null); setSelectionMenuPos(null) }}
                style={{ ...btnBase, padding: '1px 6px', fontSize: 10, cursor: 'pointer' }}
                onMouseDown={e => e.stopPropagation()}
              >✕</button>
            </div>

            {/* Operations row */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={isBar || isMulti ? undefined : toggleTie}
                title="Toggle tie (T)"
                style={isBar || isMulti ? btnDisabled : hasTie ? btnActive : btnBase}
              >Tie</button>
              <button
                onClick={isBar ? undefined : handleSlurKey}
                title={isBar ? 'Not available for bar selection'
                  : slurPendingId  ? 'Cancel slur (Esc)'
                  : hasOutgoingSlur ? 'Remove slur (L)' : 'Start slur (L)'}
                style={
                  isBar           ? btnDisabled :
                  slurPendingId   ? { ...btnBase, background: '#6d3a00', border: '1px solid #a0550a', color: '#ffc080' } :
                  hasOutgoingSlur ? { ...btnBase, background: '#3a1a3a', border: '1px solid #7a3a7a', color: '#e0a0e0' } :
                  btnBase
                }
              >{slurPendingId ? 'Slur…' : hasOutgoingSlur ? 'Slur ✕' : 'Slur'}</button>
              {(isMulti || isBar) && (
                <>
                  <button onClick={isBar ? undefined : () => addHairpin('crescendo')}   title="Add crescendo"   style={isBar ? btnDisabled : btnBase}>cresc</button>
                  <button onClick={isBar ? undefined : () => addHairpin('decrescendo')} title="Add decrescendo" style={isBar ? btnDisabled : btnBase}>dim</button>
                </>
              )}
              {selectedNoteIds.length === 3 && <button onClick={() => applyTuplet(3, 2)} title="Make triplet"    style={btnBase}>3</button>}
              {selectedNoteIds.length === 5 && <button onClick={() => applyTuplet(5, 4)} title="Make quintuplet" style={btnBase}>5</button>}
              {selectedNoteIds.length === 6 && <button onClick={() => applyTuplet(6, 4)} title="Make sextuplet"  style={btnBase}>6</button>}
            </div>

            {/* Tab bar */}
            <div style={{ display: 'flex', borderBottom: '1px solid #333', marginTop: 2 }}>
              {tabs.map(({ key, label }) => {
                const tabDisabled = isBar && key === 'articulations'
                return (
                  <button key={key}
                    onClick={tabDisabled ? undefined : () => setContextMenuTab(key)}
                    style={{
                      padding: '4px 12px', border: 'none', background: 'none',
                      cursor: tabDisabled ? 'not-allowed' : 'pointer',
                      fontSize: 11,
                      color: tabDisabled ? '#444' : contextMenuTab === key ? '#d4d4d4' : '#666',
                      borderBottom: contextMenuTab === key ? '2px solid #0e639c' : '2px solid transparent',
                      marginBottom: -1,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {/* Articulations tab (disabled for bar selection) */}
            {contextMenuTab === 'articulations' && !isBar && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                  {ARTICULATION_BUTTONS.map(({ art, label, title }) => (
                    <button key={art} onClick={() => handleArticulationClick(art)} title={title}
                      style={{ ...(artActive[art] ? btnActive : btnBase), fontFamily: 'serif', fontSize: 13 }}>
                      {label}
                    </button>
                  ))}
                </div>
                {isSingle && selectedNoteId && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const, paddingTop: 4, borderTop: '1px solid #2a2a2a' }}>
                    {DYNAMICS.map(d => (
                      <button key={d}
                        onClick={() => setNoteDynamic(selectedNoteId!, currentDynamic === d ? undefined : d)}
                        title={currentDynamic === d ? `Remove ${d}` : `Set dynamic: ${d}`}
                        style={{ ...(currentDynamic === d ? btnActive : btnBase), fontFamily: 'Edwin, serif', fontStyle: 'italic', fontWeight: 'bold', fontSize: 13 }}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Volta tab */}
            {contextMenuTab === 'volta' && (
              <div style={{ paddingTop: 2 }}>
                {hasRange ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {([1, 2, 3] as const).map(n => {
                      const isActive = existingVolta?.number === n
                      return (
                        <button key={n}
                          onClick={() => {
                            if (isActive && existingVolta) { removeVolta(existingVolta.id) }
                            else {
                              if (existingVolta) removeVolta(existingVolta.id)
                              addVolta({ number: n, startMeasureIndex: effectiveStart, endMeasureIndex: effectiveEnd })
                            }
                          }}
                          title={isActive ? `Remove ending ${n}` : `Add ending ${n} (measures ${effectiveStart + 1}–${effectiveEnd + 1})`}
                          style={isActive ? btnActive : btnBase}
                        >
                          {n}.
                        </button>
                      )
                    })}
                    {existingVolta && (
                      <button style={{ ...btnBase, marginLeft: 8 }} onClick={() => removeVolta(existingVolta.id)}>
                        Remove
                      </button>
                    )}
                  </div>
                ) : (
                  <span style={{ color: '#555', fontSize: 11 }}>Select notes or measures to apply a volta bracket</span>
                )}
              </div>
            )}

            {/* Transpose tab */}
            {contextMenuTab === 'transpose' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['up', 'down'] as const).map(d => (
                    <button key={d} onClick={() => setTransposeDir(d)} style={{
                      ...btnBase, flex: 1,
                      ...(transposeDir === d ? { background: '#0e639c', color: '#fff', border: '1px solid #0e639c' } : {}),
                    }}>
                      {d === 'up' ? '↑ Up' : '↓ Down'}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 3 }}>
                  {NAMED_INTERVALS.map(({ label, semitones }) => (
                    <button key={label} onClick={() => setTransposeAmt(semitones)} style={{
                      ...btnBase,
                      ...(transposeAmt === semitones ? { background: '#0e639c', color: '#fff', border: '1px solid #0e639c' } : {}),
                    }}>
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#888', fontSize: 11 }}>Semitones:</span>
                  <input
                    type="number" min={1} max={24} value={transposeAmt}
                    onChange={e => setTransposeAmt(Math.max(1, Math.min(24, Number(e.target.value))))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const semitones = transposeDir === 'up' ? transposeAmt : -transposeAmt
                        if (isBar) {
                          const partSet = barSelection!.partIds ? new Set(barSelection!.partIds) : null
                          const { startMeasureIndex: si, endMeasureIndex: ei } = barSelection!
                          const moves: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[] = []
                          for (const part of score.parts) {
                            if (partSet && !partSet.has(part.id)) continue
                            for (const staff of part.staves) {
                              for (let i = si; i <= ei; i++) {
                                const measure = (staff.measures as any[])[i]
                                if (!measure) continue
                                for (const voice of measure.voices) {
                                  for (const ev of voice.events) {
                                    if (ev.type === 'note' || ev.type === 'chord')
                                      moves.push({ partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id, noteId: ev.id })
                                  }
                                }
                              }
                            }
                          }
                          if (moves.length > 0) dispatch({ type: 'TRANSPOSE_NOTES', moves, semitones })
                        } else {
                          transposeSelectedNotes(semitones)
                        }
                      }
                    }}
                    style={{
                      width: 48, padding: '2px 4px', border: '1px solid #555', borderRadius: 3,
                      background: '#2d2d2d', color: '#ccc', fontSize: 11, textAlign: 'center',
                    }}
                  />
                  <button
                    style={{ ...btnActive, marginLeft: 'auto' }}
                    onClick={() => {
                      const semitones = transposeDir === 'up' ? transposeAmt : -transposeAmt
                      if (isBar) {
                        const partSet = barSelection!.partIds ? new Set(barSelection!.partIds) : null
                        const { startMeasureIndex: si, endMeasureIndex: ei } = barSelection!
                        const moves: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[] = []
                        for (const part of score.parts) {
                          if (partSet && !partSet.has(part.id)) continue
                          for (const staff of part.staves) {
                            for (let i = si; i <= ei; i++) {
                              const measure = (staff.measures as any[])[i]
                              if (!measure) continue
                              for (const voice of measure.voices) {
                                for (const ev of voice.events) {
                                  if (ev.type === 'note' || ev.type === 'chord')
                                    moves.push({ partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id, noteId: ev.id })
                                }
                              }
                            }
                          }
                        }
                        if (moves.length > 0) dispatch({ type: 'TRANSPOSE_NOTES', moves, semitones })
                      } else {
                        transposeSelectedNotes(semitones)
                      }
                    }}
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {pendingResize && (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000, background: 'rgba(0,0,0,0.3)',
        }}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.stopPropagation(); cancelResize() }
            if (e.key === 'Enter')  { e.stopPropagation(); confirmResize() }
          }}
        >
          <div style={{
            background: '#fff', border: '1px solid #ccc', borderRadius: 6,
            padding: '16px 20px', boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Resize note?</div>
            <div style={{ fontSize: 13, color: '#444' }}>
              This will remove {pendingResize.pitchedCount} note{pendingResize.pitchedCount > 1 ? 's' : ''} after the selected note.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={cancelResize}
                style={{ padding: '4px 14px', borderRadius: 4, border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={confirmResize}
                style={{ padding: '4px 14px', borderRadius: 4, border: '1px solid #0e639c', background: '#0e639c', color: '#fff', cursor: 'pointer', fontSize: 13 }}
              >
                Resize
              </button>
            </div>
          </div>
        </div>
      )}

      {resizeError && (
        <div style={{
          position: 'fixed', bottom: 72, left: '50%', transform: 'translateX(-50%)',
          background: '#c0392b', color: '#fff', padding: '6px 18px', borderRadius: 6,
          fontSize: 13, zIndex: 2000, pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}>
          {resizeError}
        </div>
      )}
    </>
  )
}
