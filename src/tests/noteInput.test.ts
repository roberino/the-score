// Functional tests for the note input pipeline:
//   duration arithmetic (guards note placement logic)
//   score commands (ADD_NOTE) that the MIDI handler ultimately drives
//   measure-full guard (remainingUnits controls whether a MIDI note is accepted)
//
// createScore() pre-fills each measure with whole-note rests. Tests that count
// events filter by type ('note' vs 'rest') to stay independent of that detail.

import { describe, it, expect } from 'vitest'
import {
  DURATION_UNITS, dottedUnits, measureCapacityUnits,
  remainingUnits, firstRestBeat, eventDurationUnits,
} from '@shared/musicUtils'
import { createScore, createNote, createRest, createMeasure, type Duration } from '@shared/score'
import { applyCommand } from '@shared/commands'

// ── Duration arithmetic ───────────────────────────────────────────────────────

describe('DURATION_UNITS', () => {
  it('whole note fills a 4/4 measure exactly (64 units)', () => {
    expect(DURATION_UNITS['whole']).toBe(64)
  })

  it('duration hierarchy is consistent — each value doubles the next shorter', () => {
    const order: Duration[] = ['64th', '32nd', '16th', 'eighth', 'quarter', 'half', 'whole']
    for (let i = 1; i < order.length; i++) {
      expect(DURATION_UNITS[order[i]]).toBe(DURATION_UNITS[order[i - 1]] * 2)
    }
  })
})

describe('dottedUnits', () => {
  it('no dot: returns base unchanged', () => {
    expect(dottedUnits(16, 0)).toBe(16)
  })

  it('single dot: adds half the base', () => {
    expect(dottedUnits(16, 1)).toBe(24)  // dotted quarter = 1.5×
    expect(dottedUnits(32, 1)).toBe(48)
  })

  it('double dot: adds half + quarter of base', () => {
    expect(dottedUnits(16, 2)).toBe(28)  // 16 + 8 + 4
    expect(dottedUnits(32, 2)).toBe(56)
  })
})

// ── Measure capacity and remaining units ─────────────────────────────────────

describe('measureCapacityUnits', () => {
  it('4/4 = 64 units', ()   => { expect(measureCapacityUnits({ numerator: 4, denominator: 4 })).toBe(64) })
  it('3/4 = 48 units', ()   => { expect(measureCapacityUnits({ numerator: 3, denominator: 4 })).toBe(48) })
  it('6/8 = 48 units', ()   => { expect(measureCapacityUnits({ numerator: 6, denominator: 8 })).toBe(48) })
  it('2/2 = 64 units', ()   => { expect(measureCapacityUnits({ numerator: 2, denominator: 2 })).toBe(64) })
})

describe('remainingUnits — gate that controls whether a MIDI note is accepted', () => {
  const sig44 = { numerator: 4, denominator: 4 }

  it('empty measure: all 64 units remain', () => {
    expect(remainingUnits([], sig44)).toBe(64)
  })

  it('quarter note placed: 48 units remain', () => {
    const quarter = createNote('C', 4, 'quarter')
    expect(remainingUnits([quarter], sig44)).toBe(48)
  })

  it('four quarters fill the measure: 0 units remain', () => {
    const events = ['C', 'D', 'E', 'F'].map(n =>
      createNote(n as import('@shared/score').NoteName, 4, 'quarter')
    )
    expect(remainingUnits(events, sig44)).toBe(0)
  })

  it('dotted quarter + eighth = 32 units used → 32 remain', () => {
    const dottedQ = { ...createNote('C', 4, 'quarter'), dots: 1 as 1 }
    const eighth  = createNote('D', 4, 'eighth')
    expect(eventDurationUnits(dottedQ)).toBe(24)
    expect(eventDurationUnits(eighth)).toBe(8)
    expect(remainingUnits([dottedQ, eighth], sig44)).toBe(32)
  })

  it('rejects a note whose units exceed remaining capacity', () => {
    // Three quarters placed → 16 units left; a half note (32) should be rejected.
    const threeQ = ['C', 'D', 'E'].map(n =>
      createNote(n as import('@shared/score').NoteName, 4, 'quarter')
    )
    const remaining = remainingUnits(threeQ, sig44)
    expect(remaining).toBe(16)
    expect(remaining < DURATION_UNITS['half']).toBe(true)     // half rejected
    expect(remaining < DURATION_UNITS['quarter']).toBe(false) // quarter accepted
  })
})

// ── firstRestBeat — cursor placement after note entry ────────────────────────

describe('firstRestBeat', () => {
  it('empty voice: cursor at beat 0', () => {
    expect(firstRestBeat([])).toBe(0)
  })

  it('one quarter note: cursor advances to beat 16', () => {
    expect(firstRestBeat([createNote('C', 4, 'quarter')])).toBe(16)
  })

  it('note followed by rest: cursor lands at start of rest', () => {
    const note = createNote('C', 4, 'quarter')
    const rest = createRest('quarter')
    expect(firstRestBeat([note, rest])).toBe(16)
  })

  it('two notes, no rests: cursor at end of second note', () => {
    const events = [createNote('C', 4, 'quarter'), createNote('D', 4, 'quarter')]
    expect(firstRestBeat(events)).toBe(32)
  })
})

// ── Score commands — ADD_NOTE (the MIDI handler's output) ─────────────────────
//
// createScore() pre-fills each measure with rests. The helpers below look at
// only the 'note' type events so tests don't break if the default fill changes.

function notesIn(events: readonly import('@shared/score').NoteEvent[]) {
  return events.filter(e => e.type === 'note')
}

describe('ADD_NOTE command', () => {
  it('appends a note to a measure', () => {
    const score   = createScore()
    const part    = score.parts[0]
    const staff   = part.staves[0]
    const measure = staff.measures[0]
    const voice   = measure.voices[0]

    const next   = applyCommand(score, {
      type: 'ADD_NOTE', partId: part.id, staffId: staff.id,
      measureId: measure.id, voiceId: voice.id,
      event: createNote('G', 4, 'eighth'),
    })

    const notes = notesIn(next.parts[0].staves[0].measures[0].voices[0].events)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ type: 'note', pitch: { noteName: 'G', octave: 4 }, duration: 'eighth' })
  })

  it('accumulates notes in sequence', () => {
    let score = createScore()
    const { id: partId }    = score.parts[0]
    const { id: staffId }   = score.parts[0].staves[0]
    const { id: measureId } = score.parts[0].staves[0].measures[0]
    const { id: voiceId }   = score.parts[0].staves[0].measures[0].voices[0]

    const add = (s: typeof score, noteName: import('@shared/score').NoteName) =>
      applyCommand(s, {
        type: 'ADD_NOTE', partId, staffId, measureId, voiceId,
        event: createNote(noteName, 4, 'quarter'),
      })

    score = add(score, 'C')
    score = add(score, 'D')
    score = add(score, 'E')

    const notes = notesIn(score.parts[0].staves[0].measures[0].voices[0].events)
    expect(notes).toHaveLength(3)
    expect(notes.map((e: any) => e.pitch.noteName)).toEqual(['C', 'D', 'E'])
  })

  it('does not mutate the original score', () => {
    const score   = createScore()
    const part    = score.parts[0]
    const staff   = part.staves[0]
    const measure = staff.measures[0]
    const voice   = measure.voices[0]
    const before  = voice.events.length

    applyCommand(score, {
      type: 'ADD_NOTE', partId: part.id, staffId: staff.id,
      measureId: measure.id, voiceId: voice.id,
      event: createNote('A', 4, 'quarter'),
    })

    expect(voice.events).toHaveLength(before) // original unchanged
  })

  it('stores the accidental from a sharp MIDI note', () => {
    const score   = createScore()
    const part    = score.parts[0]
    const staff   = part.staves[0]
    const measure = staff.measures[0]
    const voice   = measure.voices[0]
    const cSharp  = createNote('C', 4, 'quarter', 'sharp')

    const next  = applyCommand(score, {
      type: 'ADD_NOTE', partId: part.id, staffId: staff.id,
      measureId: measure.id, voiceId: voice.id, event: cSharp,
    })
    const notes = notesIn(next.parts[0].staves[0].measures[0].voices[0].events)
    expect(notes[0]).toMatchObject({ pitch: { noteName: 'C', accidental: 'sharp' } })
  })
})
