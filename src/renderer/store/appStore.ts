import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createScore, type Score, type Pitch, type Duration, type Accidental, type HairpinType, type Hairpin, type DynamicLevel, type Volta } from '@shared/score'
import { v4 as uuid } from 'uuid'
import { applyCommand, type Command } from '@shared/commands'
import { measureCapacityUnits, resolveTimeSig, dottedUnits, DURATION_UNITS, buildPlaybackSequence, buildMeasureTimeline, firstRestBeat, fillWithRests, eventDurationUnits } from '@shared/musicUtils'
import { produce } from 'immer'
import type { PlaybackController } from '../engine/audioEngine'
import { playScoreWithSampler } from '../engine/samplerEngine'
import { midiOutputEngine } from '../engine/midiOutputEngine'
import { midiService } from '../services/midiService'

let _playback: PlaybackController | null = null
const _initialScore = createScore()

// Ensures every voice[0] in every measure has stored rests filling it to capacity.
// Applied when loading existing scores that predate the stored-rests model.
function normalizeMeasureRests(score: Score): Score {
  return produce(score, draft => {
    for (const part of draft.parts) {
      for (const staff of part.staves) {
        for (let i = 0; i < staff.measures.length; i++) {
          const measure = staff.measures[i]
          const voice0 = measure.voices[0] as any
          if (!voice0 || voice0.events.length > 0) continue
          const timeSig = resolveTimeSig(staff.measures as any, i, draft.timeSignature)
          voice0.events = fillWithRests(measureCapacityUnits(timeSig))
        }
      }
    }
  })
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type InputMode = 'select' | 'note' | 'rest' | 'text' | 'lyric' | 'midi'

export interface BarSelection {
  startMeasureIndex: number
  endMeasureIndex: number
  partIds: string[] | null  // null = all parts
}

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
  selectedChordPitchIndex: number | null  // non-null = individual pitch within selectedNoteId's chord
  selectedMeasureId: string | null
  selectedBarlineId: string | null   // measure ID whose right barline is selected
  barSelection: BarSelection | null
  inputMode: InputMode
  zoom: number

  // Note input state
  selectedDuration: Duration
  isDotted: boolean
  primedAccidental: Accidental | null
  activeVoice: 0 | 1
  lyricCursorNoteId: string | null
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
  playbackManualStop: boolean      // true when user manually stopped; false on natural end
  playbackResumePositionSec: number // transport seconds to resume from (0 = beginning)
  playbackPositionTick: number
  playbackMode: 'beginning' | 'from-cursor'

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
  setPlaybackMode: (mode: 'beginning' | 'from-cursor') => void
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
  setSelectedChordPitch: (pitchIndex: number | null) => void
  setBarSelection: (sel: BarSelection | null) => void
  deleteSelectedBars: () => void
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
  setActiveVoice: (voice: 0 | 1) => void
  setLyricCursor: (noteId: string | null) => void
  setCursor: (measureId: string | null, beatPosition: number) => void
  setLastEnteredPitch: (pitch: Pitch | null) => void
  moveCursorToFirstAvailable: () => void
  checkAndAutoAddBar: () => void
  insertMeasure: () => void
  deleteMeasure: (measureId: string) => void
  addHairpin: (hairpinType: HairpinType) => void
  removeHairpin: (partId: string, staffId: string, hairpinId: string) => void
  applyTuplet: (actual: 3 | 5 | 6, normal: 2 | 4) => void
  setNoteDynamic: (noteId: string, dynamic: DynamicLevel | undefined) => void
  addVolta: (volta: Omit<Volta, 'id'>) => void
  removeVolta: (voltaId: string) => void
  toggleKeyboard: () => void
  toggleSoundOnInput: () => void
  setAudioMode: (mode: 'builtin' | 'midi-out') => void
  setMidiOutputDevice: (deviceId: string | null) => void
  setMidiInputDevice: (id: string | null, name: string | null) => void
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>()(
  immer((set, get) => ({
    score: _initialScore,
    filePath: null,
    isDirty: false,
    undoStack: [],
    redoStack: [],
    selectedNoteId: null,
    selectedNoteIds: [],
    selectedAnchorId: null,
    selectedChordPitchIndex: null,
    selectedMeasureId: null,
    selectedBarlineId: null,
    barSelection: null,
    inputMode: 'note',
    zoom: 1.0,

    selectedDuration: 'quarter',
    isDotted: false,
    primedAccidental: null,
    activeVoice: 0,
    lyricCursorNoteId: null,
    cursorMeasureId: (_initialScore.parts[0]?.staves[0]?.measures[0]?.id as string | undefined) ?? null,
    cursorBeatPosition: 0,
    lastEnteredPitch: null,

    keyboardVisible: false,
    soundOnInput: true,

    audioMode: 'builtin',
    midiOutputDeviceId: null,

    midiInputDeviceId: localStorage.getItem('midiInputDeviceId') ?? null,
    midiInputDeviceName: localStorage.getItem('midiInputDeviceName') ?? null,

    isPlaying: false,
    playbackManualStop: false,
    playbackResumePositionSec: 0,
    playbackPositionTick: 0,
    playbackMode: 'beginning',

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
      const freshScore = createScore()
      set(state => {
        state.score = freshScore as any
        state.filePath = null
        state.isDirty = false
        state.undoStack = []
        state.redoStack = []
        state.cursorMeasureId = (freshScore.parts[0]?.staves[0]?.measures[0]?.id as string | undefined) ?? null
        state.cursorBeatPosition = 0
        state.lastEnteredPitch = null
        state.selectedNoteId = null
        state.selectedNoteIds = []
        state.selectedAnchorId = null
        state.selectedBarlineId = null
        state.barSelection = null
        state.isPlaying = false
      })
      void window.electronAPI.setWindowTitle('Untitled — Volta', null)
    },

    loadScore: (score: Score, path: string) => {
      _playback?.stop(); _playback = null
      set(state => {
        // Normalise fields added after the initial file format
        const normalizedScore = normalizeMeasureRests({ ...score, textBoxes: score.textBoxes ?? [] })
        state.score = normalizedScore as any
        state.filePath = path
        state.isDirty = false
        state.undoStack = []
        state.redoStack = []
        state.cursorMeasureId = (normalizedScore.parts[0]?.staves[0]?.measures[0]?.id as string | undefined) ?? null
        state.cursorBeatPosition = 0
        state.lastEnteredPitch = null
        state.selectedNoteId = null
        state.selectedNoteIds = []
        state.selectedAnchorId = null
        state.selectedBarlineId = null
        state.barSelection = null
        state.isPlaying = false
      })
      const fileName = path.split(/[/\\]/).pop() ?? 'Untitled'
      void window.electronAPI.setWindowTitle(`${fileName} — Volta`, path)
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
        const fileName = result.path.split(/[/\\]/).pop() ?? 'Untitled'
        void window.electronAPI.setWindowTitle(`${fileName} — Volta`, result.path)
      }
    },

    setInputMode: (mode) => {
      set(s => {
        s.inputMode = mode
        s.primedAccidental = null
        s.selectedBarlineId = null
        if (mode !== 'lyric') {
          s.lyricCursorNoteId = null
        }
      })
      // Recover cursor if somehow lost
      if (!get().cursorMeasureId) get().moveCursorToFirstAvailable()
      if (mode === 'lyric') {
        const { score, selectedNoteId } = get()
        // Start at the currently selected note if it's pitched
        if (selectedNoteId) {
          for (const part of score.parts) {
            for (const staff of part.staves) {
              for (const measure of staff.measures) {
                for (const voice of measure.voices) {
                  const ev = voice.events.find(e => e.id === selectedNoteId)
                  if (ev && ev.type !== 'rest') {
                    set(s => { s.lyricCursorNoteId = selectedNoteId })
                    return
                  }
                }
              }
            }
          }
        }
        // Fall back to first pitched event in voice 0 of first part
        const firstId = (() => {
          for (const part of score.parts) {
            for (const staff of part.staves) {
              for (const measure of staff.measures) {
                const ev = measure.voices[0]?.events.find(e => e.type !== 'rest')
                if (ev) return ev.id
              }
            }
            break
          }
          return null
        })()
        if (firstId) set(s => { s.lyricCursorNoteId = firstId })
      }
    },

    setLyricCursor: (noteId) => set(s => { s.lyricCursorNoteId = noteId }),

    setZoom: (zoom) => set(s => { s.zoom = Math.max(0.25, Math.min(4, zoom)) }),
    setSelectedNote: (id) => set(s => {
      s.selectedNoteId  = id
      s.selectedNoteIds = id ? [id] : []
      s.selectedAnchorId = id
      s.selectedChordPitchIndex = null
      s.barSelection = null
    }),
    setSelectedNotes: (ids, anchorId) => set(s => {
      s.selectedNoteIds = ids
      s.selectedNoteId  = ids[ids.length - 1] ?? null
      if (anchorId !== undefined) s.selectedAnchorId = anchorId
      s.barSelection = null
    }),
    addToSelection: (id) => set(s => {
      if (!s.selectedNoteIds.includes(id)) {
        s.selectedNoteIds = [...s.selectedNoteIds, id]
        s.selectedNoteId  = id
        s.selectedAnchorId = id
        s.barSelection = null
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
      s.barSelection = null
    }),
    clearSelection: () => set(s => {
      s.selectedNoteIds = []
      s.selectedNoteId  = null
      s.selectedAnchorId = null
      s.selectedChordPitchIndex = null
      s.barSelection = null
    }),
    setSelectedChordPitch: (pitchIndex) => set(s => { s.selectedChordPitchIndex = pitchIndex }),
    setBarSelection: (sel) => set(s => {
      s.barSelection = sel as any
      if (sel) {
        s.selectedNoteIds = []
        s.selectedNoteId  = null
        s.selectedAnchorId = null
        s.selectedChordPitchIndex = null
      }
    }),
    deleteSelectedBars: () => {
      const { score, barSelection } = get()
      if (!barSelection) return
      const { startMeasureIndex, endMeasureIndex, partIds } = barSelection
      const partSet = partIds ? new Set(partIds) : null
      const targets: { partId: string; staffId: string; measureId: string }[] = []
      for (const part of score.parts) {
        if (partSet && !partSet.has(part.id)) continue
        for (const staff of part.staves) {
          for (let i = startMeasureIndex; i <= endMeasureIndex; i++) {
            const measure = (staff.measures as any[])[i]
            if (measure) targets.push({ partId: part.id, staffId: staff.id, measureId: measure.id })
          }
        }
      }
      if (targets.length > 0) get().dispatch({ type: 'CLEAR_MEASURES', targets })
    },
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
      if (commands.some(c => c.type === 'ADD_NOTE')) {
        get().checkAndAutoAddBar()
      }
    },
    setSelectedMeasure: (id) => set(s => { s.selectedMeasureId = id }),
    setSelectedBarline: (id) => set(s => { s.selectedBarlineId = id }),
    setPlaying: (playing) => set(s => { s.isPlaying = playing }),

    startPlayback: async () => {
      if (_playback) return
      const { score, audioMode, playbackMode, cursorMeasureId, cursorBeatPosition } = get()

      let resumeFrom = 0
      if (playbackMode === 'from-cursor' && cursorMeasureId) {
        const tempoStaff = score.parts[0]?.staves[0]
        if (tempoStaff) {
          const sequence = buildPlaybackSequence(tempoStaff.measures, score.voltas ?? [])
          const timeline = buildMeasureTimeline(tempoStaff, sequence, tempoStaff, score.tempo ?? 120, score.timeSignature)
          // Cursor can be on any part's staff, so search all staves for the measure index
          let mIdx = -1
          outer: for (const part of score.parts) {
            for (const staff of part.staves) {
              const idx = staff.measures.findIndex(m => m.id === cursorMeasureId)
              if (idx !== -1) { mIdx = idx; break outer }
            }
          }
          if (mIdx !== -1) {
            const entry = timeline.find(e => e.mIdx === mIdx)
            if (entry) {
              const timeSig = resolveTimeSig(tempoStaff.measures, mIdx, score.timeSignature)
              const capacity = measureCapacityUnits(timeSig)
              const fraction = capacity > 0 ? cursorBeatPosition / capacity : 0
              resumeFrom = entry.startSec + fraction * entry.durationSec
            }
          }
        }
      } else if (playbackMode === 'beginning') {
        resumeFrom = 0
        // Reset cursor to start of score
        const firstMeasureId = (score.parts[0]?.staves[0]?.measures[0]?.id as string | undefined) ?? null
        if (firstMeasureId) set(s => { s.cursorMeasureId = firstMeasureId; s.cursorBeatPosition = 0 })
      }

      const onDone = () => {
        _playback = null
        set(s => { s.isPlaying = false; s.playbackManualStop = false; s.playbackResumePositionSec = 0 })
      }
      const getPartVolume = (partId: string) => get().score.parts.find(p => p.id === partId)?.volume ?? 1
      const isPartMuted   = (partId: string) => get().score.parts.find(p => p.id === partId)?.muted ?? false
      if (audioMode === 'midi-out') {
        _playback = await midiOutputEngine.playScore(score, 120, onDone, resumeFrom, getPartVolume, isPartMuted)
      } else {
        _playback = await playScoreWithSampler(score, 120, onDone, resumeFrom, getPartVolume, isPartMuted)
      }
      set(s => { s.isPlaying = true; s.playbackManualStop = false; s.playbackResumePositionSec = resumeFrom })
    },

    stopPlayback: () => {
      const pos = _playback?.getPositionSec() ?? 0
      _playback?.stop()
      _playback = null

      // Convert stopped time position back to {measureId, beatPosition}
      const { score } = get()
      let newCursorMeasureId: string | null = null
      let newCursorBeatPosition = 0
      const tempoStaff = score.parts[0]?.staves[0]
      if (tempoStaff && pos >= 0) {
        const sequence = buildPlaybackSequence(tempoStaff.measures, score.voltas ?? [])
        const timeline = buildMeasureTimeline(tempoStaff, sequence, tempoStaff, score.tempo ?? 120, score.timeSignature)
        let entry = timeline.length > 0 ? timeline[timeline.length - 1] : null
        for (const e of timeline) {
          if (pos < e.startSec + e.durationSec) { entry = e; break }
        }
        if (entry) {
          const measure = tempoStaff.measures[entry.mIdx]
          if (measure) {
            newCursorMeasureId = measure.id
            const timeSig = resolveTimeSig(tempoStaff.measures, entry.mIdx, score.timeSignature)
            const capacity = measureCapacityUnits(timeSig)
            const fraction = entry.durationSec > 0
              ? Math.max(0, Math.min(1, (pos - entry.startSec) / entry.durationSec))
              : 0
            const rawBeat = Math.floor(fraction * capacity)
            // Snap rawBeat to the start of whichever event contains it
            let acc = 0
            newCursorBeatPosition = 0
            for (const ev of (measure.voices[0]?.events ?? [])) {
              const evUnits = eventDurationUnits(ev)
              if (rawBeat >= acc && rawBeat < acc + evUnits) { newCursorBeatPosition = acc; break }
              acc += evUnits
            }
          }
        }
      }

      set(s => {
        s.isPlaying = false
        s.playbackManualStop = true
        s.playbackResumePositionSec = pos
        if (newCursorMeasureId) {
          s.cursorMeasureId = newCursorMeasureId
          s.cursorBeatPosition = newCursorBeatPosition
        }
      })
    },
    setPlaybackMode: (mode: 'beginning' | 'from-cursor') => set(s => { s.playbackMode = mode }),

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
    setActiveVoice: (voice) => {
      set(s => { s.activeVoice = voice })
      const { inputMode } = get()
      if (inputMode === 'note' || inputMode === 'rest') get().moveCursorToFirstAvailable()
    },
    setCursor: (measureId, beatPosition) => set(s => {
      s.cursorMeasureId = measureId
      s.cursorBeatPosition = beatPosition
    }),
    setLastEnteredPitch: (pitch) => set(s => { s.lastEnteredPitch = pitch as any }),

    moveCursorToFirstAvailable: () => {
      set(state => {
        const score = state.score
        const av = state.activeVoice
        for (const part of score.parts) {
          for (const staff of part.staves) {
            for (let i = 0; i < staff.measures.length; i++) {
              const measure = staff.measures[i]
              const voice = measure.voices[av] ?? measure.voices[0]
              const timeSig = resolveTimeSig(staff.measures, i, score.timeSignature)
              const capacity = measureCapacityUnits(timeSig)
              const freeAt = firstRestBeat(voice?.events ?? [])
              if (freeAt < capacity) {
                state.cursorMeasureId = measure.id
                state.cursorBeatPosition = freeAt
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

    addHairpin: (hairpinType) => {
      const { score, selectedNoteIds } = get()
      if (selectedNoteIds.length < 2) return
      const selectedSet = new Set(selectedNoteIds)

      for (const part of score.parts) {
        for (const staff of part.staves) {
          const ordered: string[] = []
          for (const measure of staff.measures) {
            for (const event of measure.voices[0]?.events ?? []) {
              if (selectedSet.has(event.id)) ordered.push(event.id)
            }
          }
          if (ordered.length < 2) continue
          const hairpin: Hairpin = {
            id: uuid(),
            type: hairpinType,
            fromNoteId: ordered[0],
            toNoteId:   ordered[ordered.length - 1],
          }
          get().dispatch({ type: 'ADD_HAIRPIN', partId: part.id, staffId: staff.id, hairpin })
          return
        }
      }
    },

    removeHairpin: (partId, staffId, hairpinId) => {
      get().dispatch({ type: 'REMOVE_HAIRPIN', partId, staffId, hairpinId })
    },

    applyTuplet: (actual, normal) => {
      const { score, selectedNoteIds } = get()
      if (selectedNoteIds.length !== actual) return
      const selectedSet = new Set(selectedNoteIds)
      const targets: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[] = []
      for (const part of score.parts) {
        for (const staff of part.staves) {
          for (const measure of staff.measures) {
            for (const voice of measure.voices) {
              for (const event of voice.events) {
                if (selectedSet.has(event.id)) {
                  targets.push({ partId: part.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id, noteId: event.id })
                }
              }
            }
          }
        }
      }
      if (targets.length === actual) {
        get().dispatch({ type: 'APPLY_TUPLET', targets, actual, normal })
      }
    },

    setNoteDynamic: (noteId, dynamic) => {
      get().dispatch({ type: 'SET_NOTE_DYNAMIC', noteId, dynamic })
    },

    addVolta: (volta) => {
      get().dispatch({ type: 'ADD_VOLTA', volta: { id: uuid(), ...volta } })
    },

    removeVolta: (voltaId) => {
      get().dispatch({ type: 'REMOVE_VOLTA', voltaId })
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
      const hasRests = voice?.events.some(e => e.type === 'rest') ?? true
      if (hasRests) return

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
