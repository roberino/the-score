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
import { createMeasure } from './score'
import type { Score, NoteEvent, Duration, ClefType, KeySignature, TimeSignature, BarlineType } from './score'
import { measureCapacityUnits, eventDurationUnits, resolveClef, pitchToStep, stepToPitch } from './musicUtils'

// ── Command discriminated union ───────────────────────────────────────────────

export type Command =
  | { type: 'ADD_NOTE';         partId: string; staffId: string; measureId: string; voiceId: string; event: NoteEvent; index?: number }
  | { type: 'DELETE_NOTE';      partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }
  | { type: 'REPLACE_NOTE';     partId: string; staffId: string; measureId: string; voiceId: string; noteId: string; event: NoteEvent }
  | { type: 'SET_NOTE_DURATION'; partId: string; staffId: string; measureId: string; voiceId: string; noteId: string; duration: Duration; dots?: 0 | 1 | 2 }
  | { type: 'ADD_MEASURE';      partId: string; staffId: string; afterMeasureId: string }
  | { type: 'DELETE_MEASURE';   partId: string; staffId: string; measureId: string }
  | { type: 'SET_BARLINE';      partId: string; staffId: string; measureId: string; barline: BarlineType }
  | { type: 'SET_CLEF';         partId: string; staffId: string; measureId: string; clef: ClefType }
  | { type: 'SET_KEY';          partId: string; staffId: string; measureId: string; key: KeySignature }
  | { type: 'SET_SCORE_KEY';    key: KeySignature }
  | { type: 'SET_TIME';         partId: string; staffId: string; measureId: string; time: TimeSignature }
  | { type: 'SET_SCORE_TIME';   time: TimeSignature }
  | { type: 'SET_TEMPO';        measureId: string; bpm: number }
  | { type: 'SET_TITLE';        title: string }
  | { type: 'SET_COMPOSER';     composer: string }

// ── Spill-over helper ────────────────────────────────────────────────────────
// Moves events that overflow each measure's capacity forward into the next
// measure, starting from the measure identified by startMeasureId.

function spillOverFrom(
  measures: any[],
  startMeasureId: string | undefined,
  scoreTimeSig: TimeSignature
): void {
  if (!startMeasureId) return
  const startIdx = measures.findIndex((m: any) => m.id === startMeasureId)
  if (startIdx === -1) return

  for (let i = startIdx; i < measures.length; i++) {
    const voice = measures[i].voices?.[0]
    if (!voice) continue

    // Resolve effective time sig: walk back to nearest explicit override
    let timeSig: TimeSignature = scoreTimeSig
    for (let k = i; k >= 0; k--) {
      if (measures[k].timeSignature) { timeSig = measures[k].timeSignature; break }
    }

    const capacity = measureCapacityUnits(timeSig)
    const events: NoteEvent[] = voice.events

    let used = 0
    let splitIdx = events.length
    for (let j = 0; j < events.length; j++) {
      const units = eventDurationUnits(events[j])
      if (used + units > capacity) { splitIdx = j; break }
      used += units
    }

    if (splitIdx === events.length) break  // no overflow — done

    const overflow = events.splice(splitIdx)

    // Ensure a next measure exists
    if (i + 1 >= measures.length) {
      const prevLast = measures[measures.length - 1]
      prevLast.barline = 'single'
      const newMeasure = createMeasure(prevLast.number + 1, 'final') as any
      measures.push(newMeasure)
    }

    const nextVoice = measures[i + 1].voices?.[0]
    if (nextVoice) nextVoice.events.unshift(...overflow)
  }
}

// ── Accidental stripping helper ───────────────────────────────────────────────
// When a key signature changes, remove explicit accidentals on notes that are
// now implied by the new key.

const SHARPS_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const FLATS_ORDER  = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

function stripAccidentalsFrom(
  measures: any[],
  startId: string,
  key: KeySignature
): void {
  const implied = new Map<string, 'sharp' | 'flat'>()
  if (key.fifths > 0) {
    for (let i = 0; i < Math.min(key.fifths, 7); i++) implied.set(SHARPS_ORDER[i], 'sharp')
  } else if (key.fifths < 0) {
    for (let i = 0; i < Math.min(-key.fifths, 7); i++) implied.set(FLATS_ORDER[i], 'flat')
  }
  if (implied.size === 0) return

  const startIdx = measures.findIndex((m: any) => m.id === startId)
  if (startIdx === -1) return

  for (let i = startIdx; i < measures.length; i++) {
    for (const voice of measures[i].voices ?? []) {
      for (const event of voice.events ?? []) {
        if (event.type === 'note') {
          const acc = implied.get(event.pitch.noteName)
          if (acc && event.pitch.accidental === acc) event.pitch.accidental = null
        } else if (event.type === 'chord') {
          for (const pitch of event.pitches ?? []) {
            const acc = implied.get(pitch.noteName)
            if (acc && pitch.accidental === acc) pitch.accidental = null
          }
        }
      }
    }
  }
}

// ── Clef re-pitch helper ─────────────────────────────────────────────────────
// When the clef changes at measure fromIdx, notes in all affected measures are
// re-pitched so they stay at the same visual staff position (step) but sound the
// new pitch implied by the new clef. Stops at the next explicit measure.clef.

function repitchNotes(
  measures: any[],
  fromIdx: number,
  oldClef: ClefType,
  newClef: ClefType
): void {
  for (let i = fromIdx; i < measures.length; i++) {
    if (i > fromIdx && measures[i].clef) break  // next explicit clef change — stop
    for (const voice of measures[i].voices ?? []) {
      for (const event of voice.events ?? []) {
        if (event.type === 'note') {
          const step = pitchToStep(event.pitch, oldClef)
          const { noteName, octave } = stepToPitch(step, newClef)
          event.pitch.noteName = noteName
          event.pitch.octave   = octave
        } else if (event.type === 'chord') {
          for (const pitch of event.pitches ?? []) {
            const step = pitchToStep(pitch, oldClef)
            const { noteName, octave } = stepToPitch(step, newClef)
            pitch.noteName = noteName
            pitch.octave   = octave
          }
        }
      }
    }
  }
}

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

      case 'ADD_MEASURE': {
        const part  = draft.parts.find(p => p.id === command.partId)
        const staff = part?.staves.find(s => s.id === command.staffId)
        if (!staff) break
        const measures = staff.measures as typeof staff.measures extends readonly (infer T)[] ? T[] : never[]
        const afterIdx = measures.findIndex(m => m.id === command.afterMeasureId)
        if (afterIdx === -1) break
        const newNumber = measures[afterIdx].number + 1
        const newMeasure = createMeasure(newNumber, 'single')
        // Renumber all measures after insertion point
        measures.splice(afterIdx + 1, 0, newMeasure as any)
        for (let i = afterIdx + 2; i < measures.length; i++) {
          ;(measures[i] as any).number = i + 1
        }
        break
      }

      case 'SET_CLEF': {
        const part  = draft.parts.find(p => p.id === command.partId)
        const staff = part?.staves.find(s => s.id === command.staffId)
        if (!staff) break
        const mIdx = (staff.measures as any[]).findIndex(m => m.id === command.measureId)
        if (mIdx === -1) break

        const oldClef = resolveClef(staff.measures as any[], mIdx, staff.clef as ClefType)
        const newClef = command.clef

        if (mIdx === 0) {
          // Change the staff-level default; first measure carries no per-measure override
          ;(staff as any).clef = command.clef
          delete (staff.measures[0] as any).clef
        } else {
          ;(staff.measures[mIdx] as any).clef = { type: command.clef }
        }

        if (oldClef !== newClef) {
          repitchNotes(staff.measures as any[], mIdx, oldClef, newClef)
        }
        break
      }

      case 'SET_BARLINE': {
        const part    = draft.parts.find(p => p.id === command.partId)
        const staff   = part?.staves.find(s => s.id === command.staffId)
        const measure = staff?.measures.find(m => m.id === command.measureId)
        if (!measure) break
        // Guard: never override the final barline of the last measure via this command
        const isLast = staff!.measures[staff!.measures.length - 1].id === command.measureId
        if (isLast && command.barline !== 'final') break
        ;(measure as any).barline = command.barline
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

      case 'SET_KEY': {
        const part  = draft.parts.find(p => p.id === command.partId)
        const staff = part?.staves.find(s => s.id === command.staffId)
        if (!staff) break
        const measure = (staff.measures as any[]).find(m => m.id === command.measureId)
        if (!measure) break
        measure.keySignature = command.key
        stripAccidentalsFrom(staff.measures as any[], command.measureId, command.key)
        break
      }

      case 'SET_SCORE_KEY': {
        draft.keySignature = command.key as any
        for (const part of draft.parts) {
          for (const staff of part.staves) {
            const firstId = (staff.measures as any[])[0]?.id
            if (firstId) stripAccidentalsFrom(staff.measures as any[], firstId, command.key)
          }
        }
        break
      }

      case 'SET_TIME': {
        const part  = draft.parts.find(p => p.id === command.partId)
        const staff = part?.staves.find(s => s.id === command.staffId)
        if (!staff) break
        const measure = (staff.measures as any[]).find(m => m.id === command.measureId)
        if (!measure) break
        measure.timeSignature = command.time
        spillOverFrom(staff.measures as any[], command.measureId, draft.timeSignature as TimeSignature)
        break
      }

      case 'SET_SCORE_TIME': {
        draft.timeSignature = command.time as any
        for (const part of draft.parts) {
          for (const staff of part.staves) {
            spillOverFrom(staff.measures as any[], (staff.measures as any[])[0]?.id, command.time)
          }
        }
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
