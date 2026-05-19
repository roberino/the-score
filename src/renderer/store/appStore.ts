import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createScore, type Score, type Pitch, type Duration, type Accidental } from '@shared/score'
import { applyCommand, type Command } from '@shared/commands'
import { measureCapacityUnits, usedUnits, resolveTimeSig, dottedUnits, DURATION_UNITS } from '@shared/musicUtils'
import type { PlaybackController } from '../engine/audioEngine'
import { playScoreWithSampler } from '../engine/samplerEngine'
import { midiOutputEngine } from '../engine/midiOutputEngine'
import { midiService } from '../services/midiService'

let _playback: PlaybackController | null = null

// ── Types ─────────────────────────────────────────────────────────────────────

export type InputMode = 'select' | 'note' | 'rest' | 'eraser' | 'text'

export interface AppState {
  // Score data
  score: Score
  filePath: string | null
  isDirty: boolean

  // Undo / redo stacks — full snapshots (phase 1)
  undoStack: Score[]
  redoStack: Score[]

  // Editor state
  selectedNoteId: string | null       // last selected note (derived from selectedNoteIds)
  selectedNoteIds: string[]           // all selected note/chord event IDs
  selectedAnchorId: string | null     // pivot for shift+click range selection
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
  soundOnInput: boolean

  // Audio
  audioMode: 'builtin' | 'midi-out'
  midiOutputDeviceId: string | null

  // MIDI input
  midiInputDeviceId: string | null
  midiInputDeviceName: string | null

  // Playback
  isPlaying: boolean
  playbackPositionTick: number

  // Duration resize
  pendingResize: {
    noteId: string
    loc: { partId: string; staffId: string; measureId: string; voiceId: string }
    newDuration: Duration
    newDots: 0 | 1 | 2
    pitchedCount: number
  } | null
  resizeError: string | null

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
  setSelectedNotes: (ids: string[], anchorId?: string | null) => void
  addToSelection: (id: string) => void
  toggleSelectedNote: (id: string) => void
  clearSelection: () => void
  dispatchBatch: (commands: Command[]) => void
  setSelectedMeasure: (measureId: string | null) => void
  setSelectedBarline: (measureId: string | null) => void
  setPlaying: (playing: boolean) => void
  setSelectedDuration: (duration: Duration) => void
  setIsDotted: (dotted: boolean) => void
  toggleDot: () => void
  resizeNote: (newDuration: Duration, newDots?: 0 | 1 | 2) => void
  confirmResize: () => void
  cancelResize: () => void
  clearResizeError: () => void
  setPrimedAccidental: (acc: Accidental | null) => void
  setCursor: (measureId: string | null, beatPosition: number) => void
  setLastEnteredPitch: (pitch: Pitch | null) => void
  moveCursorToFirstAvailable: () => void
  checkAndAutoAddBar: () => void
  insertMeasure: () => void
  deleteMeasure: (measureId: string) => void
  toggleKeyboard: () => void
  toggleSoundOnInput: () => void
  setAudioMode: (mode: 'builtin' | 'midi-out') => void
  setMidiOutputDevice: (deviceId: string | null) => void
  setMidiInputDevice: (id: string | null, name: string | null) => void
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
    selectedNoteIds: [],
    selectedAnchorId: null,
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
    soundOnInput: false,

    audioMode: 'builtin',
    midiOutputDeviceId: null,

    midiInputDeviceId: localStorage.getItem('midiInputDeviceId') ?? null,
    midiInputDeviceName: localStorage.getItem('midiInputDeviceName') ?? null,

    isPlaying: false,
    playbackPositionTick: 0,

    pendingResize: null,
    resizeError: null,

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
        state.selectedNoteIds = []
        state.selectedAnchorId = null
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
        state.selectedNoteIds = []
        state.selectedAnchorId = null
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
    setSelectedNote: (id) => set(s => {
      s.selectedNoteId  = id
      s.selectedNoteIds = id ? [id] : []
      s.selectedAnchorId = id
    }),
    setSelectedNotes: (ids, anchorId) => set(s => {
      s.selectedNoteIds = ids
      s.selectedNoteId  = ids[ids.length - 1] ?? null
      if (anchorId !== undefined) s.selectedAnchorId = anchorId
    }),
    addToSelection: (id) => set(s => {
      if (!s.selectedNoteIds.includes(id)) {
        s.selectedNoteIds = [...s.selectedNoteIds, id]
        s.selectedNoteId  = id
        s.selectedAnchorId = id
      }
    }),
    toggleSelectedNote: (id) => set(s => {
      const idx = s.selectedNoteIds.indexOf(id)
      if (idx !== -1) {
        const next = [...s.selectedNoteIds]
        next.splice(idx, 1)
        s.selectedNoteIds = next
        s.selectedNoteId  = next[next.length - 1] ?? null
      } else {
        s.selectedNoteIds = [...s.selectedNoteIds, id]
        s.selectedNoteId  = id
        s.selectedAnchorId = id
      }
    }),
    clearSelection: () => set(s => {
      s.selectedNoteIds = []
      s.selectedNoteId  = null
      s.selectedAnchorId = null
    }),
    dispatchBatch: (commands) => {
      if (commands.length === 0) return
      set(state => {
        const prev = state.score as Score
        let s = prev
        for (const cmd of commands) s = applyCommand(s, cmd)
        state.undoStack.push(prev as any)
        if (state.undoStack.length > 100) state.undoStack.shift()
        state.redoStack = []
        state.score = s as any
        state.isDirty = true
      })
    },
    setSelectedMeasure: (id) => set(s => { s.selectedMeasureId = id }),
    setSelectedBarline: (id) => set(s => { s.selectedBarlineId = id }),
    setPlaying: (playing) => set(s => { s.isPlaying = playing }),

    startPlayback: async () => {
      if (_playback) return
      const { score, audioMode } = get()
      const onDone = () => { _playback = null; set(s => { s.isPlaying = false }) }
      if (audioMode === 'midi-out') {
        _playback = await midiOutputEngine.playScore(score, 120, onDone)
      } else {
        _playback = await playScoreWithSampler(score, 120, onDone)
      }
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
      const { score, selectedNoteIds, inputMode } = get()
      if (inputMode === 'select' && selectedNoteIds.length === 1) {
        // Single note: use resize path so surrounding notes are adjusted
        const noteId = selectedNoteIds[0]
        outer: for (const part of score.parts) {
          for (const staff of part.staves) {
            for (const measure of staff.measures) {
              for (const voice of measure.voices) {
                const ev = voice.events.find(e => e.id === noteId)
                if (ev) {
                  get().resizeNote(ev.duration, (ev.dots > 0 ? 0 : 1) as 0 | 1)
                  break outer
                }
              }
            }
          }
        }
        return
      }
      if (inputMode === 'select' && selectedNoteIds.length > 1) {
        const idSet = new Set(selectedNoteIds)
        const cmds: Command[] = []
        let newDots: 0 | 1 = 0
        for (const part of score.parts) {
          for (const staff of part.staves) {
            for (const measure of staff.measures) {
              for (const voice of measure.voices) {
                for (const event of voice.events) {
                  if (!idSet.has(event.id)) continue
                  newDots = (event.dots === 1 ? 0 : 1) as 0 | 1
                  cmds.push({
                    type:      'SET_NOTE_DURATION',
                    partId:    part.id,
                    staffId:   staff.id,
                    measureId: measure.id,
                    voiceId:   voice.id,
                    noteId:    event.id,
                    duration:  event.duration,
                    dots:      newDots,
                  })
                }
              }
            }
          }
        }
        if (cmds.length > 0) {
          get().dispatchBatch(cmds)
          set(s => { s.isDotted = newDots === 1 })
          return
        }
      }
      set(s => { s.isDotted = !s.isDotted })
    },

    resizeNote: (newDuration, newDots = 0) => {
      const { score, selectedNoteIds, inputMode } = get()
      if (inputMode !== 'select' || selectedNoteIds.length !== 1) {
        get().setSelectedDuration(newDuration)
        return
      }

      const noteId = selectedNoteIds[0]
      let loc: { partId: string; staffId: string; measureId: string; voiceId: string } | null = null
      let events: ReturnType<typeof score.parts[0]['staves'][0]['measures'][0]['voices'][0]['events']['slice']> = []
      let idx = -1

      outer: for (const part of score.parts) {
        for (const staff of part.staves) {
          for (const measure of staff.measures) {
            for (const voice of measure.voices) {
              const i = (voice.events as any[]).findIndex((e: any) => e.id === noteId)
              if (i !== -1) {
                loc = { partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id }
                events = voice.events as any
                idx = i
                break outer
              }
            }
          }
        }
      }
      if (!loc || idx === -1) return

      const event   = (events as any[])[idx]
      const oldUnits = dottedUnits(DURATION_UNITS[event.duration as Duration], event.dots)
      const newUnits = dottedUnits(DURATION_UNITS[newDuration], newDots)

      if (newUnits === oldUnits) {
        set(s => { s.selectedDuration = newDuration; s.isDotted = newDots > 0 })
        return
      }

      if (newUnits > oldUnits) {
        const need = newUnits - oldUnits
        let available = 0
        let pitchedCount = 0
        for (let j = idx + 1; j < (events as any[]).length; j++) {
          const ev = (events as any[])[j]
          available += dottedUnits(DURATION_UNITS[ev.duration as Duration], ev.dots)
          if (ev.type !== 'rest') pitchedCount++
          if (available >= need) break
        }
        if (available < need) {
          set(s => { s.resizeError = 'Not enough space in this measure' })
          return
        }
        if (pitchedCount > 0) {
          set(s => { s.pendingResize = { noteId, loc: loc!, newDuration, newDots: newDots as 0 | 1 | 2, pitchedCount } })
          return
        }
      }

      get().dispatch({ type: 'RESIZE_NOTE', ...loc, noteId, newDuration, newDots: newDots as 0 | 1 | 2 })
      set(s => { s.selectedDuration = newDuration; s.isDotted = newDots > 0 })
    },

    confirmResize: () => {
      const { pendingResize } = get()
      if (!pendingResize) return
      get().dispatch({ type: 'RESIZE_NOTE', ...pendingResize.loc, noteId: pendingResize.noteId, newDuration: pendingResize.newDuration, newDots: pendingResize.newDots })
      set(s => { s.selectedDuration = pendingResize.newDuration; s.isDotted = pendingResize.newDots > 0; s.pendingResize = null })
    },

    cancelResize: () => set(s => { s.pendingResize = null }),

    clearResizeError: () => set(s => { s.resizeError = null }),
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
    toggleSoundOnInput: () => set(s => { s.soundOnInput = !s.soundOnInput }),

    setAudioMode: (mode) => {
      set(s => { s.audioMode = mode })
      if (mode === 'builtin') midiOutputEngine.deselect()
    },

    setMidiOutputDevice: (deviceId) => {
      set(s => { s.midiOutputDeviceId = deviceId })
      if (deviceId) void midiOutputEngine.selectOutput(deviceId)
      else          midiOutputEngine.deselect()
    },

    setMidiInputDevice: (id, name) => {
      set(s => { s.midiInputDeviceId = id; s.midiInputDeviceName = name })
      midiService.selectInput(id)
      if (id)   { localStorage.setItem('midiInputDeviceId', id); localStorage.setItem('midiInputDeviceName', name ?? '') }
      else       { localStorage.removeItem('midiInputDeviceId'); localStorage.removeItem('midiInputDeviceName') }
    },

    insertMeasure: () => {
      const { score, selectedMeasureId, cursorMeasureId } = get()
      const refId = selectedMeasureId ?? cursorMeasureId
      if (!refId) return

      let afterIndex = -1
      outer: for (const part of score.parts) {
        for (const staff of part.staves) {
          const idx = staff.measures.findIndex(m => m.id === refId)
          if (idx !== -1) { afterIndex = idx; break outer }
        }
      }
      if (afterIndex === -1) return

      get().dispatch({ type: 'INSERT_MEASURE', afterMeasureIndex: afterIndex })

      // Move cursor into the new bar
      const newStaff = get().score.parts[0]?.staves[0]
      const newMeasure = newStaff?.measures[afterIndex + 1]
      if (newMeasure) {
        get().setCursor(newMeasure.id, 0)
        get().setSelectedMeasure(null)
      }
    },

    deleteMeasure: (measureId) => {
      const { score } = get()
      let measureIndex = -1
      outer: for (const part of score.parts) {
        for (const staff of part.staves) {
          const idx = staff.measures.findIndex(m => m.id === measureId)
          if (idx !== -1) { measureIndex = idx; break outer }
        }
      }
      if (measureIndex === -1) return

      // Guard: refuse to delete the only remaining bar
      const firstStaff = score.parts[0]?.staves[0]
      if (!firstStaff || firstStaff.measures.length <= 1) return

      get().dispatch({ type: 'REMOVE_MEASURE', measureIndex })

      // Move cursor to the bar that now occupies the same slot (or the one before)
      const newStaff = get().score.parts[0]?.staves[0]
      if (!newStaff) return
      const landingIndex = Math.min(measureIndex, newStaff.measures.length - 1)
      const landingMeasure = newStaff.measures[landingIndex]
      if (landingMeasure) get().setCursor(landingMeasure.id, 0)
      get().setSelectedMeasure(null)
    },

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
