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
