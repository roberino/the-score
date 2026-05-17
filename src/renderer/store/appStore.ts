import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createScore, type Score, type Pitch, type Duration, type Accidental } from '@shared/score'
import { applyCommand, type Command } from '@shared/commands'
import { measureCapacityUnits, usedUnits, resolveTimeSig } from '@shared/musicUtils'
import { playScore, type PlaybackController } from '../engine/audioEngine'

let _playback: PlaybackController | null = null

// ── Types ─────────────────────────────────────────────────────────────────────

export type InputMode = 'select' | 'note' | 'rest' | 'eraser'

export interface AppState {
  // Score data
  score: Score
  filePath: string | null
  isDirty: boolean

  // Undo / redo stacks — full snapshots (phase 1)
  undoStack: Score[]
  redoStack: Score[]

  // Editor state
  selectedNoteId: string | null
  selectedMeasureId: string | null
  selectedBarlineId: string | null   // measure ID whose right barline is selected
  inputMode: InputMode
  zoom: number

  // Note input state
  selectedDuration: Duration
  isDotted: boolean
  primedAccidental: Accidental | null
  cursorMeasureId: string | null
  cursorBeatPosition: number          // in 64th-note units
  lastEnteredPitch: Pitch | null

  // UI panels
  keyboardVisible: boolean

  // Playback
  isPlaying: boolean
  playbackPositionTick: number

  // Actions
  startPlayback: () => Promise<void>
  stopPlayback: () => void
  dispatch: (command: Command) => void
  undo: () => void
  redo: () => void
  newScore: () => void
  loadScore: (score: Score, path: string) => void
  saveScore: () => Promise<void>
  saveScoreAs: () => Promise<void>
  setInputMode: (mode: InputMode) => void
  setZoom: (zoom: number) => void
  setSelectedNote: (noteId: string | null) => void
  setSelectedMeasure: (measureId: string | null) => void
  setSelectedBarline: (measureId: string | null) => void
  setPlaying: (playing: boolean) => void
  setSelectedDuration: (duration: Duration) => void
  setIsDotted: (dotted: boolean) => void
  toggleDot: () => void
  setPrimedAccidental: (acc: Accidental | null) => void
  setCursor: (measureId: string | null, beatPosition: number) => void
  setLastEnteredPitch: (pitch: Pitch | null) => void
  moveCursorToFirstAvailable: () => void
  checkAndAutoAddBar: () => void
  toggleKeyboard: () => void
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>()(
  immer((set, get) => ({
    score: createScore(),
    filePath: null,
    isDirty: false,
    undoStack: [],
    redoStack: [],
    selectedNoteId: null,
    selectedMeasureId: null,
    selectedBarlineId: null,
    inputMode: 'note',
    zoom: 1.0,

    selectedDuration: 'quarter',
    isDotted: false,
    primedAccidental: null,
    cursorMeasureId: null,
    cursorBeatPosition: 0,
    lastEnteredPitch: null,

    keyboardVisible: false,

    isPlaying: false,
    playbackPositionTick: 0,

    dispatch: (command: Command) => {
      set(state => {
        const prev = state.score
        const next = applyCommand(state.score, command)
        state.undoStack.push(prev)
        if (state.undoStack.length > 100) state.undoStack.shift()
        state.redoStack = []
        state.score = next as any
        state.isDirty = true
      })
      if (command.type === 'ADD_NOTE') {
        get().checkAndAutoAddBar()
      }
    },

    undo: () => {
      set(state => {
        const prev = state.undoStack.pop()
        if (!prev) return
        state.redoStack.push(state.score)
        state.score = prev as any
        state.isDirty = true
      })
    },

    redo: () => {
      set(state => {
        const next = state.redoStack.pop()
        if (!next) return
        state.undoStack.push(state.score)
        state.score = next as any
        state.isDirty = true
      })
    },

    newScore: () => {
      _playback?.stop(); _playback = null
      set(state => {
        state.score = createScore() as any
        state.filePath = null
        state.isDirty = false
        state.undoStack = []
        state.redoStack = []
        state.cursorMeasureId = null
        state.cursorBeatPosition = 0
        state.lastEnteredPitch = null
        state.selectedNoteId = null
        state.selectedBarlineId = null
        state.isPlaying = false
      })
    },

    loadScore: (score: Score, path: string) => {
      _playback?.stop(); _playback = null
      set(state => {
        state.score = score as any
        state.filePath = path
        state.isDirty = false
        state.undoStack = []
        state.redoStack = []
        state.cursorMeasureId = null
        state.cursorBeatPosition = 0
        state.lastEnteredPitch = null
        state.selectedNoteId = null
        state.selectedBarlineId = null
        state.isPlaying = false
      })
    },

    saveScore: async () => {
      const { score, filePath } = get()
      const json = JSON.stringify(score, null, 2)
      if (filePath) {
        await window.electronAPI.saveFile(filePath, json)
        set(s => { s.isDirty = false })
      } else {
        await get().saveScoreAs()
      }
    },

    saveScoreAs: async () => {
      const { score } = get()
      const json = JSON.stringify(score, null, 2)
      const result = await window.electronAPI.saveFileAs(json)
      if (result) {
        set(s => {
          s.filePath = result.path
          s.isDirty = false
        })
      }
    },

    setInputMode: (mode) => {
      set(s => {
        s.inputMode = mode
        s.primedAccidental = null
        s.selectedBarlineId = null
        if (mode !== 'note' && mode !== 'rest') {
          s.cursorMeasureId = null
          s.cursorBeatPosition = 0
        }
      })
      if (mode === 'note' || mode === 'rest') {
        const { cursorMeasureId } = get()
        if (!cursorMeasureId) get().moveCursorToFirstAvailable()
      }
    },

    setZoom: (zoom) => set(s => { s.zoom = Math.max(0.25, Math.min(4, zoom)) }),
    setSelectedNote: (id) => set(s => { s.selectedNoteId = id }),
    setSelectedMeasure: (id) => set(s => { s.selectedMeasureId = id }),
    setSelectedBarline: (id) => set(s => { s.selectedBarlineId = id }),
    setPlaying: (playing) => set(s => { s.isPlaying = playing }),

    startPlayback: async () => {
      if (_playback) return
      const { score } = get()
      _playback = await playScore(score, 120, () => {
        _playback = null
        set(s => { s.isPlaying = false })
      })
      set(s => { s.isPlaying = true })
    },

    stopPlayback: () => {
      _playback?.stop()
      _playback = null
      set(s => { s.isPlaying = false })
    },
    setSelectedDuration: (duration) => set(s => { s.selectedDuration = duration }),
    setIsDotted: (dotted) => set(s => { s.isDotted = dotted }),
    toggleDot: () => {
      const { score, selectedNoteId, inputMode } = get()
      if (inputMode === 'select' && selectedNoteId) {
        for (const part of score.parts) {
          for (const staff of part.staves) {
            for (const measure of staff.measures) {
              for (const voice of measure.voices) {
                const event = voice.events.find(e => e.id === selectedNoteId)
                if (event) {
                  const newDots = (event.dots === 1 ? 0 : 1) as 0 | 1
                  get().dispatch({
                    type:      'SET_NOTE_DURATION',
                    partId:    part.id,
                    staffId:   staff.id,
                    measureId: measure.id,
                    voiceId:   voice.id,
                    noteId:    selectedNoteId,
                    duration:  event.duration,
                    dots:      newDots,
                  })
                  set(s => { s.isDotted = newDots === 1 })
                  return
                }
              }
            }
          }
        }
      }
      set(s => { s.isDotted = !s.isDotted })
    },
    setPrimedAccidental: (acc) => set(s => { s.primedAccidental = acc }),
    setCursor: (measureId, beatPosition) => set(s => {
      s.cursorMeasureId = measureId
      s.cursorBeatPosition = beatPosition
    }),
    setLastEnteredPitch: (pitch) => set(s => { s.lastEnteredPitch = pitch as any }),

    moveCursorToFirstAvailable: () => {
      set(state => {
        const score = state.score
        for (const part of score.parts) {
          for (const staff of part.staves) {
            for (let i = 0; i < staff.measures.length; i++) {
              const measure = staff.measures[i]
              const voice = measure.voices[0]
              const timeSig = resolveTimeSig(staff.measures, i, score.timeSignature)
              const capacity = measureCapacityUnits(timeSig)
              const used = usedUnits(voice?.events ?? [])
              if (used < capacity) {
                state.cursorMeasureId = measure.id
                state.cursorBeatPosition = used
                return
              }
            }
          }
        }
        state.cursorMeasureId = null
        state.cursorBeatPosition = 0
      })
    },

    toggleKeyboard: () => set(s => { s.keyboardVisible = !s.keyboardVisible }),

    checkAndAutoAddBar: () => {
      const score = get().score
      const firstPart = score.parts[0]
      if (!firstPart) return
      const firstStaff = firstPart.staves[0]
      if (!firstStaff) return

      const measures = firstStaff.measures
      const lastMeasure = measures[measures.length - 1]
      if (!lastMeasure) return

      const voice = lastMeasure.voices[0]
      const timeSig = resolveTimeSig(firstStaff.measures, firstStaff.measures.length - 1, score.timeSignature)
      if (usedUnits(voice?.events ?? []) < measureCapacityUnits(timeSig)) return

      // Atomically: add measure + fix barlines (single undo step)
      set(state => {
        const prev = state.score as Score
        let s = prev

        s = applyCommand(s, {
          type:           'ADD_MEASURE',
          partId:         firstPart.id,
          staffId:        firstStaff.id,
          afterMeasureId: lastMeasure.id,
        })

        const updatedMeasures = s.parts[0]!.staves[0]!.measures
        const newLast  = updatedMeasures[updatedMeasures.length - 1]
        const prevLast = updatedMeasures[updatedMeasures.length - 2]

        if (prevLast) {
          s = applyCommand(s, {
            type: 'SET_BARLINE', partId: firstPart.id, staffId: firstStaff.id,
            measureId: prevLast.id, barline: 'single',
          })
        }
        if (newLast) {
          s = applyCommand(s, {
            type: 'SET_BARLINE', partId: firstPart.id, staffId: firstStaff.id,
            measureId: newLast.id, barline: 'final',
          })
        }

        state.undoStack.push(prev as any)
        if (state.undoStack.length > 100) state.undoStack.shift()
        state.redoStack = []
        state.score = s as any
        state.isDirty = true
      })
    },
  }))
)
