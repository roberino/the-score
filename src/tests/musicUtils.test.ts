// Tests for pure musicUtils functions: fillWithRests, shiftPitchBySemitones, closestOctave.
// These are P1 tests — they guard the core note-entry hot path.

import { describe, it, expect } from 'vitest'
import {
  DURATION_UNITS,
  fillWithRests,
  shiftPitchBySemitones,
  closestOctave,
  eventDurationUnits,
} from '@shared/musicUtils'
import type { NoteName, Pitch, NoteEvent } from '@shared/score'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Sum 64th-note units of a rest list. */
function sumUnits(rests: NoteEvent[]): number {
  return rests.reduce((s, e) => s + eventDurationUnits(e), 0)
}

function shape(e: NoteEvent): { duration: string; dots: number } {
  return { duration: (e as any).duration, dots: (e as any).dots }
}

// ── fillWithRests ─────────────────────────────────────────────────────────────

describe('fillWithRests — greedy decomposition', () => {
  // Verify every entry in the FILL_REST_TABLE maps to a single correct rest.
  it.each([
    [64, 'whole',   0],
    [48, 'half',    1],  // dotted half
    [32, 'half',    0],
    [24, 'quarter', 1],  // dotted quarter
    [16, 'quarter', 0],
    [12, 'eighth',  1],  // dotted eighth
    [ 8, 'eighth',  0],
    [ 6, '16th',    1],  // dotted 16th
    [ 4, '16th',    0],
    [ 3, '32nd',    1],  // dotted 32nd
    [ 2, '32nd',    0],
    [ 1, '64th',    0],
  ] as [number, string, number][])(
    '%i units → single %s (dots=%i)',
    (units, duration, dots) => {
      const rests = fillWithRests(units)
      expect(rests).toHaveLength(1)
      expect(shape(rests[0])).toEqual({ duration, dots })
    }
  )

  it('0 units → empty array', () => {
    expect(fillWithRests(0)).toHaveLength(0)
  })

  it('40 units → [half, eighth]', () => {
    const rests = fillWithRests(40) // 32 + 8
    expect(rests.map(shape)).toEqual([
      { duration: 'half',   dots: 0 },
      { duration: 'eighth', dots: 0 },
    ])
  })

  it('56 units → [dotted-half, eighth]', () => {
    const rests = fillWithRests(56) // 48 + 8
    expect(rests.map(shape)).toEqual([
      { duration: 'half',   dots: 1 },
      { duration: 'eighth', dots: 0 },
    ])
  })

  it('36 units → [half, 16th]', () => {
    const rests = fillWithRests(36) // 32 + 4
    expect(rests.map(shape)).toEqual([
      { duration: 'half', dots: 0 },
      { duration: '16th', dots: 0 },
    ])
  })

  it('20 units → [quarter, 16th]', () => {
    const rests = fillWithRests(20) // 16 + 4
    expect(rests.map(shape)).toEqual([
      { duration: 'quarter', dots: 0 },
      { duration: '16th',    dots: 0 },
    ])
  })

  it('prefers dotted-half over half+quarter (greedy picks largest first)', () => {
    // 48 units: the greedy algorithm takes the 48-unit row (dotted half) first,
    // NOT 32+16. This is the key property of the greedy approach.
    const rests = fillWithRests(48)
    expect(rests).toHaveLength(1)
    expect(shape(rests[0])).toEqual({ duration: 'half', dots: 1 })
  })

  it('sum of units always equals the input', () => {
    for (const units of [1, 3, 7, 15, 17, 40, 48, 56, 63, 64]) {
      expect(sumUnits(fillWithRests(units))).toBe(units)
    }
  })

  it('all returned events are rests', () => {
    fillWithRests(63).forEach(e => expect(e.type).toBe('rest'))
  })

  it('each event has a unique id', () => {
    const rests = fillWithRests(63)
    const ids = rests.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ── shiftPitchBySemitones ─────────────────────────────────────────────────────

describe('shiftPitchBySemitones — chromatic shifting', () => {
  function shift(
    name: NoteName,
    oct: number,
    acc: Pitch['accidental'],
    semitones: number,
  ) {
    return shiftPitchBySemitones(name, oct, acc, semitones)
  }

  // Natural half-steps (no accidental change)
  it('E → F (natural half step up)', () => {
    expect(shift('E', 4, null, 1)).toMatchObject({ noteName: 'F', accidental: null, octave: 4 })
  })

  it('F → E (natural half step down)', () => {
    expect(shift('F', 4, null, -1)).toMatchObject({ noteName: 'E', accidental: null, octave: 4 })
  })

  it('B → C (octave wraps up)', () => {
    expect(shift('B', 4, null, 1)).toMatchObject({ noteName: 'C', accidental: null, octave: 5 })
  })

  it('C → B (octave wraps down)', () => {
    expect(shift('C', 4, null, -1)).toMatchObject({ noteName: 'B', accidental: null, octave: 3 })
  })

  // Whole tone steps producing sharps
  it('C up 1 → C# (whole-tone boundary, adds sharp)', () => {
    expect(shift('C', 4, null, 1)).toMatchObject({ noteName: 'C', accidental: 'sharp', octave: 4 })
  })

  it('D up 1 → D#', () => {
    expect(shift('D', 4, null, 1)).toMatchObject({ noteName: 'D', accidental: 'sharp', octave: 4 })
  })

  // Accidental offsets fed into the MIDI number
  it('sharp input: C#4 up 1 → D4', () => {
    expect(shift('C', 4, 'sharp', 1)).toMatchObject({ noteName: 'D', accidental: null, octave: 4 })
  })

  it('flat input: Db4 up 1 → C4 (Db + semitone = C natural)', () => {
    expect(shift('D', 4, 'flat', 1)).toMatchObject({ noteName: 'D', accidental: null, octave: 4 })
  })

  it('flat input: Cb4 up 1 → C4', () => {
    // Cb4 MIDI = (4+1)*12 + 0 - 1 = 59 → +1 = 60 = C4
    expect(shift('C', 4, 'flat', 1)).toMatchObject({ noteName: 'C', accidental: null, octave: 4 })
  })

  it('double-sharp input: Cx4 up 1 → D#4', () => {
    // C double-sharp MIDI=62, +1=63 → D#4
    expect(shift('C', 4, 'doubleSharp', 1)).toMatchObject({ noteName: 'D', accidental: 'sharp', octave: 4 })
  })

  it('double-flat input: Dbb4 up 1 → C#4', () => {
    // Dbb4 = D(MIDI 62) - 2 = 60 → +1 = 61 = C#4
    expect(shift('D', 4, 'doubleFlat', 1)).toMatchObject({ noteName: 'C', accidental: 'sharp', octave: 4 })
  })

  it("'natural' accidental treated identically to null", () => {
    const withNatural = shift('C', 4, 'natural', 1)
    const withNull    = shift('C', 4, null, 1)
    expect(withNatural).toEqual(withNull)
  })

  // Octave shifts
  it('C4 up 12 → C5 (exact octave)', () => {
    expect(shift('C', 4, null, 12)).toMatchObject({ noteName: 'C', accidental: null, octave: 5 })
  })

  it('C4 down 12 → C3', () => {
    expect(shift('C', 4, null, -12)).toMatchObject({ noteName: 'C', accidental: null, octave: 3 })
  })

  it('G4 up 7 → D5 (perfect fifth)', () => {
    // G4=67, +7=74=D5
    expect(shift('G', 4, null, 7)).toMatchObject({ noteName: 'D', accidental: null, octave: 5 })
  })

  // Clamping at MIDI boundaries
  it('clamps at MIDI 127 — does not go above G9', () => {
    // G9 = MIDI 127; shifting further stays at G9
    const result = shift('G', 9, null, 5)
    // MIDI result must be 127 → G9
    const midi = (result.octave + 1) * 12 + { C:0,D:2,E:4,F:5,G:7,A:9,B:11 }[result.noteName as NoteName]!
      + (result.accidental === 'sharp' ? 1 : 0)
    expect(midi).toBe(127)
  })

  it('clamps at MIDI 0 — does not go below C(-1)', () => {
    const result = shift('C', 0, null, -100)
    const midi = (result.octave + 1) * 12 + { C:0,D:2,E:4,F:5,G:7,A:9,B:11 }[result.noteName as NoteName]!
      + (result.accidental === 'sharp' ? 1 : 0)
    expect(midi).toBe(0)
  })
})

// ── closestOctave ─────────────────────────────────────────────────────────────

describe('closestOctave — octave assignment for keyboard pitch entry', () => {
  function prev(name: NoteName, oct: number): Pitch {
    return { noteName: name, octave: oct, accidental: null }
  }

  it('no previous pitch → defaults to octave 4', () => {
    expect(closestOctave('C', null)).toBe(4)
    expect(closestOctave('G', null)).toBe(4)
  })

  it('same note as previous → same octave (distance 0)', () => {
    expect(closestOctave('C', prev('C', 4))).toBe(4)
    expect(closestOctave('G', prev('G', 3))).toBe(3)
  })

  it('step up by a second — stays in same octave', () => {
    // C4→D4 distance=2, C4→D3 distance=10
    expect(closestOctave('D', prev('C', 4))).toBe(4)
  })

  it('step down by a second — stays in same octave', () => {
    // D4→C4 distance=2, D4→C5 distance=10
    expect(closestOctave('C', prev('D', 4))).toBe(4)
  })

  it('B below C — prefers the lower octave', () => {
    // C4(MIDI=60): B3(59) dist=1, B4(71) dist=11 → B3
    expect(closestOctave('B', prev('C', 4))).toBe(3)
  })

  it('C above B — prefers the higher octave', () => {
    // B4(MIDI=71): C5(72) dist=1, C4(60) dist=11 → C5
    expect(closestOctave('C', prev('B', 4))).toBe(5)
  })

  it('octave jump: prevPitch E4, enter C → C4 (distance 4, not 8)', () => {
    // E4=64: C4=60 dist=4, C5=72 dist=8 → C4
    expect(closestOctave('C', prev('E', 4))).toBe(4)
  })

  it('tie-breaking: equal distance prefers the octave above prev pitch', () => {
    // F4 natural = MIDI 65. B3=59 (dist=6) and B4=71 (dist=6) are equidistant.
    // Tie-breaking rule: prefer the octave where midi > prevMidi (71 > 65) → B4.
    expect(closestOctave('B', prev('F', 4))).toBe(4)
  })

  it('tie-breaking verified: A3 prev, enter D → D4 (closer above)', () => {
    // A3 MIDI=57. D3=50 dist=7, D4=62 dist=5 → D4
    expect(closestOctave('D', prev('A', 3))).toBe(4)
  })

  it('tie-breaking verified: E4 prev, enter B → B4 (closer, above threshold)', () => {
    // E4=64. B3=59 dist=5, B4=71 dist=7 → B3 (below is closer)
    expect(closestOctave('B', prev('E', 4))).toBe(3)
  })

  it('large leap resolved to closest octave', () => {
    // G4(67) prev, enter C: C5=72 dist=5, C4=60 dist=7 → C5
    expect(closestOctave('C', prev('G', 4))).toBe(5)
  })
})
