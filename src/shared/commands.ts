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
import { v4 as uuid } from 'uuid'
import { createMeasure, createStaff } from './score'
import type { Score, NoteEvent, Note, Duration, ClefType, KeySignature, TimeSignature, BarlineType, Directive, Slur, Articulation, TextBox, Hairpin } from './score'
import { measureCapacityUnits, eventDurationUnits, dottedUnits, DURATION_UNITS, resolveClef, pitchToStep, stepToPitch, shiftPitchBySemitones } from './musicUtils'

// ── Command discriminated union ───────────────────────────────────────────────

export type Command =
  | { type: 'ADD_NOTE';         partId: string; staffId: string; measureId: string; voiceId: string; event: NoteEvent; index?: number }
  | { type: 'DELETE_NOTE';      partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }
  | { type: 'REPLACE_NOTE';     partId: string; staffId: string; measureId: string; voiceId: string; noteId: string; event: NoteEvent }
  | { type: 'SET_NOTE_DURATION'; partId: string; staffId: string; measureId: string; voiceId: string; noteId: string; duration: Duration; dots?: 0 | 1 | 2 }
  | { type: 'ADD_MEASURE';      partId: string; staffId: string; afterMeasureId: string }
  | { type: 'INSERT_MEASURE';   afterMeasureIndex: number }
  | { type: 'REMOVE_MEASURE';   measureIndex: number }
  | { type: 'DELETE_MEASURE';   partId: string; staffId: string; measureId: string }
  | { type: 'SET_BARLINE';      partId: string; staffId: string; measureId: string; barline: BarlineType }
  | { type: 'SET_CLEF';         partId: string; staffId: string; measureId: string; clef: ClefType }
  | { type: 'SET_KEY';          partId: string; staffId: string; measureId: string; key: KeySignature }
  | { type: 'SET_SCORE_KEY';    key: KeySignature }
  | { type: 'CLEAR_KEY';        partId: string; staffId: string; measureId: string }
  | { type: 'SET_TIME';         partId: string; staffId: string; measureId: string; time: TimeSignature }
  | { type: 'SET_SCORE_TIME';   time: TimeSignature }
  | { type: 'CLEAR_TIME';       partId: string; staffId: string; measureId: string }
  | { type: 'SET_TEMPO';            measureId: string; bpm: number }
  | { type: 'SET_TITLE';            title: string }
  | { type: 'SET_COMPOSER';         composer: string }
  | { type: 'SET_HEADING';          field: 'title' | 'subtitle' | 'composer' | 'arranger'; value: string }
  | { type: 'ADD_PART';             name: string; shortName: string; clef: ClefType; midiProgram: number; transposeSemitones: number; midiChannel?: number }
  | { type: 'DELETE_PART';          partId: string }
  | { type: 'MOVE_PART';            partId: string; direction: 'up' | 'down' }
  | { type: 'SET_PART_METADATA';    partId: string; name?: string; shortName?: string; midiProgram?: number; midiChannel?: number | null; transposeSemitones?: number; labelVisible?: boolean }
  | { type: 'SET_SCORE_SHOW_LABELS'; visible: boolean }
  | { type: 'ADD_DIRECTIVE';         partId: string; staffId: string; measureId: string; directive: Directive }
  | { type: 'REMOVE_DIRECTIVE';      partId: string; staffId: string; measureId: string; directiveId: string }
  | { type: 'TOGGLE_TIE';            partId: string; staffId: string; noteId: string }
  | { type: 'ADD_SLUR';              partId: string; staffId: string; slur: Slur }
  | { type: 'REMOVE_SLUR';           partId: string; staffId: string; slurId: string }
  | { type: 'SET_ARTICULATION';      targets: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[]; articulation: Articulation; on: boolean }
  | { type: 'MOVE_NOTES_STEP';       moves: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[]; direction: 'up' | 'down' }
  | { type: 'TRANSPOSE_NOTES';       moves: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[]; semitones: number }
  | { type: 'DELETE_NOTES';          deletions: { partId: string; staffId: string; measureId: string; voiceId: string; noteId: string }[] }
  | { type: 'RESIZE_NOTE';           partId: string; staffId: string; measureId: string; voiceId: string; noteId: string; newDuration: Duration; newDots: 0 | 1 | 2 }
  | { type: 'ADD_TEXT_BOX';          box: TextBox }
  | { type: 'UPDATE_TEXT_BOX';       id: string; html?: string; x?: number; y?: number; width?: number }
  | { type: 'DELETE_TEXT_BOX';       id: string }
  | { type: 'ADD_HAIRPIN';           partId: string; staffId: string; hairpin: Hairpin }
  | { type: 'REMOVE_HAIRPIN';        partId: string; staffId: string; hairpinId: string }

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

// ── fillWithRests ─────────────────────────────────────────────────────────────
// Converts a duration in 64th-note units into the minimal list of rests that
// cover it exactly, using a greedy largest-first algorithm.

const FILL_REST_TABLE: { units: number; duration: Duration; dots: 0 | 1 | 2 }[] = [
  { units: 64, duration: 'whole',   dots: 0 },
  { units: 48, duration: 'half',    dots: 1 },
  { units: 32, duration: 'half',    dots: 0 },
  { units: 24, duration: 'quarter', dots: 1 },
  { units: 16, duration: 'quarter', dots: 0 },
  { units: 12, duration: 'eighth',  dots: 1 },
  { units:  8, duration: 'eighth',  dots: 0 },
  { units:  6, duration: '16th',    dots: 1 },
  { units:  4, duration: '16th',    dots: 0 },
  { units:  3, duration: '32nd',    dots: 1 },
  { units:  2, duration: '32nd',    dots: 0 },
  { units:  1, duration: '64th',    dots: 0 },
]

function fillWithRests(units: number): NoteEvent[] {
  const result: NoteEvent[] = []
  let remaining = units
  for (const row of FILL_REST_TABLE) {
    while (remaining >= row.units) {
      result.push({ id: uuid(), type: 'rest', duration: row.duration, dots: row.dots } as NoteEvent)
      remaining -= row.units
    }
  }
  return result
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
        if (idx === -1) break
        const deleted = events[idx]
        // Clear tie on predecessor if this was a tieEnd
        if (deleted.type === 'note' && (deleted as Note).tieEnd && idx > 0) {
          const prev = events[idx - 1]
          if (prev.type === 'note') (prev as any).tieStart = false
        }
        // Clear tie on successor if this was a tieStart
        if (deleted.type === 'note' && (deleted as Note).tieStart && idx + 1 < events.length) {
          const next = events[idx + 1]
          if (next.type === 'note') (next as any).tieEnd = false
        }
        events.splice(idx, 1)
        // Remove any slurs that reference this note
        if ((staff as any).slurs) {
          ;(staff as any).slurs = (staff as any).slurs.filter(
            (sl: any) => sl.fromNoteId !== command.noteId && sl.toNoteId !== command.noteId
          )
        }
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

      case 'INSERT_MEASURE': {
        const { afterMeasureIndex } = command
        for (const part of draft.parts) {
          for (const staff of part.staves) {
            const measures = staff.measures as any[]
            if (afterMeasureIndex < 0 || afterMeasureIndex >= measures.length) continue
            const isLast = afterMeasureIndex === measures.length - 1
            // If inserting at the end, demote the current final barline first
            if (isLast) measures[afterMeasureIndex].barline = 'single'
            const newMeasure = createMeasure(
              measures[afterMeasureIndex].number + 1,
              isLast ? 'final' : 'single',
            )
            measures.splice(afterMeasureIndex + 1, 0, newMeasure)
            for (let i = afterMeasureIndex + 2; i < measures.length; i++) {
              measures[i].number = i + 1
            }
          }
        }
        break
      }

      case 'REMOVE_MEASURE': {
        const { measureIndex } = command
        for (const part of draft.parts) {
          for (const staff of part.staves) {
            const measures = staff.measures as any[]
            if (measures.length <= 1) continue  // never remove the last bar
            if (measureIndex < 0 || measureIndex >= measures.length) continue
            const wasLast = measureIndex === measures.length - 1
            measures.splice(measureIndex, 1)
            // If the deleted bar was last, promote the new last bar to 'final'
            if (wasLast) measures[measures.length - 1].barline = 'final'
            // Renumber from the deletion point onward
            for (let i = measureIndex; i < measures.length; i++) {
              measures[i].number = i + 1
            }
          }
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

      case 'SET_HEADING': {
        switch (command.field) {
          case 'title':    draft.metadata.title    = command.value; break
          case 'subtitle': draft.metadata.subtitle = command.value; break
          case 'composer': draft.metadata.composer = command.value; break
          case 'arranger': draft.metadata.arranger = command.value; break
        }
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

      case 'CLEAR_KEY': {
        const part  = draft.parts.find(p => p.id === command.partId)
        const staff = part?.staves.find(s => s.id === command.staffId)
        if (!staff) break
        const measures = staff.measures as any[]
        const mIdx = measures.findIndex(m => m.id === command.measureId)
        if (mIdx === -1) break
        delete measures[mIdx].keySignature
        // Determine the key now inherited at this measure and strip implied accidentals forward
        let inheritedKey: KeySignature = draft.keySignature as KeySignature
        for (let k = mIdx - 1; k >= 0; k--) {
          if (measures[k].keySignature) { inheritedKey = measures[k].keySignature; break }
        }
        stripAccidentalsFrom(measures, command.measureId, inheritedKey)
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

      case 'CLEAR_TIME': {
        const part  = draft.parts.find(p => p.id === command.partId)
        const staff = part?.staves.find(s => s.id === command.staffId)
        if (!staff) break
        const measures = staff.measures as any[]
        const measure = measures.find(m => m.id === command.measureId)
        if (!measure) break
        delete measure.timeSignature
        spillOverFrom(measures, command.measureId, draft.timeSignature as TimeSignature)
        break
      }

      case 'SET_TEMPO': {
        // Set tempo on the score root (simplification — future: per-measure map)
        draft.tempo = command.bpm
        break
      }

      case 'ADD_PART': {
        const measureCount = (draft.parts[0]?.staves[0]?.measures as any[])?.length ?? 8
        const staff = createStaff(command.clef, measureCount)
        const defaultChannel = Math.min(draft.parts.length + 1, 16)
        const newPart = {
          id: uuid(),
          name:               command.name,
          shortName:          command.shortName,
          midiProgram:        command.midiProgram,
          midiChannel:        command.midiChannel ?? defaultChannel,
          transposeSemitones: command.transposeSemitones,
          staves:             [staff],
          volume:             0.8,
          muted:              false,
          labelVisible:       true,
        }
        ;(draft.parts as any[]).push(newPart)
        break
      }

      case 'DELETE_PART': {
        if (draft.parts.length <= 1) break  // always keep at least 1
        const idx = (draft.parts as any[]).findIndex((p: any) => p.id === command.partId)
        if (idx !== -1) (draft.parts as any[]).splice(idx, 1)
        break
      }

      case 'MOVE_PART': {
        const parts = draft.parts as any[]
        const idx = parts.findIndex((p: any) => p.id === command.partId)
        if (idx === -1) break
        const swapIdx = command.direction === 'up' ? idx - 1 : idx + 1
        if (swapIdx < 0 || swapIdx >= parts.length) break
        ;[parts[idx], parts[swapIdx]] = [parts[swapIdx], parts[idx]]
        break
      }

      case 'SET_PART_METADATA': {
        const part = (draft.parts as any[]).find((p: any) => p.id === command.partId)
        if (!part) break
        if (command.name               !== undefined) part.name               = command.name
        if (command.shortName          !== undefined) part.shortName          = command.shortName
        if (command.midiProgram        !== undefined) part.midiProgram        = command.midiProgram
        if (command.midiChannel        !== undefined) {
          if (command.midiChannel === null) delete part.midiChannel
          else part.midiChannel = command.midiChannel
        }
        if (command.transposeSemitones !== undefined) part.transposeSemitones = command.transposeSemitones
        if (command.labelVisible       !== undefined) part.labelVisible       = command.labelVisible
        break
      }

      case 'SET_SCORE_SHOW_LABELS': {
        ;(draft as any).showPartLabels = command.visible
        break
      }

      case 'ADD_DIRECTIVE': {
        const part    = draft.parts.find(p => p.id === command.partId)
        const staff   = part?.staves.find(s => s.id === command.staffId)
        const measure = staff?.measures.find(m => m.id === command.measureId) as any
        if (!measure) break
        if (!measure.directives) measure.directives = []
        measure.directives.push(command.directive)
        break
      }

      case 'REMOVE_DIRECTIVE': {
        const part    = draft.parts.find(p => p.id === command.partId)
        const staff   = part?.staves.find(s => s.id === command.staffId)
        const measure = staff?.measures.find(m => m.id === command.measureId) as any
        if (!measure?.directives) break
        const idx = measure.directives.findIndex((d: any) => d.id === command.directiveId)
        if (idx !== -1) measure.directives.splice(idx, 1)
        break
      }

      case 'TOGGLE_TIE': {
        const part  = draft.parts.find(p => p.id === command.partId)
        const staff = part?.staves.find(s => s.id === command.staffId)
        if (!staff) break
        let found = false
        for (let mIdx = 0; mIdx < staff.measures.length && !found; mIdx++) {
          const measure = staff.measures[mIdx] as any
          for (const voice of measure.voices ?? []) {
            const eIdx = (voice.events as any[]).findIndex((e: any) => e.id === command.noteId)
            if (eIdx === -1) continue
            const note = voice.events[eIdx] as any
            if (note.type !== 'note') break
            // Find the next note: remainder of this measure, then first of next measure
            let nextNote: any = null
            for (let j = eIdx + 1; j < voice.events.length; j++) {
              if (voice.events[j].type === 'note') { nextNote = voice.events[j]; break }
            }
            if (!nextNote && mIdx + 1 < staff.measures.length) {
              const nextVoice = (staff.measures[mIdx + 1] as any).voices?.[0]
              for (const e of nextVoice?.events ?? []) {
                if (e.type === 'note') { nextNote = e; break }
              }
            }
            if (!nextNote) break
            const tying = !note.tieStart
            note.tieStart = tying
            nextNote.tieEnd = tying
            found = true
            break
          }
        }
        break
      }

      case 'ADD_SLUR': {
        const part  = draft.parts.find(p => p.id === command.partId)
        const staff = part?.staves.find(s => s.id === command.staffId) as any
        if (!staff) break
        if (!staff.slurs) staff.slurs = []
        staff.slurs.push(command.slur)
        break
      }

      case 'REMOVE_SLUR': {
        const part  = draft.parts.find(p => p.id === command.partId)
        const staff = part?.staves.find(s => s.id === command.staffId) as any
        if (!staff?.slurs) break
        staff.slurs = staff.slurs.filter((s: any) => s.id !== command.slurId)
        break
      }

      case 'SET_ARTICULATION': {
        for (const { partId, staffId, measureId, voiceId, noteId } of command.targets) {
          const part    = draft.parts.find(p => p.id === partId)
          const staff   = part?.staves.find(s => s.id === staffId)
          const measure = staff?.measures.find(m => m.id === measureId)
          const voice   = measure?.voices.find(v => v.id === voiceId)
          if (!voice) continue
          const event = voice.events.find(e => e.id === noteId) as any
          if (!event || event.type === 'rest') continue
          if (!event.articulations) event.articulations = []
          if (command.on) {
            if (!event.articulations.includes(command.articulation)) {
              event.articulations.push(command.articulation)
            }
          } else {
            event.articulations = event.articulations.filter((a: string) => a !== command.articulation)
          }
        }
        break
      }

      case 'MOVE_NOTES_STEP':
      case 'TRANSPOSE_NOTES': {
        const delta = command.type === 'MOVE_NOTES_STEP'
          ? (command.direction === 'up' ? 1 : -1)
          : command.semitones
        for (const { partId, staffId, measureId, voiceId, noteId } of command.moves) {
          const part    = draft.parts.find(p => p.id === partId)
          const staff   = part?.staves.find(s => s.id === staffId)
          const measure = staff?.measures.find(m => m.id === measureId)
          const voice   = measure?.voices.find(v => v.id === voiceId)
          if (!voice) continue
          const event = voice.events.find(e => e.id === noteId) as any
          if (!event) continue
          if (event.type === 'note') {
            const s = shiftPitchBySemitones(event.pitch.noteName, event.pitch.octave, event.pitch.accidental, delta)
            event.pitch.noteName   = s.noteName
            event.pitch.octave     = s.octave
            event.pitch.accidental = s.accidental
          } else if (event.type === 'chord') {
            for (const pitch of event.pitches ?? []) {
              const s = shiftPitchBySemitones(pitch.noteName, pitch.octave, pitch.accidental, delta)
              pitch.noteName   = s.noteName
              pitch.octave     = s.octave
              pitch.accidental = s.accidental
            }
          }
        }
        break
      }

      case 'RESIZE_NOTE': {
        const part    = draft.parts.find(p => p.id === command.partId)
        const staff   = part?.staves.find(s => s.id === command.staffId)
        const measure = staff?.measures.find(m => m.id === command.measureId)
        const voice   = measure?.voices.find(v => v.id === command.voiceId)
        if (!voice) break
        const events = voice.events as NoteEvent[]
        const idx = events.findIndex(e => e.id === command.noteId)
        if (idx === -1) break

        const event   = events[idx]
        const oldUnits = dottedUnits(DURATION_UNITS[event.duration], event.dots)
        const newUnits = dottedUnits(DURATION_UNITS[command.newDuration], command.newDots)

        if (newUnits < oldUnits) {
          // Shrink: merge freed space into adjacent rest, or insert new rest(s)
          const delta = oldUnits - newUnits
          const next  = events[idx + 1]
          let freeUnits = delta
          if (next && next.type === 'rest') {
            freeUnits += dottedUnits(DURATION_UNITS[next.duration], next.dots)
            events.splice(idx + 1, 1)
          }
          events.splice(idx + 1, 0, ...fillWithRests(freeUnits))
        } else if (newUnits > oldUnits) {
          // Grow: consume subsequent events greedily
          const need = newUnits - oldUnits
          let accumulated = 0
          let count = 0
          for (let j = idx + 1; j < events.length && accumulated < need; j++) {
            accumulated += dottedUnits(DURATION_UNITS[events[j].duration], events[j].dots)
            count++
          }
          if (accumulated < need) break  // not enough room — no-op (blocked pre-dispatch)
          events.splice(idx + 1, count)
          const remainder = accumulated - need
          if (remainder > 0) events.splice(idx + 1, 0, ...fillWithRests(remainder))
          // Clear tieStart on the resized note if it tied into a consumed event
          if (event.type === 'note' && (event as Note).tieStart) {
            ;(event as any).tieStart = false
          }
        }

        ;(event as any).duration = command.newDuration
        ;(event as any).dots     = command.newDots
        break
      }

      case 'DELETE_NOTES': {
        for (const { partId, staffId, measureId, voiceId, noteId } of command.deletions) {
          const part    = draft.parts.find(p => p.id === partId)
          const staff   = part?.staves.find(s => s.id === staffId)
          const measure = staff?.measures.find(m => m.id === measureId)
          const voice   = measure?.voices.find(v => v.id === voiceId)
          if (!voice) continue
          const events = voice.events as NoteEvent[]
          const idx = events.findIndex(e => e.id === noteId)
          if (idx === -1) continue
          const deleted = events[idx]
          if (deleted.type === 'note' && (deleted as Note).tieEnd && idx > 0) {
            const prev = events[idx - 1]
            if (prev.type === 'note') (prev as any).tieStart = false
          }
          if (deleted.type === 'note' && (deleted as Note).tieStart && idx + 1 < events.length) {
            const next = events[idx + 1]
            if (next.type === 'note') (next as any).tieEnd = false
          }
          events.splice(idx, 1)
          if ((staff as any).slurs) {
            ;(staff as any).slurs = (staff as any).slurs.filter(
              (sl: any) => sl.fromNoteId !== noteId && sl.toNoteId !== noteId
            )
          }
        }
        break
      }

      case 'ADD_TEXT_BOX': {
        if (!(draft as any).textBoxes) (draft as any).textBoxes = []
        ;(draft as any).textBoxes.push(command.box)
        break
      }

      case 'UPDATE_TEXT_BOX': {
        const boxes = (draft as any).textBoxes as TextBox[]
        if (!boxes) break
        const box = boxes.find((b: any) => b.id === command.id) as any
        if (!box) break
        if (command.html  !== undefined) box.html  = command.html
        if (command.x     !== undefined) box.x     = command.x
        if (command.y     !== undefined) box.y     = command.y
        if (command.width !== undefined) box.width = command.width
        break
      }

      case 'DELETE_TEXT_BOX': {
        if (!(draft as any).textBoxes) break
        ;(draft as any).textBoxes = (draft as any).textBoxes.filter((b: any) => b.id !== command.id)
        break
      }

      case 'ADD_HAIRPIN': {
        for (const part of draft.parts) {
          if (part.id !== command.partId) continue
          for (const staff of part.staves) {
            if (staff.id !== command.staffId) continue
            const s = staff as any
            if (!s.hairpins) s.hairpins = []
            // Replace any existing hairpin that starts at the same note
            s.hairpins = s.hairpins.filter((h: any) => h.fromNoteId !== command.hairpin.fromNoteId)
            s.hairpins.push(command.hairpin)
          }
        }
        break
      }

      case 'REMOVE_HAIRPIN': {
        for (const part of draft.parts) {
          if (part.id !== command.partId) continue
          for (const staff of part.staves) {
            if (staff.id !== command.staffId) continue
            const s = staff as any
            if (!s.hairpins) break
            s.hairpins = s.hairpins.filter((h: any) => h.id !== command.hairpinId)
          }
        }
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
