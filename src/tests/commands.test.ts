// Tests for score command reducers — P1 coverage for DELETE_NOTE.
// DELETE_NOTE must clean up tie chain flags and remove referencing slurs.

import { describe, it, expect } from 'vitest'
import { applyCommand } from '@shared/commands'
import type { Score, Note, NoteEvent, Slur, Duration } from '@shared/score'
import { createRest } from '@shared/score'

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
