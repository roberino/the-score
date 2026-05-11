import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import {
  renderScore,
  computeLayout,
  DEFAULT_RENDER_OPTIONS,
  type MeasureLayout,
} from '../engine/notationRenderer'
import { createNote, createRest, type NoteName, type Accidental, type Note } from '@shared/score'
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
} from '@shared/musicUtils'

const LINE_SPACING_PX = 10

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRenderOptions(zoom: number) {
  return {
    ...DEFAULT_RENDER_OPTIONS,
    canvasWidth: Math.floor(DEFAULT_RENDER_OPTIONS.canvasWidth * zoom),
    staveWidth:  Math.floor(DEFAULT_RENDER_OPTIONS.staveWidth  * zoom),
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
  const LEDGER_MARGIN = 30
  const STAVE_HEIGHT  = 4 * LINE_SPACING_PX   // 40px
  return layouts.find(l =>
    x >= l.x &&
    x <= l.x + l.width &&
    y >= l.staveTopY - LEDGER_MARGIN &&
    y <= l.staveTopY + STAVE_HEIGHT + LEDGER_MARGIN
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScoreCanvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const {
    score, zoom, inputMode,
    selectedDuration, isDotted, primedAccidental,
    cursorMeasureId, cursorBeatPosition,
    lastEnteredPitch, selectedNoteId,
    dispatch, setInputMode,
    setSelectedDuration, toggleDot, setPrimedAccidental,
    setCursor, setLastEnteredPitch,
    setSelectedNote,
    moveCursorToFirstAvailable,
  } = useAppStore()

  // ── Render ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const options = getRenderOptions(zoom)
    const timeSig = score.timeSignature
    const capacity = measureCapacityUnits(timeSig)
    renderScore(
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
      setLastEnteredPitch, setCursor])

  const enterRest = useCallback(() => {
    if (!cursorMeasureId) return

    for (const part of score.parts) {
      for (const staff of part.staves) {
        const measure = staff.measures.find(m => m.id === cursorMeasureId)
        if (!measure) continue

        const voice   = measure.voices[0]
        const timeSig = measure.timeSignature ?? score.timeSignature
        const dots    = isDotted ? 1 : 0 as 0 | 1
        const units   = dottedUnits(DURATION_UNITS[selectedDuration], dots)

        if (remainingUnits(voice.events, timeSig) < units) return

        const rest      = createRest(selectedDuration)
        const restWithDot = { ...rest, dots } as typeof rest

        dispatch({
          type: 'ADD_NOTE',
          partId:    part.id,
          staffId:   staff.id,
          measureId: measure.id,
          voiceId:   voice.id,
          event:     restWithDot,
        })

        const newBeat = cursorBeatPosition + units
        const capacity = measureCapacityUnits(timeSig)
        if (newBeat >= capacity) {
          const measureIdx = staff.measures.findIndex(m => m.id === cursorMeasureId)
          const nextMeasure = staff.measures[measureIdx + 1]
          if (nextMeasure) {
            const nextVoice = nextMeasure.voices[0]
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

      // Rest entry (rest mode: Space or Enter)
      if (inputMode === 'rest' && !mod && (e.key === ' ' || e.key === 'Enter')) {
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
    setInputMode, setSelectedDuration, toggleDot, setPrimedAccidental, dispatch,
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
    const options = getRenderOptions(zoom)
    const layouts = computeLayout(score, options)
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
      const measure = staff?.measures.find(m => m.id === layout.measureId)
      if (!measure) return
      const voice   = measure.voices[0]
      const timeSig = measure.timeSignature ?? score.timeSignature
      const used    = usedUnits(voice?.events ?? [])
      if (used >= measureCapacityUnits(timeSig)) return
      setCursor(layout.measureId, used)
      return
    }

    if (inputMode === 'select') {
      // Find if a note was clicked (approximate: check if click X is within note area)
      // For now, select the measure and deselect any note
      setSelectedNote(null)
      // A future improvement: hit-test individual note heads via VexFlow positions
    }
  }

  // ── Cursor style per mode ───────────────────────────────────────────────────

  const cursorStyle =
    inputMode === 'note'   ? 'crosshair'
    : inputMode === 'rest'   ? 'cell'
    : inputMode === 'eraser' ? 'pointer'
    : 'default'

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 4,
      display: 'inline-block',
      minWidth: '100%',
    }}>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{ cursor: cursorStyle, display: 'block' }}
      />
    </div>
  )
}
