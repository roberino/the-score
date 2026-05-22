import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import type { Command } from '@shared/commands'
import {
  renderScore,
  computeLayout,
  DEFAULT_RENDER_OPTIONS,
  LABEL_MARGIN_X,
  HEADING_MARGIN_Y,
  STAVE_HEIGHT_PX,
  headingFieldBounds,
  type MeasureLayout,
  type HeadingFieldBound,
} from '../engine/notationRenderer'
import { createNote, createRest, type NoteName, type Accidental, type Articulation, type Note, type Chord, type Pitch, type NoteEvent, type BarlineType, type TimeSignature, type KeySignature, type ClefType, type Directive, type Slur, type DynamicLevel, type Volta } from '@shared/score'
import { v4 as uuid } from 'uuid'
import {
  DURATION_UNITS,
  dottedUnits,
  measureCapacityUnits,
  usedUnits,
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
} from '@shared/musicUtils'
import { pitchToHz } from '../engine/audioEngine'
import { previewNote } from '../engine/notePreview'
import { TimeSignaturePicker } from './TimeSignaturePicker'
import { CircleOfFifths } from './CircleOfFifths'
import { ClefPicker } from './ClefPicker'
import { DirectivePicker } from './DirectivePicker'
import { VirtualKeyboard } from './VirtualKeyboard'
import { TransposeDialog } from './TransposeDialog'
import { useMidiInput } from '../hooks/useMidiInput'
import type { NoteInput } from '../services/midiService'
import { TextBoxLayer, makeTextBox } from './TextBoxLayer'

// ── Preview helper ────────────────────────────────────────────────────────────

function triggerInputPreview(
  noteName: string, octave: number, accidental: string | null | undefined,
  volDb: number, isPizz: boolean, transposeSemitones: number,
): void {
  // Always use internal audio for note-entry feedback regardless of playback
  // audio mode — sending preview via MIDI output causes a feedback loop on
  // virtual buses like IAC Driver (output loops back as input, entering notes).
  const hz = pitchToHz(noteName, octave, accidental ?? null, transposeSemitones)
  void previewNote(hz, volDb, isPizz)
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
  event: React.MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement
): { x: number; y: number } {
  // VexFlow calls ctx.scale(dpr, dpr) internally, so all its drawing coordinates
  // are in CSS (logical) pixels. Click coordinates must stay in the same space.
  // Do NOT multiply by canvas.width/rect.width — that converts to physical pixels.
  const rect = canvas.getBoundingClientRect()
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const notePositionsRef = useRef(new Map<string, number>())
  const [selectionMenuPos, setSelectionMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [pickerState, setPickerState] = useState<PickerState | null>(null)
  const [timeSigPickerState, setTimeSigPickerState] = useState<TimeSigPickerState | null>(null)
  const [keySigPickerState, setKeySigPickerState] = useState<KeySigPickerState | null>(null)
  const [clefPickerState, setClefPickerState] = useState<ClefPickerState | null>(null)
  const [directivePickerState, setDirectivePickerState] = useState<DirectivePickerState | null>(null)
  const [editingHeading, setEditingHeading] = useState<HeadingFieldBound | null>(null)
  const [slurPendingId, setSlurPendingId] = useState<string | null>(null)
  const [transposeDialogOpen, setTransposeDialogOpen] = useState(false)

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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const options = getRenderOptions(zoom, score.showPartLabels)
    const timeSig = score.timeSignature
    const capacity = measureCapacityUnits(timeSig)
    notePositionsRef.current = renderScore(
      canvas,
      score,
      options,
      new Set(selectedNoteIds),
      cursorMeasureId
        ? { cursorMeasureId, cursorBeatPosition, totalCapacityUnits: capacity }
        : null,
      selectedMeasureId,
      lyricCursorNoteId
    )
  }, [score, zoom, selectedNoteIds, cursorMeasureId, cursorBeatPosition, selectedMeasureId, lyricCursorNoteId])

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

        if (remainingUnits(voiceEvents, timeSig) < units) {
          canvasRef.current?.classList.add('cursor-reject')
          setTimeout(() => canvasRef.current?.classList.remove('cursor-reject'), 200)
          return
        }

        const octave      = closestOctave(noteName, lastEnteredPitch)
        const accidental  = primedAccidental as Accidental
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
          triggerInputPreview(noteWithDot.pitch.noteName, noteWithDot.pitch.octave, noteWithDot.pitch.accidental, volDb, midi === 45, part.transposeSemitones)
        }

        setPrimedAccidental(null)
        setLastEnteredPitch(noteWithDot.pitch)
        setSelectedMeasure(null)

        // Advance cursor
        const newBeat = cursorBeatPosition + units
        const capacity = measureCapacityUnits(timeSig)
        if (newBeat >= capacity) {
          const measureIdx  = staff.measures.findIndex(m => m.id === cursorMeasureId)
          const nextMeasure = staff.measures[measureIdx + 1]
          if (nextMeasure) {
            const nextVoice = nextMeasure.voices[activeVoice]
            setCursor(nextMeasure.id, usedUnits(nextVoice?.events ?? []))
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
        if (remainingUnits(voiceEvents, timeSig) < units) {
          canvasRef.current?.classList.add('cursor-reject')
          setTimeout(() => canvasRef.current?.classList.remove('cursor-reject'), 200)
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
          triggerInputPreview(noteWithDot.pitch.noteName, noteWithDot.pitch.octave, noteWithDot.pitch.accidental, volDb, midi === 45, part.transposeSemitones)
        }
        setLastEnteredPitch(noteWithDot.pitch)
        setSelectedMeasure(null)
        const newBeat  = cursorBeatPosition + units
        const capacity = measureCapacityUnits(timeSig)
        if (newBeat >= capacity) {
          const mIdx        = staff.measures.findIndex(m => m.id === cursorMeasureId)
          const nextMeasure = staff.measures[mIdx + 1]
          if (nextMeasure) setCursor(nextMeasure.id, usedUnits(nextMeasure.voices[activeVoice]?.events ?? []))
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
          canvasRef.current?.classList.add('cursor-reject')
          setTimeout(() => canvasRef.current?.classList.remove('cursor-reject'), 200)
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
          if (nextMeasure) setCursor(nextMeasure.id, usedUnits(nextMeasure.voices[0]?.events ?? []))
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

        if (remainingUnits(voiceEvents, timeSig) < units) {
          canvasRef.current?.classList.add('cursor-reject')
          setTimeout(() => canvasRef.current?.classList.remove('cursor-reject'), 200)
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
            setCursor(nextMeasure.id, usedUnits(nextMeasure.voices[activeVoice]?.events ?? []))
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
          canvasRef.current?.classList.add('cursor-reject')
          setTimeout(() => canvasRef.current?.classList.remove('cursor-reject'), 200)
          return
        }
        dispatch({ type: 'ADD_TUPLET', partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id, actual, normal, duration: selectedDuration })
        const newBeat = cursorBeatPosition + totalUnits
        const capacity = measureCapacityUnits(timeSig)
        if (newBeat >= capacity) {
          const next = staff.measures[measureIdx + 1]
          if (next) setCursor(next.id, usedUnits(next.voices[0]?.events ?? []))
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
    const options = getRenderOptions(zoom, score.showPartLabels)
    const layouts = computeLayout(score, options)
    for (const part of score.parts) {
      for (const staff of part.staves) {
        for (const measure of staff.measures) {
          for (const voice of measure.voices) {
            if (voice.events.some(e => e.id === lyricCursorNoteId)) {
              const layout = layouts.find(l => l.measureId === measure.id && l.staffId === staff.id)
              if (layout) return { x: noteX, y: layout.staveTopY + STAVE_HEIGHT_PX + 20 }
            }
          }
        }
      }
    }
    return null
  }, [lyricCursorNoteId, inputMode, score, zoom])

  useEffect(() => {
    if (!resizeError) return
    const t = setTimeout(() => clearResizeError(), 3000)
    return () => clearTimeout(t)
  }, [resizeError])

  const deleteSelectedNotes = useCallback(() => {
    if (selectedNoteIds.length === 0) return
    if (selectedNoteIds.length === 1) {
      const id = selectedNoteIds[0]
      const loc = findFullNoteLocation(id)
      if (loc) {
        dispatch({ type: 'DELETE_NOTE', ...loc, noteId: id })
        clearSelection()
      }
      return
    }
    const deletions: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[] = []
    for (const noteId of selectedNoteIds) {
      const loc = findFullNoteLocation(noteId)
      if (loc) deletions.push({ ...loc, noteId })
    }
    if (deletions.length > 0) {
      dispatch({ type: 'DELETE_NOTES', deletions })
      clearSelection()
    }
  }, [score, selectedNoteIds, findFullNoteLocation, dispatch, clearSelection])

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
  }, [selectedNoteId, slurPendingId, score, dispatch])

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
        for (const measure of staff.measures) {
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
            return
          }
        }
      }
    }
  }, [score, selectedNoteId, dispatch])

  const moveSelectedNotes = useCallback((direction: 'up' | 'down') => {
    if (selectedNoteIds.length === 0) return
    const moves: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[] = []
    for (const noteId of selectedNoteIds) {
      const loc = findFullNoteLocation(noteId)
      if (loc) moves.push({ ...loc, noteId })
    }
    if (moves.length > 0) dispatch({ type: 'MOVE_NOTES_STEP', moves, direction })
  }, [selectedNoteIds, findFullNoteLocation, dispatch])

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

  // ── Keyboard handler ────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Skip if user is typing in an input or a rich-text editor
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.target as HTMLElement).isContentEditable) return

      const mod = e.metaKey || e.ctrlKey

      // Escape → select mode + cancel pending slur + close transpose dialog + deselect measure
      if (e.key === 'Escape') {
        setSlurPendingId(null)
        setTransposeDialogOpen(false)
        setInputMode('select')
        setSelectedMeasure(null)
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
      // Transpose dialog: Shift+T in select mode with notes selected
      if (!mod && e.shiftKey && e.key === 'T' && inputMode === 'select' && selectedNoteIds.length > 0) {
        setTransposeDialogOpen(true); return
      }

      // Arrow keys: chromatic step move in select mode; accidental priming in note mode
      if (!mod && inputMode === 'select' && selectedNoteIds.length > 0) {
        if (e.key === 'ArrowUp')   { e.preventDefault(); moveSelectedNotes('up');   return }
        if (e.key === 'ArrowDown') { e.preventDefault(); moveSelectedNotes('down'); return }
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
        if (e.key === 'e' || e.key === 'E') { setInputMode('eraser'); return }
        if (e.key === 't' || e.key === 'T') { setInputMode('text');   return }
        if (e.key === 'l' || e.key === 'L') { setInputMode('lyric');  return }
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

      // Delete / Backspace — measure takes priority over notes when a bar is selected
      if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
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
    moveSelectedNotes, selectAllInMeasure,
    toggleTie, handleSlurKey,
    setInputMode, setSelectedDuration, toggleDot, resizeNote, setPrimedAccidental, dispatch, dispatchBatch, toggleKeyboard,
    insertMeasure, deleteMeasure, selectedMeasureId, insertTuplet,
  ])

  // Set cursor when first entering note/rest mode
  useEffect(() => {
    if ((inputMode === 'note' || inputMode === 'rest') && !cursorMeasureId) {
      moveCursorToFirstAvailable()
    }
  }, [inputMode])

  // ── Mouse click handler ─────────────────────────────────────────────────────

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current
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

    const layouts = computeLayout(score, options)

    // ── Directive zone: headroom above each stave (Text mode only) ──────────
    if (inputMode === 'text') for (const l of layouts) {
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

    // ── Lyric text click: select or lyric mode → enter lyric edit for that note ──
    if (inputMode === 'select' || inputMode === 'lyric') {
      const LYRIC_Y_OFF = 60   // must match notationRenderer LYRIC_Y_OFFSET
      for (const l of layouts) {
        const lyricY = l.staveTopY + LYRIC_Y_OFF
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
      // Clicked outside all measures — clear measure selection
      setSelectedMeasure(null)
      return
    }

    if (inputMode === 'note') {
      // Set cursor to end of existing events in the clicked measure (active voice)
      const part    = score.parts.find(p => p.id === layout.partId)
      const staff   = part?.staves.find(s => s.id === layout.staffId)
      const measure = staff?.measures.find(m => m.id === layout.measureId)
      if (!measure) return
      const existingVoice = measure.voices[activeVoice]
      const voiceEvents   = existingVoice?.events ?? []
      const timeSig = measure.timeSignature ?? score.timeSignature
      const used    = usedUnits(voiceEvents)
      const capacity = measureCapacityUnits(timeSig)
      if (used >= capacity) return
      setCursor(layout.measureId, used)

      // Also enter a note at the clicked Y pitch
      const step      = yToStep(canvasY, layout.staveTopY, LINE_SPACING_PX)
      const pitchInfo = stepToPitch(step, layout.clef)
      const dots      = isDotted ? 1 : 0 as 0 | 1
      const units     = dottedUnits(DURATION_UNITS[selectedDuration], dots)
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
          triggerInputPreview(noteWithDot.pitch.noteName, noteWithDot.pitch.octave, noteWithDot.pitch.accidental, volDb, midi === 45, clickPart.transposeSemitones)
        }
      }

      setPrimedAccidental(null)
      setLastEnteredPitch(noteWithDot.pitch)

      const newBeat = used + units
      if (newBeat >= capacity) {
        const measureIdx  = staff!.measures.findIndex(m => m.id === layout.measureId)
        const nextMeasure = staff!.measures[measureIdx + 1]
        if (nextMeasure) {
          setCursor(nextMeasure.id, usedUnits(nextMeasure.voices[activeVoice]?.events ?? []))
        } else {
          setCursor(null, 0)
        }
      } else {
        setCursor(layout.measureId, newBeat)
      }
      return
    }

    if (inputMode === 'rest') {
      const part    = score.parts.find(p => p.id === layout.partId)
      const staff   = part?.staves.find(s => s.id === layout.staffId)
      if (!staff) return
      const mIdx    = staff.measures.findIndex(m => m.id === layout.measureId)
      if (mIdx === -1) return
      const measure = staff.measures[mIdx]
      const voice   = measure.voices[0]
      const timeSig = resolveTimeSig(staff.measures, mIdx, score.timeSignature)
      const used    = usedUnits(voice?.events ?? [])
      const capacity = measureCapacityUnits(timeSig)
      if (used >= capacity) return

      setCursor(layout.measureId, used)

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

      const newBeat = used + units
      if (newBeat >= capacity) {
        const nextMeasure = staff.measures[mIdx + 1]
        if (nextMeasure) {
          setCursor(nextMeasure.id, usedUnits(nextMeasure.voices[0]?.events ?? []))
        } else {
          setCursor(null, 0)
        }
      } else {
        setCursor(layout.measureId, newBeat)
      }
      return
    }

    if (inputMode === 'eraser') {
      const part  = score.parts.find(p => p.id === layout.partId)
      const staff = part?.staves.find(s => s.id === layout.staffId)
      if (!staff) return
      const mIdx = staff.measures.findIndex(m => m.id === layout.measureId)
      if (mIdx === -1) return
      const measure = staff.measures[mIdx]
      const voice   = measure.voices[0]
      if (!voice || voice.events.length === 0) return

      let closest: { id: string; dist: number } | null = null
      for (const event of voice.events) {
        const noteX = notePositionsRef.current.get(event.id)
        if (noteX === undefined) continue
        const dist = Math.abs(canvasX - noteX)
        if (!closest || dist < closest.dist) closest = { id: event.id, dist }
      }

      if (closest) {
        dispatch({
          type:      'DELETE_NOTE',
          partId:    layout.partId,
          staffId:   layout.staffId,
          measureId: layout.measureId,
          voiceId:   voice.id,
          noteId:    closest.id,
        })
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
          const rect = canvas.getBoundingClientRect()
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

          const rect = canvas.getBoundingClientRect()
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

          const rect = canvas.getBoundingClientRect()
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
          const rect = canvas.getBoundingClientRect()
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
              const rect = canvas.getBoundingClientRect()
              const menuX = rect.left + closest.noteX
              const menuY = rect.top + layout.staveTopY + 4 * LINE_SPACING_PX + 12
              if (event.shiftKey) {
                // Shift+click: range select from anchor to clicked, or toggle
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
                setSelectedNote(closest.id)
                setSelectedMeasure(null)
                const ev = selVoice.events.find(e => e.id === closest!.id)
                if (ev) {
                  setSelectedDuration(ev.duration)
                  setIsDotted(ev.dots > 0)
                  if (soundOnInput && selPart && ev.type !== 'rest') {
                    const mIdx  = selMIdx
                    const dyn   = resolveDirectiveDynamic(selStaff.measures, mIdx)
                    const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? selPart.volume))
                    const midi  = resolveDirectiveMidiProgram(selStaff.measures, mIdx, selPart.midiProgram)
                    const isPizz = midi === 45
                    if (ev.type === 'note') {
                      triggerInputPreview(ev.pitch.noteName, ev.pitch.octave, ev.pitch.accidental, volDb, isPizz, selPart.transposeSemitones)
                    } else if (ev.type === 'chord') {
                      const top = ev.pitches[ev.pitches.length - 1]
                      triggerInputPreview(top.noteName, top.octave, top.accidental, volDb, isPizz, selPart.transposeSemitones)
                    }
                  }
                }
              }
              setSelectionMenuPos({ x: menuX, y: menuY })
              return
            }
          }
        }
      }

      // No note hit — select the measure (empty space click)
      setSelectedBarline(null)
      setPickerState(null)
      if (!event.shiftKey) {
        clearSelection()
        setSelectedMeasure(layout.measureId)
      }
    }
  }

  // ── Barline picker handlers ─────────────────────────────────────────────────

  // ── Double-click: create text box on empty space (select/eraser mode) ────────

  const handleCanvasDblClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>): void => {
    if (inputMode !== 'select' && inputMode !== 'eraser') return
    const canvas = canvasRef.current
    if (!canvas) return
    const { x: canvasX, y: canvasY } = canvasCoords(event, canvas)
    // Don't create a text box if we're in the heading area or on notation
    if (canvasY < HEADING_MARGIN_Y) return
    const options = getRenderOptions(zoom, score.showPartLabels)
    const layouts = computeLayout(score, options)
    const layout  = findClickedLayout(canvasX, canvasY, layouts)
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
    }
  }, [inputMode])

  useEffect(() => {
    if (selectedNoteIds.length === 0) setSelectionMenuPos(null)
  }, [selectedNoteIds.length])

  // ── Cursor style per mode ───────────────────────────────────────────────────

  const cursorStyle =
    inputMode === 'note'   ? 'crosshair'
    : inputMode === 'rest'   ? 'cell'
    : inputMode === 'eraser' ? 'pointer'
    : inputMode === 'text'   ? 'text'
    : inputMode === 'lyric'  ? 'text'
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
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onDoubleClick={handleCanvasDblClick}
          style={{ cursor: cursorStyle, display: 'block' }}
        />
        <TextBoxLayer zoom={zoom} />
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
      {transposeDialogOpen && (
        <TransposeDialog
          onTranspose={transposeSelectedNotes}
          onClose={() => setTransposeDialogOpen(false)}
        />
      )}

      {selectedNoteIds.length > 0 && inputMode === 'select' && selectionMenuPos && (() => {
        // Resolve current dynamic for single-note selection
        let currentDynamic: DynamicLevel | undefined
        if (selectedNoteId) {
          for (const part of score.parts) {
            for (const staff of part.staves) {
              for (const measure of staff.measures) {
                for (const voice of measure.voices) {
                  const ev = voice.events.find(e => e.id === selectedNoteId)
                  if (ev) { currentDynamic = (ev as any).dynamic; break }
                }
              }
            }
          }
        }
        // Find active tie state
        let hasTie = false
        if (selectedNoteId) {
          for (const part of score.parts) {
            for (const staff of part.staves) {
              for (const measure of staff.measures) {
                for (const voice of measure.voices) {
                  const ev = voice.events.find(e => e.id === selectedNoteId)
                  if (ev?.type === 'note' && (ev as Note).tieStart) hasTie = true
                }
              }
            }
          }
        }
        // Compute the measure index range covered by the current selection
        const selIdSet = new Set(selectedNoteIds)
        let selMinMeasure = Infinity, selMaxMeasure = -Infinity
        const firstStaff = score.parts[0]?.staves[0]
        if (firstStaff) {
          firstStaff.measures.forEach((m, idx) => {
            for (const voice of m.voices) {
              if (voice.events.some(e => selIdSet.has(e.id))) {
                selMinMeasure = Math.min(selMinMeasure, idx)
                selMaxMeasure = Math.max(selMaxMeasure, idx)
              }
            }
          })
        }
        const selHasMeasure = selMaxMeasure >= selMinMeasure && selMinMeasure !== Infinity
        // Existing volta that exactly covers the selected range (for toggle)
        const existingVolta: Volta | undefined = selHasMeasure
          ? (score.voltas ?? []).find(v =>
              v.startMeasureIndex === selMinMeasure && v.endMeasureIndex === selMaxMeasure
            )
          : undefined

        const menuW = 360
        const left = Math.min(selectionMenuPos.x - menuW / 2, window.innerWidth - menuW - 8)
        const top  = Math.min(selectionMenuPos.y, window.innerHeight - 180)
        const btnBase: React.CSSProperties = {
          padding: '3px 8px', borderRadius: 3, border: '1px solid #555',
          background: '#2d2d2d', color: '#ccc', cursor: 'pointer', fontSize: 11,
        }
        const btnActive: React.CSSProperties = { ...btnBase, background: '#0e639c', color: '#fff', borderColor: '#0e639c' }
        const divider: React.CSSProperties = { borderTop: '1px solid #333', paddingTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' as const, alignItems: 'center' }
        const DYNAMICS: DynamicLevel[] = ['pp', 'p', 'mp', 'mf', 'f', 'ff']
        return (
          <div style={{
            position: 'fixed', left, top,
            background: '#1e1e1e', border: '1px solid #444', borderRadius: 6,
            padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
            zIndex: 1000, boxShadow: '0 4px 16px rgba(0,0,0,0.5)', fontSize: 12, color: '#d4d4d4',
            minWidth: menuW,
          }}>
            {/* Row 1: note / multi-select operations */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              {selectedNoteIds.length > 1 && (
                <span style={{ color: '#888', fontSize: 11, marginRight: 4 }}>
                  {selectedNoteIds.length} selected
                </span>
              )}
              {selectedNoteId && (() => {
                const hasOutgoingSlur = !slurPendingId && score.parts.some(p =>
                  p.staves.some(s => s.slurs?.some(sl => sl.fromNoteId === selectedNoteId))
                )
                return (
                  <>
                    <button onClick={toggleTie} title="Toggle tie (T)" style={hasTie ? btnActive : btnBase}>Tie</button>
                    <button
                      onClick={handleSlurKey}
                      title={slurPendingId ? 'Cancel slur (Esc)' : hasOutgoingSlur ? 'Remove slur (L)' : 'Start slur (L)'}
                      style={
                        slurPendingId    ? { ...btnBase, background: '#6d3a00', borderColor: '#a0550a', color: '#ffc080' } :
                        hasOutgoingSlur  ? { ...btnBase, background: '#3a1a3a', borderColor: '#7a3a7a', color: '#e0a0e0' } :
                        btnBase
                      }
                    >
                      {slurPendingId ? 'Slur…' : hasOutgoingSlur ? 'Slur ✕' : 'Slur'}
                    </button>
                  </>
                )
              })()}
              {selectedNoteIds.length >= 2 && (
                <>
                  <button onClick={() => addHairpin('crescendo')}   title="Add crescendo"   style={btnBase}>cresc</button>
                  <button onClick={() => addHairpin('decrescendo')} title="Add decrescendo" style={btnBase}>dim</button>
                </>
              )}
              {selectedNoteIds.length === 3 && <button onClick={() => applyTuplet(3, 2)} title="Make triplet"     style={btnBase}>3</button>}
              {selectedNoteIds.length === 5 && <button onClick={() => applyTuplet(5, 4)} title="Make quintuplet"  style={btnBase}>5</button>}
              {selectedNoteIds.length === 6 && <button onClick={() => applyTuplet(6, 4)} title="Make sextuplet"   style={btnBase}>6</button>}
              <button onClick={() => setTransposeDialogOpen(true)} title="Transpose (Shift+T)" style={btnBase}>Transpose…</button>
            </div>
            {/* Row 2: articulations */}
            {nonRestLocations.length > 0 && (
              <div style={divider}>
                {ARTICULATION_BUTTONS.map(({ art, label, title }) => (
                  <button key={art} onClick={() => handleArticulationClick(art)} title={title}
                    style={{ ...( artActive[art] ? btnActive : btnBase ), fontFamily: 'serif', fontSize: 13 }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {/* Row 3: dynamics (single note only) */}
            {selectedNoteId && (
              <div style={divider}>
                {DYNAMICS.map(d => (
                  <button key={d}
                    onClick={() => setNoteDynamic(selectedNoteId, currentDynamic === d ? undefined : d)}
                    title={currentDynamic === d ? `Remove ${d}` : `Set dynamic: ${d}`}
                    style={{ ...(currentDynamic === d ? btnActive : btnBase), fontFamily: 'Edwin, serif', fontStyle: 'italic', fontWeight: 'bold', fontSize: 13 }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}
            {/* Row 4: volta brackets */}
            {selHasMeasure && (
              <div style={{ ...divider, alignItems: 'center' }}>
                <span style={{ color: '#888', fontSize: 10, marginRight: 2 }}>Volta</span>
                {([1, 2, 3] as const).map(n => {
                  const isActive = existingVolta?.number === n
                  return (
                    <button key={n}
                      onClick={() => {
                        if (isActive && existingVolta) {
                          removeVolta(existingVolta.id)
                        } else {
                          if (existingVolta) removeVolta(existingVolta.id)
                          addVolta({ number: n, startMeasureIndex: selMinMeasure, endMeasureIndex: selMaxMeasure })
                        }
                      }}
                      title={isActive ? `Remove ending ${n}` : `Add ending ${n} (measures ${selMinMeasure + 1}–${selMaxMeasure + 1})`}
                      style={isActive ? btnActive : btnBase}
                    >
                      {n}.
                    </button>
                  )
                })}
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
