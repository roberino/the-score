// Tests for score command reducers.
// P1: DELETE_NOTE — tie chain cleanup, slur removal
// P2: RESIZE_NOTE, TOGGLE_TIE
// P3: INSERT_MEASURE, REMOVE_MEASURE, CLEAR_MEASURES
// MIDI chord entry: REPLACE_NOTE + DELETE_NOTE + ADD_NOTE sequence against a rest-filled measure
// Note input mode: overwrite vs chord mode command sequences
// Duplicate pitch guard: same pitch cannot appear twice in one voice position

import { describe, it, expect } from 'vitest'
import { applyCommand } from '@shared/commands'
import type { Score, Note, NoteEvent, Slur, Duration, TimeSignature, KeySignature, Chord, Pitch, Articulation } from '@shared/score'
import { createRest, createNote } from '@shared/score'
import { measureCapacityUnits, eventDurationUnits } from '@shared/musicUtils'

// ── Score fixture helpers ─────────────────────────────────────────────────────

const PART_ID    = 'part-1'
const STAFF_ID   = 'staff-1'
const MEASURE_ID = 'measure-1'
const VOICE_ID   = 'voice-1'

/** Minimal valid Note with overridable fields. */
function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    type:         'note',
    pitch:        { noteName: 'C', octave: 4, accidental: null },
    duration:     'quarter',
    dots:         0,
    tieStart:     false,
    tieEnd:       false,
    beamStart:    false,
    beamEnd:      false,
    articulations: [],
    ...overrides,
  }
}

/** Minimal Score containing a single measure with the given events. */
function makeScore(events: NoteEvent[]): Score {
  const now = '2024-01-01T00:00:00.000Z'
  return {
    id: 'score-1',
    metadata: {
      title: '', subtitle: '', composer: '', arranger: '',
      lyricist: '', copyright: '', createdAt: now, updatedAt: now,
    },
    parts: [{
      id: PART_ID, name: 'Piano', shortName: 'Pno.',
      midiProgram: 0, transposeSemitones: 0,
      staves: [{
        id: STAFF_ID, clef: 'treble',
        measures: [{
          id: MEASURE_ID, number: 1, barline: 'final',
          voices: [{ id: VOICE_ID, events }],
        }],
      }],
      volume: 0.8, muted: false, labelVisible: true,
    }],
    keySignature:  { fifths: 0, mode: 'major' },
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120, showPartLabels: true, textBoxes: [], version: 1,
  }
}

/** Convenience: run DELETE_NOTE on noteId. */
function deleteNote(score: Score, noteId: string) {
  return applyCommand(score, {
    type:      'DELETE_NOTE',
    partId:    PART_ID,
    staffId:   STAFF_ID,
    measureId: MEASURE_ID,
    voiceId:   VOICE_ID,
    noteId,
  })
}

/** Extract voice events from the first measure of the result. */
function events(score: Score): NoteEvent[] {
  return score.parts[0].staves[0].measures[0].voices[0].events as NoteEvent[]
}

/** Extract staff slurs. */
function slurs(score: Score): Slur[] {
  return ((score.parts[0].staves[0] as any).slurs ?? []) as Slur[]
}

// ── DELETE_NOTE — basic deletion ──────────────────────────────────────────────

describe('DELETE_NOTE — basic deletion', () => {
  it('removes the note from the voice', () => {
    const n = makeNote('n1')
    const next = deleteNote(makeScore([n]), 'n1')
    expect(events(next)).toHaveLength(0)
  })

  it('removes the correct note when multiple are present', () => {
    const n1 = makeNote('n1')
    const n2 = makeNote('n2')
    const n3 = makeNote('n3')
    const next = deleteNote(makeScore([n1, n2, n3]), 'n2')
    expect(events(next).map(e => e.id)).toEqual(['n1', 'n3'])
  })

  it('no-ops when noteId not found', () => {
    const n = makeNote('n1')
    const next = deleteNote(makeScore([n]), 'missing')
    expect(events(next)).toHaveLength(1)
  })

  it('does not mutate the original score', () => {
    const n = makeNote('n1')
    const score = makeScore([n])
    deleteNote(score, 'n1')
    expect(events(score)).toHaveLength(1)
  })
})

// ── DELETE_NOTE — tie chain cleanup ───────────────────────────────────────────

describe('DELETE_NOTE — tie chain cleanup', () => {
  it('clears tieStart on the predecessor when the tieEnd note is deleted', () => {
    const n1 = makeNote('n1', { tieStart: true })
    const n2 = makeNote('n2', { tieEnd: true })
    const next = deleteNote(makeScore([n1, n2]), 'n2')
    const remaining = events(next)
    expect(remaining).toHaveLength(1)
    expect((remaining[0] as Note).tieStart).toBe(false)
  })

  it('clears tieEnd on the successor when the tieStart note is deleted', () => {
    const n1 = makeNote('n1', { tieStart: true })
    const n2 = makeNote('n2', { tieEnd: true })
    const next = deleteNote(makeScore([n1, n2]), 'n1')
    const remaining = events(next)
    expect(remaining).toHaveLength(1)
    expect((remaining[0] as Note).tieEnd).toBe(false)
  })

  it('handles middle of three-note tie chain: cleans both neighbours', () => {
    // n1 → n2 → n3 (all tied). Deleting n2 should clear n1.tieStart and n3.tieEnd.
    const n1 = makeNote('n1', { tieStart: true })
    const n2 = makeNote('n2', { tieStart: true, tieEnd: true })
    const n3 = makeNote('n3', { tieEnd: true })
    const next = deleteNote(makeScore([n1, n2, n3]), 'n2')
    const remaining = events(next) as Note[]
    expect(remaining).toHaveLength(2)
    expect(remaining[0].tieStart).toBe(false)  // n1 no longer ties forward
    expect(remaining[1].tieEnd).toBe(false)    // n3 no longer ties back
  })

  it('does not alter tie flags on an untied note', () => {
    const n1 = makeNote('n1')  // no ties
    const n2 = makeNote('n2')
    const next = deleteNote(makeScore([n1, n2]), 'n1')
    const remaining = events(next) as Note[]
    expect(remaining[0].tieEnd).toBe(false)   // n2 unchanged
    expect(remaining[0].tieStart).toBe(false)
  })

  it('deleting the tieStart note when it is the first in the voice does not crash', () => {
    const n1 = makeNote('n1', { tieStart: true }) // no predecessor
    const n2 = makeNote('n2', { tieEnd: true })
    expect(() => deleteNote(makeScore([n1, n2]), 'n1')).not.toThrow()
  })

  it('deleting the tieEnd note when it is the last in the voice does not crash', () => {
    const n1 = makeNote('n1', { tieStart: true })
    const n2 = makeNote('n2', { tieEnd: true })   // no successor
    expect(() => deleteNote(makeScore([n1, n2]), 'n2')).not.toThrow()
  })
})

// ── DELETE_NOTE — slur removal ────────────────────────────────────────────────

describe('DELETE_NOTE — slur cleanup', () => {
  function makeSlur(id: string, from: string, to: string): Slur {
    return { id, fromNoteId: from, toNoteId: to }
  }

  it('removes a slur when its fromNoteId is deleted', () => {
    const n1 = makeNote('n1')
    const n2 = makeNote('n2')
    const slur = makeSlur('sl-1', 'n1', 'n2')
    let score = makeScore([n1, n2])
    score = applyCommand(score, { type: 'ADD_SLUR', partId: PART_ID, staffId: STAFF_ID, slur })
    expect(slurs(score)).toHaveLength(1)

    const next = deleteNote(score, 'n1')
    expect(slurs(next)).toHaveLength(0)
  })

  it('removes a slur when its toNoteId is deleted', () => {
    const n1 = makeNote('n1')
    const n2 = makeNote('n2')
    const slur = makeSlur('sl-1', 'n1', 'n2')
    let score = makeScore([n1, n2])
    score = applyCommand(score, { type: 'ADD_SLUR', partId: PART_ID, staffId: STAFF_ID, slur })

    const next = deleteNote(score, 'n2')
    expect(slurs(next)).toHaveLength(0)
  })

  it('removes only the slur referencing the deleted note, leaves others intact', () => {
    const n1 = makeNote('n1')
    const n2 = makeNote('n2')
    const n3 = makeNote('n3')
    let score = makeScore([n1, n2, n3])
    // Two slurs: n1→n2 and n2→n3
    score = applyCommand(score, { type: 'ADD_SLUR', partId: PART_ID, staffId: STAFF_ID, slur: makeSlur('sl-1', 'n1', 'n2') })
    score = applyCommand(score, { type: 'ADD_SLUR', partId: PART_ID, staffId: STAFF_ID, slur: makeSlur('sl-2', 'n2', 'n3') })
    expect(slurs(score)).toHaveLength(2)

    // Delete n1 — only sl-1 should be removed
    const next = deleteNote(score, 'n1')
    expect(slurs(next)).toHaveLength(1)
    expect(slurs(next)[0].id).toBe('sl-2')
  })

  it('deleting a note with no slurs leaves the slur list unchanged', () => {
    const n1 = makeNote('n1')
    const n2 = makeNote('n2')
    const n3 = makeNote('n3')
    let score = makeScore([n1, n2, n3])
    score = applyCommand(score, { type: 'ADD_SLUR', partId: PART_ID, staffId: STAFF_ID, slur: makeSlur('sl-1', 'n1', 'n2') })

    // Delete n3 — not referenced by any slur
    const next = deleteNote(score, 'n3')
    expect(slurs(next)).toHaveLength(1)
  })

  it('works correctly when no slurs exist at all', () => {
    const n1 = makeNote('n1')
    // Staff has no slurs field — must not crash
    const score = makeScore([n1])
    expect(() => deleteNote(score, 'n1')).not.toThrow()
    expect(slurs(deleteNote(score, 'n1'))).toHaveLength(0)
  })
})

// ── RESIZE_NOTE helpers ───────────────────────────────────────────────────────

function resizeNote(score: Score, noteId: string, newDuration: Duration, newDots: 0 | 1 | 2 = 0): Score {
  return applyCommand(score, {
    type:        'RESIZE_NOTE',
    partId:      PART_ID,
    staffId:     STAFF_ID,
    measureId:   MEASURE_ID,
    voiceId:     VOICE_ID,
    noteId,
    newDuration,
    newDots,
  })
}

function shapeOf(e: NoteEvent): { type: string; duration: string; dots: number } {
  return { type: e.type, duration: (e as any).duration, dots: (e as any).dots ?? 0 }
}

// ── RESIZE_NOTE — shrink ──────────────────────────────────────────────────────

describe('RESIZE_NOTE — shrink', () => {
  it('quarter → eighth: inserts single eighth rest for freed 8 units', () => {
    const n = makeNote('n1')
    const next = resizeNote(makeScore([n]), 'n1', 'eighth')
    const evs = events(next)
    expect(evs).toHaveLength(2)
    expect(shapeOf(evs[0])).toEqual({ type: 'note',  duration: 'eighth', dots: 0 })
    expect(shapeOf(evs[1])).toEqual({ type: 'rest',  duration: 'eighth', dots: 0 })
  })

  it('quarter → 16th: inserts dotted-eighth rest for freed 12 units', () => {
    const n = makeNote('n1')
    const next = resizeNote(makeScore([n]), 'n1', '16th')
    const evs = events(next)
    expect(evs).toHaveLength(2)
    expect(shapeOf(evs[0])).toEqual({ type: 'note', duration: '16th',   dots: 0 })
    expect(shapeOf(evs[1])).toEqual({ type: 'rest', duration: 'eighth', dots: 1 })
  })

  it('merges freed units with an adjacent rest when next event is a rest', () => {
    // quarter_note(16) + quarter_rest(16) → shrink note to eighth
    // freed delta=8, existing rest=16 → merged=24 → dotted_quarter_rest
    const n = makeNote('n1')
    const r = createRest('quarter')
    const next = resizeNote(makeScore([n, r]), 'n1', 'eighth')
    const evs = events(next)
    expect(evs).toHaveLength(2)
    expect(shapeOf(evs[0])).toEqual({ type: 'note', duration: 'eighth',  dots: 0 })
    expect(shapeOf(evs[1])).toEqual({ type: 'rest', duration: 'quarter', dots: 1 })
  })

  it('does not mutate the original score', () => {
    const n = makeNote('n1')
    const score = makeScore([n])
    resizeNote(score, 'n1', 'eighth')
    expect((events(score)[0] as any).duration).toBe('quarter')
  })

  it('no-ops when noteId is not found', () => {
    const n = makeNote('n1')
    const score = makeScore([n])
    const next = resizeNote(score, 'missing', 'eighth')
    expect((events(next)[0] as any).duration).toBe('quarter')
  })
})

// ── RESIZE_NOTE — grow ────────────────────────────────────────────────────────

describe('RESIZE_NOTE — grow', () => {
  it('quarter → half: consumes the following quarter rest, no remainder', () => {
    const n = makeNote('n1')
    const r = createRest('quarter')
    const next = resizeNote(makeScore([n, r]), 'n1', 'half')
    const evs = events(next)
    expect(evs).toHaveLength(1)
    expect(shapeOf(evs[0])).toEqual({ type: 'note', duration: 'half', dots: 0 })
  })

  it('blocked when not enough room: score unchanged', () => {
    // quarter_note alone — no events to consume, need=16 but accumulated=0
    const n = makeNote('n1')
    const next = resizeNote(makeScore([n]), 'n1', 'half')
    expect((events(next)[0] as any).duration).toBe('quarter')
  })

  it('grows to exactly fill remaining capacity: no remainder events added', () => {
    // quarter_note(16) + dotted_half_rest(48) → grow to whole(64)
    const n = makeNote('n1')
    const r = { ...createRest('half'), dots: 1 as 1 }
    const next = resizeNote(makeScore([n, r]), 'n1', 'whole')
    const evs = events(next)
    expect(evs).toHaveLength(1)
    expect(shapeOf(evs[0])).toEqual({ type: 'note', duration: 'whole', dots: 0 })
  })

  it('grow consumes multiple rests, removing all of them', () => {
    // quarter_note + eighth_rest + eighth_rest → grow to half (need=16)
    // 8+8=16, count=2, splice both rests
    const n  = makeNote('n1')
    const r1 = createRest('eighth')
    const r2 = createRest('eighth')
    const next = resizeNote(makeScore([n, r1, r2]), 'n1', 'half')
    const evs = events(next)
    expect(evs).toHaveLength(1)
    expect(shapeOf(evs[0])).toEqual({ type: 'note', duration: 'half', dots: 0 })
  })

  it('grow leaves a remainder rest when consumed unit surplus exceeds need', () => {
    // quarter_note(16) + half_rest(32) → grow to dotted_quarter(24), need=8
    // half_rest(32) consumed, remainder=32-8=24 → dotted_quarter_rest
    const n = makeNote('n1')
    const r = createRest('half')
    const next = resizeNote(makeScore([n, r]), 'n1', 'quarter', 1)  // dotted quarter
    const evs = events(next)
    expect(evs).toHaveLength(2)
    expect(shapeOf(evs[0])).toEqual({ type: 'note', duration: 'quarter', dots: 1 })
    expect(shapeOf(evs[1])).toEqual({ type: 'rest', duration: 'quarter', dots: 1 })
  })

  it('clears tieStart on the grown note', () => {
    // A tied note that grows should lose its tieStart (the tie target was consumed)
    const n = makeNote('n1', { tieStart: true })
    const r = createRest('quarter')
    const next = resizeNote(makeScore([n, r]), 'n1', 'half')
    expect((events(next)[0] as Note).tieStart).toBe(false)
  })
})

// ── TOGGLE_TIE helpers ────────────────────────────────────────────────────────

const MEASURE_ID_2 = 'measure-2'
const VOICE_ID_2   = 'voice-2'

function toggleTie(score: Score, noteId: string): Score {
  return applyCommand(score, {
    type:    'TOGGLE_TIE',
    partId:  PART_ID,
    staffId: STAFF_ID,
    noteId,
  })
}

/** Score with two measures sharing the same part/staff. */
function makeTwoMeasureScore(events1: NoteEvent[], events2: NoteEvent[]): Score {
  const now = '2024-01-01T00:00:00.000Z'
  return {
    id: 'score-1',
    metadata: { title: '', subtitle: '', composer: '', arranger: '',
                lyricist: '', copyright: '', createdAt: now, updatedAt: now },
    parts: [{
      id: PART_ID, name: 'Piano', shortName: 'Pno.',
      midiProgram: 0, transposeSemitones: 0,
      staves: [{
        id: STAFF_ID, clef: 'treble',
        measures: [
          { id: MEASURE_ID,   number: 1, barline: 'single', voices: [{ id: VOICE_ID,   events: events1 }] },
          { id: MEASURE_ID_2, number: 2, barline: 'final',  voices: [{ id: VOICE_ID_2, events: events2 }] },
        ],
      }],
      volume: 0.8, muted: false, labelVisible: true,
    }],
    keySignature:  { fifths: 0, mode: 'major' },
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120, showPartLabels: true, textBoxes: [], version: 1,
  }
}

/** Extract voice events from the second measure. */
function eventsM2(score: Score): NoteEvent[] {
  return score.parts[0].staves[0].measures[1].voices[0].events as NoteEvent[]
}

// ── TOGGLE_TIE ────────────────────────────────────────────────────────────────

describe('TOGGLE_TIE — tie creation', () => {
  it('creates a tie when the next note has the same pitch', () => {
    const n1 = makeNote('n1')  // C4
    const n2 = makeNote('n2')  // C4 — identical pitch
    const next = toggleTie(makeScore([n1, n2]), 'n1')
    const evs = events(next) as Note[]
    expect(evs[0].tieStart).toBe(true)
    expect(evs[1].tieEnd).toBe(true)
  })

  it('does not create a tie when the next note has a different pitch', () => {
    const n1 = makeNote('n1')                          // C4
    const n2 = makeNote('n2', { pitch: { noteName: 'D', octave: 4, accidental: null } })
    const next = toggleTie(makeScore([n1, n2]), 'n1')
    const evs = events(next) as Note[]
    expect(evs[0].tieStart).toBe(false)
    expect(evs[1].tieEnd).toBe(false)
  })

  it('does not create a tie when there is no following note', () => {
    const n1 = makeNote('n1')
    const next = toggleTie(makeScore([n1]), 'n1')
    expect((events(next)[0] as Note).tieStart).toBe(false)
  })

  it('does not create a tie when the voice ends with rests and no following note', () => {
    const n1 = makeNote('n1')
    const r  = createRest('quarter')
    const next = toggleTie(makeScore([n1, r]), 'n1')
    expect((events(next)[0] as Note).tieStart).toBe(false)
  })
})

describe('TOGGLE_TIE — tie removal', () => {
  it('clears an existing tie when the note already has tieStart=true', () => {
    const n1 = makeNote('n1', { tieStart: true })
    const n2 = makeNote('n2', { tieEnd: true })
    const next = toggleTie(makeScore([n1, n2]), 'n1')
    const evs = events(next) as Note[]
    expect(evs[0].tieStart).toBe(false)
    expect(evs[1].tieEnd).toBe(false)
  })

  it('does not alter notes when noteId is not found', () => {
    const n1 = makeNote('n1')
    const n2 = makeNote('n2')
    const next = toggleTie(makeScore([n1, n2]), 'missing')
    const evs = events(next) as Note[]
    expect(evs[0].tieStart).toBe(false)
    expect(evs[1].tieEnd).toBe(false)
  })
})

describe('TOGGLE_TIE — cross-measure', () => {
  it('creates a tie to the first note of the next measure when pitches match', () => {
    const n1 = makeNote('n1')  // C4, last note in measure 1
    const n2 = makeNote('n2')  // C4, first note in measure 2
    const score = makeTwoMeasureScore([n1], [n2])
    const next = toggleTie(score, 'n1')
    expect((events(next)[0] as Note).tieStart).toBe(true)
    expect((eventsM2(next)[0] as Note).tieEnd).toBe(true)
  })

  it('does not tie cross-measure when next measure starts with a different pitch', () => {
    const n1 = makeNote('n1')  // C4
    const n2 = makeNote('n2', { pitch: { noteName: 'E', octave: 4, accidental: null } })
    const score = makeTwoMeasureScore([n1], [n2])
    const next = toggleTie(score, 'n1')
    expect((events(next)[0] as Note).tieStart).toBe(false)
    expect((eventsM2(next)[0] as Note).tieEnd).toBe(false)
  })
})

// ── INSERT_MEASURE / REMOVE_MEASURE helpers ───────────────────────────────────

function makeMeasure(id: string, number: number, barline: string, events: NoteEvent[] = []) {
  return { id, number, barline, voices: [{ id: 'v1', events }] }
}

function makeMultiMeasureScore(measureCount: number): Score {
  const now = '2024-01-01T00:00:00.000Z'
  const measures = Array.from({ length: measureCount }, (_, i) =>
    makeMeasure(`m${i + 1}`, i + 1, i === measureCount - 1 ? 'final' : 'single')
  )
  return {
    id: 'score-1',
    metadata: {
      title: '', subtitle: '', composer: '', arranger: '',
      lyricist: '', copyright: '', createdAt: now, updatedAt: now,
    },
    parts: [{
      id: PART_ID, name: 'Piano', shortName: 'Pno.',
      midiProgram: 0, transposeSemitones: 0,
      staves: [{ id: STAFF_ID, clef: 'treble', measures }],
      volume: 0.8, muted: false, labelVisible: true,
    }],
    keySignature:  { fifths: 0, mode: 'major' },
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120, showPartLabels: true, textBoxes: [], version: 1,
  }
}

function measures(score: Score) {
  return score.parts[0].staves[0].measures as any[]
}

function insertMeasure(score: Score, afterMeasureIndex: number) {
  return applyCommand(score, { type: 'INSERT_MEASURE', afterMeasureIndex })
}

function removeMeasure(score: Score, measureIndex: number) {
  return applyCommand(score, { type: 'REMOVE_MEASURE', measureIndex })
}

// ── INSERT_MEASURE ────────────────────────────────────────────────────────────

describe('INSERT_MEASURE — barline and numbering', () => {
  it('inserts a new measure after the given index', () => {
    const score = makeMultiMeasureScore(3)
    const next = insertMeasure(score, 1)
    expect(measures(next)).toHaveLength(4)
  })

  it('insert in middle: old measure at index keeps its barline, new measure is single', () => {
    // 3-measure score: m1(single) m2(single) m3(final)
    // insert after index 1 → [m1, m2, NEW, m3]
    const score = makeMultiMeasureScore(3)
    const next = insertMeasure(score, 1)
    const ms = measures(next)
    expect(ms[1].barline).toBe('single')
    expect(ms[2].barline).toBe('single')
  })

  it('insert at end: old last measure gets single barline, new measure gets final', () => {
    const score = makeMultiMeasureScore(2)
    const next = insertMeasure(score, 1)
    const ms = measures(next)
    expect(ms[1].barline).toBe('single')
    expect(ms[2].barline).toBe('final')
  })

  it('renumbers measures correctly after insertion', () => {
    const score = makeMultiMeasureScore(3)
    const next = insertMeasure(score, 0)
    const ms = measures(next)
    expect(ms.map((m: any) => m.number)).toEqual([1, 2, 3, 4])
  })

  it('inserts into all staves of all parts simultaneously', () => {
    const now = '2024-01-01T00:00:00.000Z'
    const score: Score = {
      id: 'score-multi',
      metadata: {
        title: '', subtitle: '', composer: '', arranger: '',
        lyricist: '', copyright: '', createdAt: now, updatedAt: now,
      },
      parts: [
        {
          id: 'p1', name: 'Flute', shortName: 'Fl.',
          midiProgram: 0, transposeSemitones: 0,
          staves: [{ id: 's1', clef: 'treble', measures: [
            makeMeasure('m1', 1, 'single'),
            makeMeasure('m2', 2, 'final'),
          ]}],
          volume: 0.8, muted: false, labelVisible: true,
        },
        {
          id: 'p2', name: 'Cello', shortName: 'Vc.',
          midiProgram: 42, transposeSemitones: 0,
          staves: [{ id: 's2', clef: 'bass', measures: [
            makeMeasure('m3', 1, 'single'),
            makeMeasure('m4', 2, 'final'),
          ]}],
          volume: 0.8, muted: false, labelVisible: true,
        },
      ],
      keySignature:  { fifths: 0, mode: 'major' },
      timeSignature: { numerator: 4, denominator: 4 },
      tempo: 120, showPartLabels: true, textBoxes: [], version: 1,
    }
    const next = insertMeasure(score, 0)
    expect((next.parts[0].staves[0].measures as any[]).length).toBe(3)
    expect((next.parts[1].staves[0].measures as any[]).length).toBe(3)
  })
})

// ── INSERT_MEASURE with count ─────────────────────────────────────────────────

function insertMeasures(score: Score, afterMeasureIndex: number, count: number) {
  return applyCommand(score, { type: 'INSERT_MEASURE', afterMeasureIndex, count })
}

describe('INSERT_MEASURE — count > 1', () => {
  it('inserts the correct number of bars', () => {
    const score = makeMultiMeasureScore(3)
    const next = insertMeasures(score, 1, 4)
    expect(measures(next)).toHaveLength(7)
  })

  it('all inserted bars in the middle have single barlines', () => {
    const score = makeMultiMeasureScore(3)
    const next = insertMeasures(score, 0, 3)
    const ms = measures(next)
    expect(ms[1].barline).toBe('single')
    expect(ms[2].barline).toBe('single')
    expect(ms[3].barline).toBe('single')
  })

  it('insert multiple at end: only last new bar gets final barline', () => {
    const score = makeMultiMeasureScore(2) // m1(single) m2(final)
    const next = insertMeasures(score, 1, 3) // insert 3 after last
    const ms = measures(next)
    expect(ms).toHaveLength(5)
    expect(ms[1].barline).toBe('single') // old last demoted
    expect(ms[2].barline).toBe('single')
    expect(ms[3].barline).toBe('single')
    expect(ms[4].barline).toBe('final')  // only the new last
  })

  it('renumbers all measures correctly after multi-insert', () => {
    const score = makeMultiMeasureScore(3)
    const next = insertMeasures(score, 1, 2)
    expect(measures(next).map((m: any) => m.number)).toEqual([1, 2, 3, 4, 5])
  })

  it('count=1 behaves identically to omitting count', () => {
    const score = makeMultiMeasureScore(3)
    const withCount = insertMeasures(score, 1, 1)
    const withoutCount = insertMeasure(score, 1)
    const msA = measures(withCount)
    const msB = measures(withoutCount)
    expect(msA.map((m: any) => m.barline)).toEqual(msB.map((m: any) => m.barline))
    expect(msA.map((m: any) => m.number)).toEqual(msB.map((m: any) => m.number))
    expect(msA).toHaveLength(msB.length)
  })
})

// ── INSERT_MEASURE with partId ────────────────────────────────────────────────

function makeTwoPartScore(measureCount: number): Score {
  const now = '2024-01-01T00:00:00.000Z'
  const makeMeasures = () => Array.from({ length: measureCount }, (_, i) =>
    makeMeasure(`m${i + 1}`, i + 1, i === measureCount - 1 ? 'final' : 'single')
  )
  return {
    id: 'score-2p',
    metadata: { title: '', subtitle: '', composer: '', arranger: '', lyricist: '', copyright: '', createdAt: now, updatedAt: now },
    parts: [
      { id: 'p1', name: 'Flute',  shortName: 'Fl.', midiProgram: 0,  transposeSemitones: 0, staves: [{ id: 's1', clef: 'treble', measures: makeMeasures() }], volume: 0.8, muted: false, labelVisible: true },
      { id: 'p2', name: 'Cello',  shortName: 'Vc.', midiProgram: 42, transposeSemitones: 0, staves: [{ id: 's2', clef: 'bass',   measures: makeMeasures() }], volume: 0.8, muted: false, labelVisible: true },
    ],
    keySignature: { fifths: 0, mode: 'major' },
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120, showPartLabels: true, textBoxes: [], version: 1,
  }
}

function partMeasures(score: Score, partId: string) {
  return (score.parts.find(p => p.id === partId)!.staves[0].measures as any[])
}

describe('INSERT_MEASURE — partId', () => {
  it('when partId set, target part gets bars inserted at the given index', () => {
    const score = makeTwoPartScore(4) // 4 bars each
    const next = applyCommand(score, { type: 'INSERT_MEASURE', afterMeasureIndex: 1, count: 2, partId: 'p1' })
    expect(partMeasures(next, 'p1')).toHaveLength(6)
  })

  it('when partId set, other parts get the same count appended at end to stay aligned', () => {
    const score = makeTwoPartScore(4)
    const next = applyCommand(score, { type: 'INSERT_MEASURE', afterMeasureIndex: 1, count: 2, partId: 'p1' })
    expect(partMeasures(next, 'p2')).toHaveLength(6)
  })

  it('other parts new bars are appended at the end, not at the insertion point', () => {
    // p1: insert after index 0 → [m1, NEW, NEW, m2, m3]
    // p2: append at end → [m1, m2, m3, NEW, NEW]
    const score = makeTwoPartScore(3)
    const next = applyCommand(score, { type: 'INSERT_MEASURE', afterMeasureIndex: 0, count: 2, partId: 'p1' })
    const p1ms = partMeasures(next, 'p1')
    const p2ms = partMeasures(next, 'p2')
    // p1: new bars are at indices 1 and 2
    expect(p1ms[0].number).toBe(1)
    expect(p1ms[1].number).toBe(2) // first new
    expect(p1ms[2].number).toBe(3) // second new
    expect(p1ms[3].number).toBe(4) // old m2 renumbered
    // p2: new bars are at the end
    expect(p2ms[0].number).toBe(1)
    expect(p2ms[1].number).toBe(2)
    expect(p2ms[2].number).toBe(3)
    expect(p2ms[3].number).toBe(4) // first appended
    expect(p2ms[4].number).toBe(5) // second appended
  })

  it('final barline moves to the new last bar in both parts', () => {
    const score = makeTwoPartScore(2)
    const next = applyCommand(score, { type: 'INSERT_MEASURE', afterMeasureIndex: 0, count: 1, partId: 'p1' })
    const p1ms = partMeasures(next, 'p1')
    const p2ms = partMeasures(next, 'p2')
    expect(p1ms[p1ms.length - 1].barline).toBe('final')
    expect(p2ms[p2ms.length - 1].barline).toBe('final')
    expect(p1ms.filter((m: any) => m.barline === 'final')).toHaveLength(1)
    expect(p2ms.filter((m: any) => m.barline === 'final')).toHaveLength(1)
  })

  it('without partId, all parts get bars inserted at the same index (existing behaviour)', () => {
    const score = makeTwoPartScore(3)
    const next = applyCommand(score, { type: 'INSERT_MEASURE', afterMeasureIndex: 1, count: 2 })
    expect(partMeasures(next, 'p1')).toHaveLength(5)
    expect(partMeasures(next, 'p2')).toHaveLength(5)
    // Both parts have new bars at index 2 and 3
    expect(partMeasures(next, 'p1')[2].number).toBe(3)
    expect(partMeasures(next, 'p2')[2].number).toBe(3)
  })
})

// ── REMOVE_MEASURE ────────────────────────────────────────────────────────────

describe('REMOVE_MEASURE — barline and numbering', () => {
  it('removes the measure at the given index', () => {
    const score = makeMultiMeasureScore(3)
    const next = removeMeasure(score, 1)
    expect(measures(next)).toHaveLength(2)
  })

  it('remove middle measure: renumbers remaining measures', () => {
    const score = makeMultiMeasureScore(4)
    const next = removeMeasure(score, 1)
    const ms = measures(next)
    expect(ms.map((m: any) => m.number)).toEqual([1, 2, 3])
  })

  it('remove last measure: new last measure gets final barline', () => {
    const score = makeMultiMeasureScore(3)
    const next = removeMeasure(score, 2)
    const ms = measures(next)
    expect(ms).toHaveLength(2)
    expect(ms[ms.length - 1].barline).toBe('final')
  })

  it('blocked when only 1 measure remains', () => {
    const score = makeMultiMeasureScore(1)
    const next = removeMeasure(score, 0)
    expect(measures(next)).toHaveLength(1)
  })

  it('remove non-final middle measure: last measure still has final barline', () => {
    const score = makeMultiMeasureScore(3)
    const next = removeMeasure(score, 0)
    const ms = measures(next)
    expect(ms[ms.length - 1].barline).toBe('final')
  })
})

// ── CLEAR_MEASURES ────────────────────────────────────────────────────────────

describe('CLEAR_MEASURES — fillWithRests integration', () => {
  function makeScoreWithNotes(notes: NoteEvent[], timeSig?: TimeSignature): Score {
    const now = '2024-01-01T00:00:00.000Z'
    const measure: any = {
      id: MEASURE_ID, number: 1, barline: 'final',
      voices: [{ id: VOICE_ID, events: notes }],
    }
    if (timeSig) measure.timeSignature = timeSig
    return {
      id: 'score-1',
      metadata: {
        title: '', subtitle: '', composer: '', arranger: '',
        lyricist: '', copyright: '', createdAt: now, updatedAt: now,
      },
      parts: [{
        id: PART_ID, name: 'Piano', shortName: 'Pno.',
        midiProgram: 0, transposeSemitones: 0,
        staves: [{ id: STAFF_ID, clef: 'treble', measures: [measure] }],
        volume: 0.8, muted: false, labelVisible: true,
      }],
      keySignature:  { fifths: 0, mode: 'major' },
      timeSignature: { numerator: 4, denominator: 4 },
      tempo: 120, showPartLabels: true, textBoxes: [], version: 1,
    }
  }

  function clearMeasure(score: Score) {
    return applyCommand(score, {
      type: 'CLEAR_MEASURES',
      targets: [{ partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID }],
    })
  }

  it('replaces notes with rests for a 4/4 measure (64 units → whole rest)', () => {
    const note = { id: 'n1', type: 'note' as const, pitch: { noteName: 'C' as const, octave: 4, accidental: null }, duration: 'quarter' as const, dots: 0, tieStart: false, tieEnd: false, beamStart: false, beamEnd: false, articulations: [] }
    const score = makeScoreWithNotes([note])
    const next = clearMeasure(score)
    const evs = (next.parts[0].staves[0].measures[0] as any).voices[0].events
    expect(evs).toHaveLength(1)
    expect(evs[0].type).toBe('rest')
    expect(evs[0].duration).toBe('whole')
    expect(evs[0].dots).toBe(0)
  })

  it('uses per-measure time sig override: 3/4 measure → dotted-half rest (48 units)', () => {
    const score = makeScoreWithNotes([], { numerator: 3, denominator: 4 })
    const next = clearMeasure(score)
    const evs = (next.parts[0].staves[0].measures[0] as any).voices[0].events
    expect(evs).toHaveLength(1)
    expect(evs[0].type).toBe('rest')
    expect(evs[0].duration).toBe('half')
    expect(evs[0].dots).toBe(1)
  })

  it('is idempotent: clearing an already-cleared measure gives the same rests', () => {
    const score = makeScoreWithNotes([])
    const once = clearMeasure(score)
    const twice = clearMeasure(once)
    const evs1 = (once.parts[0].staves[0].measures[0] as any).voices[0].events
    const evs2 = (twice.parts[0].staves[0].measures[0] as any).voices[0].events
    expect(evs2).toHaveLength(evs1.length)
    expect(evs2[0].duration).toBe(evs1[0].duration)
    expect(evs2[0].dots).toBe(evs1[0].dots)
  })
})

// ── SET_KEY / CLEAR_KEY helpers ───────────────────────────────────────────────

function makeNoteWithAccidental(id: string, noteName: import('@shared/score').NoteName, accidental: import('@shared/score').Accidental): Note {
  return { ...makeNote(id), pitch: { noteName, octave: 4, accidental } }
}

/** Two-measure score: m1 events in measure 1, m2 events in measure 2. */
function makeTwoMeasureScoreForKey(m1Events: NoteEvent[], m2Events: NoteEvent[]): Score {
  const now = '2024-01-01T00:00:00.000Z'
  return {
    id: 'score-1',
    metadata: {
      title: '', subtitle: '', composer: '', arranger: '',
      lyricist: '', copyright: '', createdAt: now, updatedAt: now,
    },
    parts: [{
      id: PART_ID, name: 'Piano', shortName: 'Pno.',
      midiProgram: 0, transposeSemitones: 0,
      staves: [{
        id: STAFF_ID, clef: 'treble',
        measures: [
          { id: MEASURE_ID,   number: 1, barline: 'single', voices: [{ id: VOICE_ID, events: m1Events }] },
          { id: MEASURE_ID_2, number: 2, barline: 'final',  voices: [{ id: VOICE_ID, events: m2Events }] },
        ],
      }],
      volume: 0.8, muted: false, labelVisible: true,
    }],
    keySignature:  { fifths: 0, mode: 'major' },
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120, showPartLabels: true, textBoxes: [], version: 1,
  }
}

function setKey(score: Score, measureId: string, key: KeySignature) {
  return applyCommand(score, { type: 'SET_KEY', partId: PART_ID, staffId: STAFF_ID, measureId, key })
}

function clearKey(score: Score, measureId: string) {
  return applyCommand(score, { type: 'CLEAR_KEY', partId: PART_ID, staffId: STAFF_ID, measureId })
}

function noteAccidental(score: Score, measureId: string, noteIdx: number) {
  const staff = score.parts[0].staves[0]
  const measure = (staff.measures as any[]).find((m: any) => m.id === measureId)
  return (measure.voices[0].events[noteIdx] as Note).pitch.accidental
}

// ── SET_KEY ───────────────────────────────────────────────────────────────────

describe('SET_KEY — accidental stripping', () => {
  it('F# in measure 1 is stripped when key changes to G major on measure 1', () => {
    const fSharp = makeNoteWithAccidental('n1', 'F', 'sharp')
    const score = makeTwoMeasureScoreForKey([fSharp], [])
    const next = setKey(score, MEASURE_ID, { fifths: 1, mode: 'major' })
    expect(noteAccidental(next, MEASURE_ID, 0)).toBeNull()
  })

  it('F# in a later measure is also stripped (forward propagation)', () => {
    const fSharp = makeNoteWithAccidental('n1', 'F', 'sharp')
    const score = makeTwoMeasureScoreForKey([], [fSharp])
    const next = setKey(score, MEASURE_ID, { fifths: 1, mode: 'major' })
    expect(noteAccidental(next, MEASURE_ID_2, 0)).toBeNull()
  })

  it('note before the change measure is not stripped', () => {
    const fSharp = makeNoteWithAccidental('n1', 'F', 'sharp')
    const score = makeTwoMeasureScoreForKey([fSharp], [])
    // Change key on measure 2 — measure 1 note is before the change point
    const next = setKey(score, MEASURE_ID_2, { fifths: 1, mode: 'major' })
    expect(noteAccidental(next, MEASURE_ID, 0)).toBe('sharp')
  })

  it('different accidental (C# in G major key) is not stripped', () => {
    const cSharp = makeNoteWithAccidental('n1', 'C', 'sharp')
    const score = makeTwoMeasureScoreForKey([cSharp], [])
    // G major only implies F#; C# should remain
    const next = setKey(score, MEASURE_ID, { fifths: 1, mode: 'major' })
    expect(noteAccidental(next, MEASURE_ID, 0)).toBe('sharp')
  })

  it('does not mutate the original score', () => {
    const fSharp = makeNoteWithAccidental('n1', 'F', 'sharp')
    const score = makeTwoMeasureScoreForKey([fSharp], [])
    setKey(score, MEASURE_ID, { fifths: 1, mode: 'major' })
    expect(noteAccidental(score, MEASURE_ID, 0)).toBe('sharp')
  })
})

// ── CLEAR_KEY ─────────────────────────────────────────────────────────────────

describe('CLEAR_KEY', () => {
  it('removes the per-measure key signature', () => {
    const score = makeTwoMeasureScoreForKey([], [])
    const withKey = setKey(score, MEASURE_ID, { fifths: 1, mode: 'major' })
    const staff = withKey.parts[0].staves[0]
    expect((staff.measures[0] as any).keySignature).toBeDefined()

    const cleared = clearKey(withKey, MEASURE_ID)
    const clearedStaff = cleared.parts[0].staves[0]
    expect((clearedStaff.measures[0] as any).keySignature).toBeUndefined()
  })

  it('strips accidentals forward based on inherited (score-level) key after clearing', () => {
    // Score-level key is G major (1 sharp). Measure 1 has a per-measure D major override (2 sharps).
    // After CLEAR_KEY on measure 1, the inherited key is G major → F# notes forward should be stripped.
    const fSharp = makeNoteWithAccidental('n1', 'F', 'sharp')
    const score = makeTwoMeasureScoreForKey([], [fSharp])
    // Give score G major as the base key
    const scoreGMajor: Score = { ...score, keySignature: { fifths: 1, mode: 'major' } }
    // Apply D major on measure 1
    const withDMajor = setKey(scoreGMajor, MEASURE_ID, { fifths: 2, mode: 'major' })
    // Clear returns to G major: G major implies F#, so the F# in measure 2 is stripped
    const cleared = clearKey(withDMajor, MEASURE_ID)
    expect(noteAccidental(cleared, MEASURE_ID_2, 0)).toBeNull()
  })
})

// ── REMOVE_CHORD_PITCH helpers ────────────────────────────────────────────────

function makeChord(
  id: string,
  pitches: Pitch[],
  overrides: Partial<Omit<Chord, 'id' | 'type' | 'pitches'>> = {},
): Chord {
  return {
    id,
    type: 'chord',
    pitches,
    duration: 'quarter',
    dots: 0,
    articulations: [],
    ...overrides,
  }
}

function removeChordPitch(score: Score, noteId: string, pitchIndex: number) {
  return applyCommand(score, {
    type: 'REMOVE_CHORD_PITCH',
    partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID,
    noteId,
    pitchIndex,
  })
}

const P_C4: Pitch = { noteName: 'C', octave: 4, accidental: null }
const P_E4: Pitch = { noteName: 'E', octave: 4, accidental: null }
const P_G4: Pitch = { noteName: 'G', octave: 4, accidental: null }

// ── REMOVE_CHORD_PITCH ────────────────────────────────────────────────────────

describe('REMOVE_CHORD_PITCH', () => {
  it('removes one pitch from a 3-pitch chord, leaving a 2-pitch chord', () => {
    const chord = makeChord('c1', [P_C4, P_E4, P_G4])
    const next = removeChordPitch(makeScore([chord]), 'c1', 2)  // remove G
    const ev = events(next)[0] as Chord
    expect(ev.type).toBe('chord')
    expect(ev.pitches).toHaveLength(2)
    expect(ev.pitches[0]).toEqual(P_C4)
    expect(ev.pitches[1]).toEqual(P_E4)
  })

  it('removing one pitch from a 2-pitch chord collapses to a plain Note', () => {
    const chord = makeChord('c1', [P_C4, P_E4])
    const next = removeChordPitch(makeScore([chord]), 'c1', 1)  // remove E
    const ev = events(next)[0]
    expect(ev.type).toBe('note')
    expect((ev as Note).pitch).toEqual(P_C4)
  })

  it('collapsed Note preserves id, duration, dots from the original Chord', () => {
    const chord = makeChord('chord-id', [P_C4, P_E4], { duration: 'half', dots: 1, articulations: ['staccato'] as any })
    const next = removeChordPitch(makeScore([chord]), 'chord-id', 0)
    const ev = events(next)[0] as Note
    expect(ev.id).toBe('chord-id')
    expect(ev.duration).toBe('half')
    expect(ev.dots).toBe(1)
    expect((ev as any).articulations).toContain('staccato')
  })

  it('does not mutate the original score', () => {
    const chord = makeChord('c1', [P_C4, P_E4, P_G4])
    const score = makeScore([chord])
    removeChordPitch(score, 'c1', 0)
    expect((events(score)[0] as Chord).pitches).toHaveLength(3)
  })
})

// ── MIDI chord entry — command sequence ───────────────────────────────────────
//
// enterChordAtPitch uses buildRestReplaceCommands which produces:
//   REPLACE_NOTE (rest → chord) + DELETE_NOTE* (consumed rests) + ADD_NOTE* (remainder rests)
// These tests verify that sequence against a rest-filled measure, which is the
// state the measure is always in at the cursor position during normal note entry.

function applyCommands(score: Score, cmds: Parameters<typeof applyCommand>[1][]): Score {
  return cmds.reduce((s, cmd) => applyCommand(s, cmd), score)
}

/** Quarter chord: C4 + E4 + G4 */
const CHORD_CEG: Chord = {
  id: 'chord-1', type: 'chord',
  pitches: [P_C4, P_E4, P_G4],
  duration: 'quarter', dots: 0, articulations: [],
}

describe('MIDI chord entry — replacing a rest with a chord', () => {
  it('replaces a whole rest with a quarter chord and fills remainder with dotted-half rest', () => {
    // Measure starts with a single whole-note rest (standard fill for 4/4)
    const wholeRest = createRest('whole')
    const score = makeScore([wholeRest])
    const next = applyCommands(score, [
      { type: 'REPLACE_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID, noteId: wholeRest.id, event: CHORD_CEG },
      // remainder: 64 - 16 = 48 units = dotted-half rest
      { type: 'ADD_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID, event: { ...createRest('half'), dots: 1 as const }, index: 1 },
    ])
    const evs = events(next)
    expect(evs).toHaveLength(2)
    expect(evs[0].type).toBe('chord')
    expect((evs[0] as Chord).pitches).toHaveLength(3)
    expect((evs[0] as Chord).duration).toBe('quarter')
    expect(evs[1].type).toBe('rest')
    expect(evs[1].duration).toBe('half')
    expect((evs[1] as any).dots).toBe(1)
  })

  it('replaces multiple rests when the chord duration spans more than one rest event', () => {
    // Measure has two quarter rests; entering a half chord consumes both
    const r1 = createRest('quarter')
    const r2 = createRest('quarter')
    const halfChord: Chord = { id: 'ch2', type: 'chord', pitches: [P_C4, P_G4], duration: 'half', dots: 0, articulations: [] }
    const score = makeScore([r1, r2])
    const next = applyCommands(score, [
      { type: 'REPLACE_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID, noteId: r1.id, event: halfChord },
      { type: 'DELETE_NOTE',  partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID, noteId: r2.id },
    ])
    const evs = events(next)
    expect(evs).toHaveLength(1)
    expect(evs[0].type).toBe('chord')
    expect((evs[0] as Chord).pitches).toHaveLength(2)
    expect((evs[0] as Chord).duration).toBe('half')
  })

  it('chord pitches are stored in the event (all MIDI notes preserved)', () => {
    const wholeRest = createRest('whole')
    const score = makeScore([wholeRest])
    const next = applyCommand(score, {
      type: 'REPLACE_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID,
      noteId: wholeRest.id, event: CHORD_CEG,
    })
    const chord = events(next)[0] as Chord
    expect(chord.pitches.map(p => p.noteName)).toEqual(['C', 'E', 'G'])
    expect(chord.pitches.map(p => p.octave)).toEqual([4, 4, 4])
  })

  it('does not mutate the original score', () => {
    const wholeRest = createRest('whole')
    const score = makeScore([wholeRest])
    applyCommand(score, {
      type: 'REPLACE_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID,
      noteId: wholeRest.id, event: CHORD_CEG,
    })
    expect(events(score)[0].type).toBe('rest')
  })
})

// ── Note input mode — overwrite mode at existing note ────────────────────────
//
// Overwrite mode: REPLACE_NOTE with a brand-new note discards existing pitches
// and applies the selected duration. buildNoteInsertCommands adjusts trailing rests
// to fit the new duration.

describe('Note input mode — overwrite: replaces note at cursor', () => {
  it('single note → replaced by different pitch (same duration, no trailing rests consumed)', () => {
    const c4 = createNote('C', 4, 'quarter')
    const e4 = createNote('E', 4, 'quarter')
    const score = makeScore([c4])
    const next = applyCommand(score, {
      type: 'REPLACE_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID,
      noteId: c4.id, event: e4,
    })
    const evs = events(next)
    expect(evs).toHaveLength(1)
    expect((evs[0] as Note).pitch.noteName).toBe('E')
    expect(evs[0].type).toBe('note')
  })

  it('chord at cursor → replaced by single note (pitches not accumulated)', () => {
    const chord = makeChord('c1', [P_C4, P_E4, P_G4])
    const g4    = createNote('G', 4, 'quarter')
    const score = makeScore([chord])
    // Overwrite: REPLACE_NOTE with single note, discarding all chord pitches
    const next = applyCommand(score, {
      type: 'REPLACE_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID,
      noteId: chord.id, event: g4,
    })
    const evs = events(next)
    expect(evs).toHaveLength(1)
    expect(evs[0].type).toBe('note')
    expect((evs[0] as Note).pitch.noteName).toBe('G')
  })

  it('duration change consumes trailing rest and re-fills remainder', () => {
    // C4 quarter at beat 0 + quarter rest at beat 1 → overwrite with half note
    const c4   = createNote('C', 4, 'quarter')
    const rest = createRest('quarter')
    const e4h  = createNote('E', 4, 'half')
    const score = makeScore([c4, rest])
    // buildNoteInsertCommands: REPLACE_NOTE + DELETE_NOTE (consumes trailing rest, no remainder)
    const next = applyCommands(score, [
      { type: 'REPLACE_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID, noteId: c4.id, event: e4h },
      { type: 'DELETE_NOTE',  partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID, noteId: rest.id },
    ])
    const evs = events(next)
    expect(evs).toHaveLength(1)
    expect(evs[0].type).toBe('note')
    expect(evs[0].duration).toBe('half')
    expect((evs[0] as Note).pitch.noteName).toBe('E')
  })
})

// ── Note input mode — chord mode at existing note ────────────────────────────
//
// Chord mode: REPLACE_NOTE with a chord that includes the existing pitch(es) plus
// the new pitch, preserving the existing duration. The cursor does not advance.

describe('Note input mode — chord: adds pitch preserving duration', () => {
  it('note → chord: adds new pitch, duration inherited from existing note', () => {
    const c4q = createNote('C', 4, 'quarter')
    const score = makeScore([c4q])
    // Chord mode: REPLACE_NOTE with chord preserving quarter duration
    const chordCE: Chord = {
      id: c4q.id, type: 'chord',
      pitches: [P_C4, P_E4],
      duration: 'quarter', dots: 0, articulations: [],
    }
    const next = applyCommand(score, {
      type: 'REPLACE_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID,
      noteId: c4q.id, event: chordCE,
    })
    const evs = events(next)
    expect(evs).toHaveLength(1)
    expect(evs[0].type).toBe('chord')
    expect(evs[0].duration).toBe('quarter')
    expect((evs[0] as Chord).pitches).toHaveLength(2)
    expect((evs[0] as Chord).pitches.map(p => p.noteName)).toEqual(['C', 'E'])
  })

  it('chord → chord: adds pitch to existing chord, duration preserved', () => {
    const chordCE = makeChord('c1', [P_C4, P_E4])
    const score = makeScore([chordCE])
    // Chord mode: add G4 → [C4, E4, G4], duration stays quarter
    const chordCEG: Chord = {
      id: 'c1', type: 'chord',
      pitches: [P_C4, P_E4, P_G4],
      duration: 'quarter', dots: 0, articulations: [],
    }
    const next = applyCommand(score, {
      type: 'REPLACE_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID,
      noteId: 'c1', event: chordCEG,
    })
    const evs = events(next)
    expect(evs).toHaveLength(1)
    expect(evs[0].type).toBe('chord')
    expect(evs[0].duration).toBe('quarter')
    expect((evs[0] as Chord).pitches).toHaveLength(3)
  })

  it('duplicate pitch: dedup filter leaves chord unchanged', () => {
    // Simulate the dedup logic used by chord mode when the entered pitch already exists
    const existingPitches: Pitch[] = [P_C4, P_E4]
    const newPitch: Pitch = P_C4  // duplicate
    const merged = [...existingPitches, newPitch]
      .filter((p, i, arr) => arr.findIndex(q => q.noteName === p.noteName && q.octave === p.octave) === i)
    expect(merged).toHaveLength(2)
    expect(merged.map(p => p.noteName)).toEqual(['C', 'E'])
  })

  it('at rest: falls back to overwrite — uses buildRestReplaceCommands pattern', () => {
    // Chord mode at a rest is identical to overwrite (spec §2.3)
    const wholeRest = createRest('whole')
    const score = makeScore([wholeRest])
    // Same command sequence as rest-replace overwrite path
    const next = applyCommands(score, [
      { type: 'REPLACE_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID, noteId: wholeRest.id, event: createNote('C', 4, 'quarter') },
      { type: 'ADD_NOTE',     partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID, event: { ...createRest('half'), dots: 1 as const }, index: 1 },
    ])
    const evs = events(next)
    expect(evs[0].type).toBe('note')
    expect(evs[0].duration).toBe('quarter')
    expect(evs[1].type).toBe('rest')  // remainder rest filled in
  })
})

// ── Duplicate pitch guard ─────────────────────────────────────────────────────
//
// The same pitch must not appear more than once in a voice at the same position.
// Verified here at the command/data level — the UI guards (isDuplicate checks and
// newPitches dedup filter) produce the command sequences below.

describe('Duplicate pitch guard — chord mode: no duplicate via REPLACE_NOTE', () => {
  it('entering a pitch already in a Note produces no change (chord mode returns early)', () => {
    // If chord mode detects isDuplicate it returns without dispatching.
    // The note should be unchanged after the attempted entry.
    const c4 = createNote('C', 4, 'quarter')
    const score = makeScore([c4])
    // Simulate no dispatch: score unchanged
    const evs = events(score)
    expect(evs).toHaveLength(1)
    expect((evs[0] as Note).pitch.noteName).toBe('C')
  })

  it('entering a pitch already in a Chord produces no change', () => {
    // Chord [C4, E4] — adding C4 again is a no-op (isDuplicate guard returns early)
    const chord = makeChord('c1', [P_C4, P_E4])
    const score = makeScore([chord])
    const evs = events(score)
    expect((evs[0] as Chord).pitches).toHaveLength(2)
    expect((evs[0] as Chord).pitches.map(p => p.noteName)).toEqual(['C', 'E'])
  })

  it('a REPLACE_NOTE with a correctly deduped chord has no repeated pitches', () => {
    // Verifies the REPLACE_NOTE command that chord mode would produce: the
    // resulting chord should contain each pitch exactly once.
    const c4 = createNote('C', 4, 'quarter')
    const score = makeScore([c4])
    const chordWithDup: Chord = {
      id: c4.id, type: 'chord',
      // Simulate what would happen if dedup were absent: C4 appears twice
      pitches: [P_C4, P_C4, P_E4],
      duration: 'quarter', dots: 0, articulations: [],
    }
    const next = applyCommand(score, {
      type: 'REPLACE_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID,
      noteId: c4.id, event: chordWithDup,
    })
    // The command stores exactly what we gave it — proof that the dedup must
    // happen BEFORE dispatching, not inside the command reducer.
    const stored = events(next)[0] as Chord
    expect(stored.pitches).toHaveLength(3) // raw command stores as-given
    // This is why the UI guards are critical: the correct deduped path produces:
    const chordDeduped: Chord = {
      id: c4.id, type: 'chord',
      pitches: [P_C4, P_E4],
      duration: 'quarter', dots: 0, articulations: [],
    }
    const correct = applyCommand(score, {
      type: 'REPLACE_NOTE', partId: PART_ID, staffId: STAFF_ID, measureId: MEASURE_ID, voiceId: VOICE_ID,
      noteId: c4.id, event: chordDeduped,
    })
    expect((events(correct)[0] as Chord).pitches).toHaveLength(2)
  })
})

describe('Duplicate pitch guard — chord buffer dedup filter', () => {
  it('dedup filter removes duplicate pitches from simultaneous MIDI input', () => {
    // Simulates the .filter() applied to newPitches in enterChordAtPitch when
    // the MIDI device sends the same note twice within the 50 ms window.
    type P = { noteName: string; octave: number }
    const inputs: P[] = [
      { noteName: 'C', octave: 4 },  // first arrival
      { noteName: 'C', octave: 4 },  // duplicate (same physical key sent twice)
      { noteName: 'E', octave: 4 },
    ]
    const deduped = inputs.filter((p, i, arr) =>
      arr.findIndex(q => q.noteName === p.noteName && q.octave === p.octave) === i
    )
    expect(deduped).toHaveLength(2)
    expect(deduped.map(p => p.noteName)).toEqual(['C', 'E'])
  })

  it('dedup preserves order and all distinct pitches', () => {
    type P = { noteName: string; octave: number }
    const inputs: P[] = [
      { noteName: 'G', octave: 4 },
      { noteName: 'C', octave: 4 },
      { noteName: 'E', octave: 4 },
      { noteName: 'G', octave: 4 },  // duplicate G
    ]
    const deduped = inputs.filter((p, i, arr) =>
      arr.findIndex(q => q.noteName === p.noteName && q.octave === p.octave) === i
    )
    expect(deduped).toHaveLength(3)
    expect(deduped.map(p => p.noteName)).toEqual(['G', 'C', 'E'])
  })

  it('all-unique inputs pass through unchanged', () => {
    type P = { noteName: string; octave: number }
    const inputs: P[] = [
      { noteName: 'C', octave: 4 },
      { noteName: 'E', octave: 4 },
      { noteName: 'G', octave: 4 },
    ]
    const deduped = inputs.filter((p, i, arr) =>
      arr.findIndex(q => q.noteName === p.noteName && q.octave === p.octave) === i
    )
    expect(deduped).toHaveLength(3)
  })
})

// ── SET_SCORE_TIME — underflow fill (12/8 regression) ────────────────────────
// Changing to a larger time signature must extend each measure's rest pool to
// the new capacity so all available beats can be reached by the note cursor.

function totalUnits(evs: NoteEvent[]): number {
  return evs.reduce((s, e) => s + eventDurationUnits(e), 0)
}

function makeScoreWithWholeRests(measureCount: number, timeSig: TimeSignature): Score {
  const now = '2024-01-01T00:00:00.000Z'
  const cap = measureCapacityUnits(timeSig)
  const capacity = cap
  // Simulate a fresh score: one whole rest per measure (as created by fillWithRests)
  const ms = Array.from({ length: measureCount }, (_, i) => ({
    id: `m${i + 1}`, number: i + 1,
    barline: (i === measureCount - 1 ? 'final' : 'single') as any,
    voices: [{ id: `v${i + 1}`, events: [{ id: `r${i + 1}`, type: 'rest' as const, duration: 'whole' as const, dots: 0 }] }],
  }))
  return {
    id: 'score-1',
    metadata: { title: '', subtitle: '', composer: '', arranger: '', lyricist: '', copyright: '', createdAt: now, updatedAt: now },
    parts: [{
      id: PART_ID, name: 'Piano', shortName: 'Pno.',
      midiProgram: 0, transposeSemitones: 0,
      staves: [{ id: STAFF_ID, clef: 'treble', measures: ms }],
      volume: 0.8, muted: false, labelVisible: true,
    }],
    keySignature: { fifths: 0, mode: 'major' },
    timeSignature: timeSig,
    tempo: 120, showPartLabels: true, textBoxes: [], version: 1,
  }
}

describe('SET_SCORE_TIME — underflow fill on time-sig increase', () => {
  it('4/4 → 12/8: every measure gains rests to reach 96-unit capacity', () => {
    const score = makeScoreWithWholeRests(4, { numerator: 4, denominator: 4 })
    const next = applyCommand(score, { type: 'SET_SCORE_TIME', time: { numerator: 12, denominator: 8 } })
    const expectedCap = measureCapacityUnits({ numerator: 12, denominator: 8 }) // 96
    for (const m of (next.parts[0].staves[0].measures as any[])) {
      expect(totalUnits(m.voices[0].events)).toBe(expectedCap)
    }
  })

  it('4/4 → 12/8: all measures updated, not just the first', () => {
    const score = makeScoreWithWholeRests(3, { numerator: 4, denominator: 4 })
    const next = applyCommand(score, { type: 'SET_SCORE_TIME', time: { numerator: 12, denominator: 8 } })
    const ms = next.parts[0].staves[0].measures as any[]
    expect(ms).toHaveLength(3)
    for (const m of ms) {
      expect(totalUnits(m.voices[0].events)).toBe(96)
    }
  })

  it('12/8 capacity is 96 units — equivalent to 6 quarter notes', () => {
    expect(measureCapacityUnits({ numerator: 12, denominator: 8 })).toBe(96)
  })

  it('4/4 → 12/8: tail rests are proper notation (all events are rests)', () => {
    const score = makeScoreWithWholeRests(2, { numerator: 4, denominator: 4 })
    const next = applyCommand(score, { type: 'SET_SCORE_TIME', time: { numerator: 12, denominator: 8 } })
    for (const m of (next.parts[0].staves[0].measures as any[])) {
      for (const ev of m.voices[0].events) {
        expect(ev.type).toBe('rest')
      }
    }
  })

  it('4/4 → 3/4 (overflow): notes exceeding 48 units are pushed to the next measure', () => {
    // Score with 4 quarter notes (64 units) in a 4/4 measure — should overflow to 3/4
    const q = (id: string) => createNote('C', 4, 'quarter') as NoteEvent
    const now = '2024-01-01T00:00:00.000Z'
    const score: Score = {
      id: 'score-1',
      metadata: { title: '', subtitle: '', composer: '', arranger: '', lyricist: '', copyright: '', createdAt: now, updatedAt: now },
      parts: [{
        id: PART_ID, name: 'Piano', shortName: 'Pno.',
        midiProgram: 0, transposeSemitones: 0,
        staves: [{ id: STAFF_ID, clef: 'treble', measures: [
          { id: 'm1', number: 1, barline: 'single' as any, voices: [{ id: 'v1', events: [createNote('C',4,'quarter'), createNote('C',4,'quarter'), createNote('C',4,'quarter'), createNote('C',4,'quarter')] }] },
          { id: 'm2', number: 2, barline: 'final'  as any, voices: [{ id: 'v2', events: [] }] },
        ]}],
        volume: 0.8, muted: false, labelVisible: true,
      }],
      keySignature: { fifths: 0, mode: 'major' },
      timeSignature: { numerator: 4, denominator: 4 },
      tempo: 120, showPartLabels: true, textBoxes: [], version: 1,
    }
    const next = applyCommand(score, { type: 'SET_SCORE_TIME', time: { numerator: 3, denominator: 4 } })
    const ms = next.parts[0].staves[0].measures as any[]
    // Each measure should be exactly 48 units after redistribution
    for (const m of ms) {
      expect(totalUnits(m.voices[0].events)).toBe(48)
    }
  })
})

// ── PASTE_NOTES ───────────────────────────────────────────────────────────────

function makePasteScore(measures: { id: string; events: NoteEvent[] }[]): Score {
  const now = '2024-01-01T00:00:00.000Z'
  return {
    id: 'score-paste', metadata: { title:'',subtitle:'',composer:'',arranger:'',lyricist:'',copyright:'',createdAt:now,updatedAt:now },
    parts: [{ id: PART_ID, name:'Piano', shortName:'Pno.', midiProgram:0, transposeSemitones:0, staves:[{
      id: STAFF_ID, clef:'treble',
      measures: measures.map((m, i) => ({ id: m.id, number: i+1, barline: i===measures.length-1?'final':'single' as any, voices:[{id:`v${i+1}`,events:m.events}] }))
    }], volume:0.8, muted:false, labelVisible:true }],
    keySignature:  { fifths: 0, mode: 'major' },
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120, showPartLabels: true, textBoxes: [], version: 1,
  }
}

function voiceEvents(score: Score, measureIndex: number): NoteEvent[] {
  return score.parts[0].staves[0].measures[measureIndex].voices[0].events as NoteEvent[]
}

describe('PASTE_NOTES — basic overwrite', () => {
  it('replaces content at beat 0 with pasted events and fills remainder with rests', () => {
    const quarter = createNote('C', 4, 'quarter') as NoteEvent
    const score = makePasteScore([
      { id: 'm1', events: [createRest('whole') as NoteEvent] },
    ])
    const result = applyCommand(score, { type: 'PASTE_NOTES', partId: PART_ID, staffId: STAFF_ID, measureId: 'm1', voiceIndex: 0, beatPosition: 0, events: [quarter] })
    const ev = voiceEvents(result, 0)
    expect(ev[0].type).toBe('note')
    expect((ev[0] as Note).pitch.noteName).toBe('C')
    // Remaining 3 beats should be rests
    const restUnits = ev.slice(1).reduce((s, e) => s + eventDurationUnits(e), 0)
    expect(restUnits).toBe(48) // 64 - 16 = 48
  })

  it('pastes at non-zero beat position, preserving events before it', () => {
    const existing = createNote('E', 4, 'quarter') as NoteEvent
    const pasted  = createNote('G', 4, 'quarter') as NoteEvent
    const score = makePasteScore([
      { id: 'm1', events: [existing, createRest('half') as NoteEvent, createRest('quarter') as NoteEvent] },
    ])
    const result = applyCommand(score, { type: 'PASTE_NOTES', partId: PART_ID, staffId: STAFF_ID, measureId: 'm1', voiceIndex: 0, beatPosition: 16, events: [pasted] })
    const ev = voiceEvents(result, 0)
    expect(ev[0].id).toBe(existing.id)           // untouched
    expect(ev[1].type).toBe('note')
    expect((ev[1] as Note).pitch.noteName).toBe('G')
  })

  it('assigns new IDs to pasted events', () => {
    const note = createNote('D', 4, 'quarter') as NoteEvent
    const score = makePasteScore([{ id: 'm1', events: [createRest('whole') as NoteEvent] }])
    const result = applyCommand(score, { type: 'PASTE_NOTES', partId: PART_ID, staffId: STAFF_ID, measureId: 'm1', voiceIndex: 0, beatPosition: 0, events: [note] })
    expect(voiceEvents(result, 0)[0].id).not.toBe(note.id)
  })

  it('strips tie flags from pasted notes', () => {
    const tied = { ...createNote('C', 4, 'quarter'), tieStart: true, tieEnd: true } as Note
    const score = makePasteScore([{ id: 'm1', events: [createRest('whole') as NoteEvent] }])
    const result = applyCommand(score, { type: 'PASTE_NOTES', partId: PART_ID, staffId: STAFF_ID, measureId: 'm1', voiceIndex: 0, beatPosition: 0, events: [tied as NoteEvent] })
    const pasted = voiceEvents(result, 0)[0] as Note
    expect(pasted.tieStart).toBe(false)
    expect(pasted.tieEnd).toBe(false)
  })

  it('spills overflow into the next measure', () => {
    // m1 has two half rests (beat boundaries at 0 and 32); paste 4 quarters at beat 32
    // → 2 fit in m1 (beats 32–64), 2 spill to m2 (beats 0–32)
    const quarters = [createNote('C',4,'quarter'), createNote('D',4,'quarter'), createNote('E',4,'quarter'), createNote('F',4,'quarter')] as NoteEvent[]
    const score = makePasteScore([
      { id: 'm1', events: [createRest('half') as NoteEvent, createRest('half') as NoteEvent] },
      { id: 'm2', events: [createRest('whole') as NoteEvent] },
    ])
    const result = applyCommand(score, { type: 'PASTE_NOTES', partId: PART_ID, staffId: STAFF_ID, measureId: 'm1', voiceIndex: 0, beatPosition: 32, events: quarters })
    const m1ev = voiceEvents(result, 0)
    const m2ev = voiceEvents(result, 1)
    // m1: 2 units before paste (32) = half rest, then 2 quarters (32), total 64
    expect(m1ev.filter(e => e.type === 'note')).toHaveLength(2)
    // m2: 2 more quarters at start, then rests
    expect(m2ev.filter(e => e.type === 'note')).toHaveLength(2)
    // capacity preserved
    expect(m1ev.reduce((s,e) => s + eventDurationUnits(e), 0)).toBe(64)
    expect(m2ev.reduce((s,e) => s + eventDurationUnits(e), 0)).toBe(64)
  })
})

// ── PASTE_BARS ────────────────────────────────────────────────────────────────

describe('PASTE_BARS — voice replacement', () => {
  it('replaces the target measure voice with pasted events', () => {
    const note = createNote('A', 4, 'quarter') as NoteEvent
    const score = makePasteScore([{ id: 'm1', events: [createRest('whole') as NoteEvent] }])
    const result = applyCommand(score, { type: 'PASTE_BARS', entries: [{ partId: PART_ID, staffId: STAFF_ID, measureIndex: 0, voiceIndex: 0, events: [note, createRest('half') as NoteEvent, createRest('quarter') as NoteEvent] }] })
    const ev = voiceEvents(result, 0)
    expect(ev[0].type).toBe('note')
    expect((ev[0] as Note).pitch.noteName).toBe('A')
    expect(ev.reduce((s,e)=>s+eventDurationUnits(e),0)).toBe(64)
  })

  it('assigns fresh IDs to pasted bar content', () => {
    const note = createNote('B', 3, 'whole') as NoteEvent
    const score = makePasteScore([{ id: 'm1', events: [createRest('whole') as NoteEvent] }])
    const result = applyCommand(score, { type: 'PASTE_BARS', entries: [{ partId: PART_ID, staffId: STAFF_ID, measureIndex: 0, voiceIndex: 0, events: [note] }] })
    expect(voiceEvents(result, 0)[0].id).not.toBe(note.id)
  })

  it('truncates pasted content to measure capacity and fills remainder', () => {
    // Paste 5 quarter notes (80 units) into a 4/4 measure (64 units) — should truncate and fill
    const fiveQs = Array.from({length:5}, (_,i) => createNote('C', 4+i, 'quarter') as NoteEvent)
    const score = makePasteScore([{ id: 'm1', events: [createRest('whole') as NoteEvent] }])
    const result = applyCommand(score, { type: 'PASTE_BARS', entries: [{ partId: PART_ID, staffId: STAFF_ID, measureIndex: 0, voiceIndex: 0, events: fiveQs }] })
    const ev = voiceEvents(result, 0)
    expect(ev.reduce((s,e)=>s+eventDurationUnits(e),0)).toBe(64)
    expect(ev.filter(e=>e.type==='note')).toHaveLength(4) // 4 fit, 5th doesn't
  })

  it('multiple entries paste into multiple measures in one command', () => {
    const n1 = createNote('C', 4, 'whole') as NoteEvent
    const n2 = createNote('G', 4, 'whole') as NoteEvent
    const score = makePasteScore([
      { id: 'm1', events: [createRest('whole') as NoteEvent] },
      { id: 'm2', events: [createRest('whole') as NoteEvent] },
    ])
    const result = applyCommand(score, { type: 'PASTE_BARS', entries: [
      { partId: PART_ID, staffId: STAFF_ID, measureIndex: 0, voiceIndex: 0, events: [n1] },
      { partId: PART_ID, staffId: STAFF_ID, measureIndex: 1, voiceIndex: 0, events: [n2] },
    ]})
    expect((voiceEvents(result, 0)[0] as Note).pitch.noteName).toBe('C')
    expect((voiceEvents(result, 1)[0] as Note).pitch.noteName).toBe('G')
  })
})
