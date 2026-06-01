// Tests for score command reducers — P1 coverage for DELETE_NOTE.
// DELETE_NOTE must clean up tie chain flags and remove referencing slurs.

import { describe, it, expect } from 'vitest'
import { applyCommand } from '@shared/commands'
import type { Score, Note, NoteEvent, Slur } from '@shared/score'

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
