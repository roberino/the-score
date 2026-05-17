import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import {
  renderScore,
  computeLayout,
  DEFAULT_RENDER_OPTIONS,
  LABEL_MARGIN_X,
  HEADING_MARGIN_Y,
  headingFieldBounds,
  type MeasureLayout,
  type HeadingFieldBound,
} from '../engine/notationRenderer'
import { createNote, createRest, type NoteName, type Accidental, type Note, type BarlineType, type TimeSignature, type KeySignature, type ClefType, type Directive } from '@shared/score'
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
import { useMidiInput } from '../hooks/useMidiInput'
import type { NoteInput } from '../services/midiService'

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

export function ScoreCanvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const notePositionsRef = useRef(new Map<string, number>())
  const [pickerState, setPickerState] = useState<PickerState | null>(null)
  const [timeSigPickerState, setTimeSigPickerState] = useState<TimeSigPickerState | null>(null)
  const [keySigPickerState, setKeySigPickerState] = useState<KeySigPickerState | null>(null)
  const [clefPickerState, setClefPickerState] = useState<ClefPickerState | null>(null)
  const [directivePickerState, setDirectivePickerState] = useState<DirectivePickerState | null>(null)
  const [editingHeading, setEditingHeading] = useState<HeadingFieldBound | null>(null)

  const {
    score, zoom, inputMode,
    selectedDuration, isDotted, primedAccidental,
    cursorMeasureId, cursorBeatPosition,
    lastEnteredPitch, selectedNoteId,
    dispatch, setInputMode,
    setSelectedDuration, setIsDotted, toggleDot, setPrimedAccidental,
    setCursor, setLastEnteredPitch,
    setSelectedNote, setSelectedBarline,
    moveCursorToFirstAvailable,
    keyboardVisible, toggleKeyboard,
    soundOnInput, audioMode,
  } = useAppStore()

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
      selectedNoteId,
      cursorMeasureId
        ? { cursorMeasureId, cursorBeatPosition, totalCapacityUnits: capacity }
        : null
    )
  }, [score, zoom, selectedNoteId, cursorMeasureId, cursorBeatPosition])

  // ── Note entry helpers ──────────────────────────────────────────────────────

  const enterNote = useCallback((noteName: NoteName) => {
    if (!cursorMeasureId) return

    // Find context in score
    for (const part of score.parts) {
      for (const staff of part.staves) {
        const measure = staff.measures.find(m => m.id === cursorMeasureId)
        if (!measure) continue

        const voice   = measure.voices[0]
        const timeSig = measure.timeSignature ?? score.timeSignature
        const dots    = isDotted ? 1 : 0 as 0 | 1
        const units   = dottedUnits(DURATION_UNITS[selectedDuration], dots)

        if (remainingUnits(voice.events, timeSig) < units) {
          // Measure full — flash by briefly toggling a class; simplest signal
          canvasRef.current?.classList.add('cursor-reject')
          setTimeout(() => canvasRef.current?.classList.remove('cursor-reject'), 200)
          return
        }

        const octave      = closestOctave(noteName, lastEnteredPitch)
        const accidental  = primedAccidental as Accidental
        const note        = createNote(noteName, octave, selectedDuration, accidental)
        const noteWithDot = { ...note, dots } as Note

        dispatch({
          type: 'ADD_NOTE',
          partId:    part.id,
          staffId:   staff.id,
          measureId: measure.id,
          voiceId:   voice.id,
          event:     noteWithDot,
        })

        if (soundOnInput) {
          const mIdx  = staff.measures.findIndex(m => m.id === cursorMeasureId)
          const dyn   = resolveDirectiveDynamic(staff.measures, mIdx)
          const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? part.volume))
          const midi  = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
          triggerInputPreview(noteWithDot.pitch.noteName, noteWithDot.pitch.octave, noteWithDot.pitch.accidental, volDb, midi === 45, part.transposeSemitones)
        }

        setPrimedAccidental(null)
        setLastEnteredPitch(noteWithDot.pitch)

        // Advance cursor
        const newBeat = cursorBeatPosition + units
        const capacity = measureCapacityUnits(timeSig)
        if (newBeat >= capacity) {
          // Advance to next measure
          const measureIdx = staff.measures.findIndex(m => m.id === cursorMeasureId)
          const nextMeasure = staff.measures[measureIdx + 1]
          if (nextMeasure) {
            const nextVoice   = nextMeasure.voices[0]
            const nextTimeSig = nextMeasure.timeSignature ?? score.timeSignature
            setCursor(nextMeasure.id, usedUnits(nextVoice?.events ?? []))
            void nextTimeSig
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
      primedAccidental, lastEnteredPitch, dispatch, setPrimedAccidental,
      setLastEnteredPitch, setCursor, soundOnInput, audioMode])

  // Explicit-octave variant used by virtual keyboard and MIDI input
  const enterNoteAtPitch = useCallback((noteName: NoteName, octave: number, accidental?: Accidental) => {
    if (!cursorMeasureId) {
      // Keyboard/MIDI note pressed without cursor — auto-place cursor and switch to note mode
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
        const note        = createNote(noteName, octave, selectedDuration, accidental ?? null)
        const noteWithDot = { ...note, dots } as Note
        dispatch({
          type: 'ADD_NOTE',
          partId:    part.id,
          staffId:   staff.id,
          measureId: measure.id,
          voiceId:   voice.id,
          event:     noteWithDot,
        })
        if (soundOnInput) {
          const mIdx  = staff.measures.findIndex(m => m.id === cursorMeasureId)
          const dyn   = resolveDirectiveDynamic(staff.measures, mIdx)
          const volDb = 20 * Math.log10(Math.max(0.001, dyn ?? part.volume))
          const midi  = resolveDirectiveMidiProgram(staff.measures, mIdx, part.midiProgram)
          triggerInputPreview(noteWithDot.pitch.noteName, noteWithDot.pitch.octave, noteWithDot.pitch.accidental, volDb, midi === 45, part.transposeSemitones)
        }
        setLastEnteredPitch(noteWithDot.pitch)
        const newBeat  = cursorBeatPosition + units
        const capacity = measureCapacityUnits(timeSig)
        if (newBeat >= capacity) {
          const mIdx       = staff.measures.findIndex(m => m.id === cursorMeasureId)
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
      dispatch, setLastEnteredPitch, setCursor, setInputMode, soundOnInput, audioMode])

  // Stable handler ref so useMidiInput/VirtualKeyboard don't re-subscribe on every render
  const noteInputHandler = useCallback((input: NoteInput) => {
    if (inputMode !== 'note') setInputMode('note')
    enterNoteAtPitch(input.noteName, input.octave, input.accidental as Accidental | undefined)
  }, [enterNoteAtPitch, inputMode, setInputMode])

  const stableNoteInputHandler = useMemo(() => noteInputHandler, [noteInputHandler])
  useMidiInput(stableNoteInputHandler)

  const enterRest = useCallback(() => {
    if (!cursorMeasureId) return

    for (const part of score.parts) {
      for (const staff of part.staves) {
        const measureIdx = staff.measures.findIndex(m => m.id === cursorMeasureId)
        if (measureIdx === -1) continue
        const measure = staff.measures[measureIdx]

        const voice   = measure.voices[0]
        const timeSig = resolveTimeSig(staff.measures, measureIdx, score.timeSignature)
        const dots    = isDotted ? 1 : 0 as 0 | 1
        const units   = dottedUnits(DURATION_UNITS[selectedDuration], dots)

        if (remainingUnits(voice.events, timeSig) < units) {
          canvasRef.current?.classList.add('cursor-reject')
          setTimeout(() => canvasRef.current?.classList.remove('cursor-reject'), 200)
          return
        }

        const rest        = createRest(selectedDuration)
        const restWithDot = { ...rest, dots } as typeof rest

        dispatch({
          type: 'ADD_NOTE',
          partId:    part.id,
          staffId:   staff.id,
          measureId: measure.id,
          voiceId:   voice.id,
          event:     restWithDot,
        })

        const newBeat  = cursorBeatPosition + units
        const capacity = measureCapacityUnits(timeSig)
        if (newBeat >= capacity) {
          const nextMeasure = staff.measures[measureIdx + 1]
          if (nextMeasure) {
            setCursor(nextMeasure.id, usedUnits(nextMeasure.voices[0]?.events ?? []))
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
      dispatch, setCursor])

  const deleteSelectedNote = useCallback(() => {
    if (!selectedNoteId) return
    for (const part of score.parts) {
      for (const staff of part.staves) {
        for (const measure of staff.measures) {
          for (const voice of measure.voices) {
            const idx = voice.events.findIndex(e => e.id === selectedNoteId)
            if (idx !== -1) {
              dispatch({
                type: 'DELETE_NOTE',
                partId:    part.id,
                staffId:   staff.id,
                measureId: measure.id,
                voiceId:   voice.id,
                noteId:    selectedNoteId,
              })
              setSelectedNote(null)
              return
            }
          }
        }
      }
    }
  }, [score, selectedNoteId, dispatch, setSelectedNote])

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

  // ── Keyboard handler ────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Skip if user is typing in an input
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const mod = e.metaKey || e.ctrlKey

      // Escape → select mode
      if (e.key === 'Escape') { setInputMode('select'); return }

      // Mode shortcuts (no modifier)
      if (!mod) {
        if (e.key === 'n' || e.key === 'N') { setInputMode('note');   return }
        if (e.key === 'r' || e.key === 'R') { setInputMode('rest');   return }
        if (e.key === 's' || e.key === 'S') { setInputMode('select'); return }
        if (e.key === 'e' || e.key === 'E') { setInputMode('eraser'); return }
        if (e.key === 't' || e.key === 'T') { setInputMode('text');   return }
        if (e.key === 'k' || e.key === 'K') { toggleKeyboard();       return }
      }

      // Duration keys 1–7 (no modifier)
      if (!mod && KEY_TO_DURATION[e.key]) {
        const dur = KEY_TO_DURATION[e.key]
        setSelectedDuration(dur)
        // In select mode, change selected note's duration
        if (inputMode === 'select' && selectedNoteId) {
          for (const part of score.parts) {
            for (const staff of part.staves) {
              for (const measure of staff.measures) {
                for (const voice of measure.voices) {
                  if (voice.events.some(ev => ev.id === selectedNoteId)) {
                    dispatch({
                      type: 'SET_NOTE_DURATION',
                      partId:    part.id,
                      staffId:   staff.id,
                      measureId: measure.id,
                      voiceId:   voice.id,
                      noteId:    selectedNoteId,
                      duration:  dur,
                    })
                    return
                  }
                }
              }
            }
          }
        }
        return
      }

      // Dot toggle
      if (!mod && e.key === '.') { toggleDot(); return }

      // Accidental priming (note mode, no modifier)
      if (inputMode === 'note' && !mod) {
        if (e.key === 'ArrowUp')   { e.preventDefault(); setPrimedAccidental('sharp');   return }
        if (e.key === 'ArrowDown') { e.preventDefault(); setPrimedAccidental('flat');    return }
        if (e.key === '0')         {                      setPrimedAccidental('natural'); return }
      }

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

      // Delete / Backspace
      if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        deleteSelectedNote()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    inputMode, score, selectedNoteId,
    enterNote, enterRest, deleteSelectedNote, nudgeOctave,
    setInputMode, setSelectedDuration, toggleDot, setPrimedAccidental, dispatch, toggleKeyboard,
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

    const layout  = findClickedLayout(canvasX, canvasY, layouts)
    if (!layout) return

    if (inputMode === 'note') {
      // Set cursor to end of existing events in the clicked measure
      const part    = score.parts.find(p => p.id === layout.partId)
      const staff   = part?.staves.find(s => s.id === layout.staffId)
      const measure = staff?.measures.find(m => m.id === layout.measureId)
      if (!measure) return
      const voice   = measure.voices[0]
      const timeSig = measure.timeSignature ?? score.timeSignature
      const used    = usedUnits(voice?.events ?? [])
      const capacity = measureCapacityUnits(timeSig)
      if (used >= capacity) return
      setCursor(layout.measureId, used)

      // Also enter a note at the clicked Y pitch
      const step      = yToStep(canvasY, layout.staveTopY, LINE_SPACING_PX)
      const pitchInfo = stepToPitch(step, layout.clef)
      const dots      = isDotted ? 1 : 0 as 0 | 1
      const units     = dottedUnits(DURATION_UNITS[selectedDuration], dots)
      if (remainingUnits(voice.events, timeSig) < units) return

      const accidental = primedAccidental as Accidental
      const note       = createNote(pitchInfo.noteName, pitchInfo.octave, selectedDuration, accidental)
      const noteWithDot = { ...note, dots } as Note

      dispatch({
        type: 'ADD_NOTE',
        partId:    layout.partId,
        staffId:   layout.staffId,
        measureId: layout.measureId,
        voiceId:   layout.voiceId,
        event:     noteWithDot,
      })

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
        const measureIdx = staff!.measures.findIndex(m => m.id === layout.measureId)
        const nextMeasure = staff!.measures[measureIdx + 1]
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
            let closest: { id: string; dist: number } | null = null
            for (const event of selVoice.events) {
              const noteX = notePositionsRef.current.get(event.id)
              if (noteX === undefined) continue
              const dist = Math.abs(canvasX - noteX)
              if (!closest || dist < closest.dist) closest = { id: event.id, dist }
            }
            if (closest && closest.dist <= 20) {
              setSelectedNote(closest.id)
              const event = selVoice.events.find(e => e.id === closest.id)
              if (event) {
                setSelectedDuration(event.duration)
                setIsDotted(event.dots > 0)
              }
              return
            }
          }
        }
      }

      // No hit — close picker and deselect
      setSelectedBarline(null)
      setPickerState(null)
      setSelectedNote(null)
    }
  }

  // ── Barline picker handlers ─────────────────────────────────────────────────

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

  // ── Cursor style per mode ───────────────────────────────────────────────────

  const cursorStyle =
    inputMode === 'note'   ? 'crosshair'
    : inputMode === 'rest'   ? 'cell'
    : inputMode === 'eraser' ? 'pointer'
    : inputMode === 'text'   ? 'text'
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
          style={{ cursor: cursorStyle, display: 'block' }}
        />
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
          onNotePress={noteInputHandler}
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
    </>
  )
}
