// ─────────────────────────────────────────────────────────────────────────────
// Command pattern
//
// Every edit to the score is a Command object. This gives us:
//   • Undo/redo for free (maintain an undo stack of inverse commands)
//   • Serialisable edit history
//   • A single choke point for all mutations (easy to add validation/logging)
//
// If you know C#, this is the same pattern as MediatR IRequest + IRequestHandler.
// ─────────────────────────────────────────────────────────────────────────────

import { produce } from 'immer'
import type { Score, NoteEvent, Duration, ClefType, KeySignature, TimeSignature } from './score'

// ── Command discriminated union ───────────────────────────────────────────────

export type Command =
  | { type: 'ADD_NOTE';         partId: string; staffId: string; measureId: string; voiceId: string; event: NoteEvent; index?: number }
  | { type: 'DELETE_NOTE';      partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }
  | { type: 'REPLACE_NOTE';     partId: string; staffId: string; measureId: string; voiceId: string; noteId: string; event: NoteEvent }
  | { type: 'SET_NOTE_DURATION'; partId: string; staffId: string; measureId: string; voiceId: string; noteId: string; duration: Duration; dots?: 0 | 1 | 2 }
  | { type: 'ADD_MEASURE';      partId: string; staffId: string; afterMeasureId: string }
  | { type: 'DELETE_MEASURE';   partId: string; staffId: string; measureId: string }
  | { type: 'SET_CLEF';         partId: string; staffId: string; measureId: string; clef: ClefType }
  | { type: 'SET_KEY';          partId: string; staffId: string; measureId: string; key: KeySignature }
  | { type: 'SET_TIME';         partId: string; staffId: string; measureId: string; time: TimeSignature }
  | { type: 'SET_TEMPO';        measureId: string; bpm: number }
  | { type: 'SET_TITLE';        title: string }
  | { type: 'SET_COMPOSER';     composer: string }

// ── Command executor ─────────────────────────────────────────────────────────
// Applies a command to a Score and returns the new Score (immutably, via Immer).
// Think of Immer's `produce` as a C# `with` expression for deep object graphs.

export function applyCommand(score: Score, command: Command): Score {
  return produce(score, draft => {
    switch (command.type) {
      case 'ADD_NOTE': {
        const part    = draft.parts.find(p => p.id === command.partId)
        const staff   = part?.staves.find(s => s.id === command.staffId)
        const measure = staff?.measures.find(m => m.id === command.measureId)
        const voice   = measure?.voices.find(v => v.id === command.voiceId)
        if (!voice) break
        const events = voice.events as NoteEvent[]
        if (command.index !== undefined) {
          events.splice(command.index, 0, command.event)
        } else {
          events.push(command.event)
        }
        break
      }

      case 'DELETE_NOTE': {
        const part    = draft.parts.find(p => p.id === command.partId)
        const staff   = part?.staves.find(s => s.id === command.staffId)
        const measure = staff?.measures.find(m => m.id === command.measureId)
        const voice   = measure?.voices.find(v => v.id === command.voiceId)
        if (!voice) break
        const events = voice.events as NoteEvent[]
        const idx = events.findIndex(e => e.id === command.noteId)
        if (idx !== -1) events.splice(idx, 1)
        break
      }

      case 'REPLACE_NOTE': {
        const part    = draft.parts.find(p => p.id === command.partId)
        const staff   = part?.staves.find(s => s.id === command.staffId)
        const measure = staff?.measures.find(m => m.id === command.measureId)
        const voice   = measure?.voices.find(v => v.id === command.voiceId)
        if (!voice) break
        const events = voice.events as NoteEvent[]
        const idx = events.findIndex(e => e.id === command.noteId)
        if (idx !== -1) events[idx] = command.event
        break
      }

      case 'SET_NOTE_DURATION': {
        const part    = draft.parts.find(p => p.id === command.partId)
        const staff   = part?.staves.find(s => s.id === command.staffId)
        const measure = staff?.measures.find(m => m.id === command.measureId)
        const voice   = measure?.voices.find(v => v.id === command.voiceId)
        if (!voice) break
        const event = voice.events.find(e => e.id === command.noteId)
        if (event) {
          ;(event as any).duration = command.duration
          if (command.dots !== undefined) (event as any).dots = command.dots
        }
        break
      }

      case 'SET_TITLE': {
        draft.metadata.title = command.title
        draft.metadata.updatedAt = new Date().toISOString()
        break
      }

      case 'SET_COMPOSER': {
        draft.metadata.composer = command.composer
        draft.metadata.updatedAt = new Date().toISOString()
        break
      }

      case 'SET_TEMPO': {
        // Set tempo on the score root (simplification — future: per-measure map)
        draft.tempo = command.bpm
        break
      }
    }
  })
}

// ── Command bus with undo stack ───────────────────────────────────────────────

export interface CommandBusState {
  score: Score
  undoStack: Command[]
  redoStack: Command[]
}

export function executeCommand(state: CommandBusState, command: Command): CommandBusState {
  const nextScore = applyCommand(state.score, command)
  return {
    score: nextScore,
    undoStack: [...state.undoStack, command],
    redoStack: []                       // any new command clears redo stack
  }
}

// Note: true undo requires inverse commands (e.g. DELETE_NOTE inverting ADD_NOTE).
// For phase 1 scaffold we store the full score snapshots in Zustand history.
// Replace with inverse commands in phase 2 for memory efficiency.
