import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createScore, type Score, type Pitch, type Duration, type Accidental } from '@shared/score'
import { applyCommand, type Command } from '@shared/commands'
import { measureCapacityUnits, usedUnits } from '@shared/musicUtils'

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
  inputMode: InputMode
  zoom: number

  // Note input state
  selectedDuration: Duration
  isDotted: boolean
  primedAccidental: Accidental | null
  cursorMeasureId: string | null
  cursorBeatPosition: number          // in 64th-note units
  lastEnteredPitch: Pitch | null

  // Playback
  isPlaying: boolean
  playbackPositionTick: number

  // Actions
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
  setPlaying: (playing: boolean) => void
  setSelectedDuration: (duration: Duration) => void
  toggleDot: () => void
  setPrimedAccidental: (acc: Accidental | null) => void
  setCursor: (measureId: string | null, beatPosition: number) => void
  setLastEnteredPitch: (pitch: Pitch | null) => void
  moveCursorToFirstAvailable: () => void
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
    inputMode: 'note',
    zoom: 1.0,

    selectedDuration: 'quarter',
    isDotted: false,
    primedAccidental: null,
    cursorMeasureId: null,
    cursorBeatPosition: 0,
    lastEnteredPitch: null,

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
      })
    },

    loadScore: (score: Score, path: string) => {
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
    setPlaying: (playing) => set(s => { s.isPlaying = playing }),
    setSelectedDuration: (duration) => set(s => { s.selectedDuration = duration }),
    toggleDot: () => set(s => { s.isDotted = !s.isDotted }),
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
            for (const measure of staff.measures) {
              const voice = measure.voices[0]
              const timeSig = measure.timeSignature ?? score.timeSignature
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
  }))
)
