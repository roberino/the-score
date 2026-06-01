// Tests for pure musicUtils functions.
// P1: fillWithRests, shiftPitchBySemitones, closestOctave
// P2: eventDurationUnits, resolveTimeSig, resolveKeySig, transposeKeyFifths, buildPlaybackSequence

import { describe, it, expect } from 'vitest'
import {
  DURATION_UNITS,
  fillWithRests,
  shiftPitchBySemitones,
  closestOctave,
  eventDurationUnits,
  resolveTimeSig,
  resolveKeySig,
  transposeKeyFifths,
  buildPlaybackSequence,
} from '@shared/musicUtils'
import type { NoteName, Pitch, NoteEvent, TimeSignature, KeySignature, Measure, Volta } from '@shared/score'
import { createNote, createRest } from '@shared/score'

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Sum 64th-note units of an event list. */
function sumUnits(events: NoteEvent[]): number {
  return events.reduce((s, e) => s + eventDurationUnits(e), 0)
}

function shape(e: NoteEvent): { duration: string; dots: number } {
  return { duration: (e as any).duration, dots: (e as any).dots }
}

const SIG_44: TimeSignature = { numerator: 4, denominator: 4 }
const SIG_34: TimeSignature = { numerator: 3, denominator: 4 }
const SIG_68: TimeSignature = { numerator: 6, denominator: 8 }

const KEY_C:  KeySignature = { fifths: 0,  mode: 'major' }
const KEY_G:  KeySignature = { fifths: 1,  mode: 'major' }
const KEY_D:  KeySignature = { fifths: 2,  mode: 'major' }
const KEY_F:  KeySignature = { fifths: -1, mode: 'major' }
const KEY_Bb: KeySignature = { fifths: -2, mode: 'major' }

/** Minimal Measure stub — only barline is needed by buildPlaybackSequence. */
function m(barline?: Measure['barline']): Measure {
  return {
    id: `m-${Math.random()}`,
    number: 1,
    voices: [{ id: 'v', events: [] }],
    ...(barline ? { barline } : {}),
  }
}

// ── fillWithRests ─────────────────────────────────────────────────────────────

describe('fillWithRests — greedy decomposition', () => {
  it.each([
    [64, 'whole',   0],
    [48, 'half',    1],
    [32, 'half',    0],
    [24, 'quarter', 1],
    [16, 'quarter', 0],
    [12, 'eighth',  1],
    [ 8, 'eighth',  0],
    [ 6, '16th',    1],
    [ 4, '16th',    0],
    [ 3, '32nd',    1],
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
    expect(fillWithRests(40).map(shape)).toEqual([
      { duration: 'half',   dots: 0 },
      { duration: 'eighth', dots: 0 },
    ])
  })

  it('56 units → [dotted-half, eighth]', () => {
    expect(fillWithRests(56).map(shape)).toEqual([
      { duration: 'half',   dots: 1 },
      { duration: 'eighth', dots: 0 },
    ])
  })

  it('36 units → [half, 16th]', () => {
    expect(fillWithRests(36).map(shape)).toEqual([
      { duration: 'half', dots: 0 },
      { duration: '16th', dots: 0 },
    ])
  })

  it('prefers dotted-half over half+quarter (greedy picks largest first)', () => {
    const rests = fillWithRests(48)
    expect(rests).toHaveLength(1)
    expect(shape(rests[0])).toEqual({ duration: 'half', dots: 1 })
  })

  it('sum always equals the input', () => {
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
  function shift(name: NoteName, oct: number, acc: Pitch['accidental'], semitones: number) {
    return shiftPitchBySemitones(name, oct, acc, semitones)
  }

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

  it('C up 1 → C# (whole-tone boundary)', () => {
    expect(shift('C', 4, null, 1)).toMatchObject({ noteName: 'C', accidental: 'sharp', octave: 4 })
  })

  it('sharp input: C#4 up 1 → D4', () => {
    expect(shift('C', 4, 'sharp', 1)).toMatchObject({ noteName: 'D', accidental: null, octave: 4 })
  })

  it('flat input: Db4 up 1 → D4', () => {
    expect(shift('D', 4, 'flat', 1)).toMatchObject({ noteName: 'D', accidental: null, octave: 4 })
  })

  it('flat input: Cb4 up 1 → C4', () => {
    expect(shift('C', 4, 'flat', 1)).toMatchObject({ noteName: 'C', accidental: null, octave: 4 })
  })

  it('double-sharp input: Cx4 up 1 → D#4', () => {
    expect(shift('C', 4, 'doubleSharp', 1)).toMatchObject({ noteName: 'D', accidental: 'sharp', octave: 4 })
  })

  it('double-flat input: Dbb4 up 1 → C#4', () => {
    expect(shift('D', 4, 'doubleFlat', 1)).toMatchObject({ noteName: 'C', accidental: 'sharp', octave: 4 })
  })

  it("'natural' treated identically to null", () => {
    expect(shift('C', 4, 'natural', 1)).toEqual(shift('C', 4, null, 1))
  })

  it('C4 up 12 → C5', () => {
    expect(shift('C', 4, null, 12)).toMatchObject({ noteName: 'C', accidental: null, octave: 5 })
  })

  it('C4 down 12 → C3', () => {
    expect(shift('C', 4, null, -12)).toMatchObject({ noteName: 'C', accidental: null, octave: 3 })
  })

  it('clamps at MIDI 127', () => {
    const result = shift('G', 9, null, 5)
    const midi = (result.octave + 1) * 12
      + { C:0,D:2,E:4,F:5,G:7,A:9,B:11 }[result.noteName as NoteName]!
      + (result.accidental === 'sharp' ? 1 : 0)
    expect(midi).toBe(127)
  })

  it('clamps at MIDI 0', () => {
    const result = shift('C', 0, null, -100)
    const midi = (result.octave + 1) * 12
      + { C:0,D:2,E:4,F:5,G:7,A:9,B:11 }[result.noteName as NoteName]!
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
    expect(closestOctave('D', prev('C', 4))).toBe(4)
  })

  it('step down by a second — stays in same octave', () => {
    expect(closestOctave('C', prev('D', 4))).toBe(4)
  })

  it('B below C — prefers the lower octave (B3 is 1 semitone below C4)', () => {
    expect(closestOctave('B', prev('C', 4))).toBe(3)
  })

  it('C above B — prefers the higher octave (C5 is 1 semitone above B4)', () => {
    expect(closestOctave('C', prev('B', 4))).toBe(5)
  })

  it('large leap resolved to closest octave', () => {
    // G4(67): C5=72 dist=5, C4=60 dist=7 → C5
    expect(closestOctave('C', prev('G', 4))).toBe(5)
  })

  it('tie-breaking: equal distance prefers the octave above prev pitch', () => {
    // F4 natural = MIDI 65. B3=59 (dist=6), B4=71 (dist=6) are equidistant.
    // Rule: prefer midi > prevMidi → 71>65, so B4 wins.
    expect(closestOctave('B', prev('F', 4))).toBe(4)
  })

  it('downward tie-break: F5(77) prev, B equidistant → B5 preferred', () => {
    // F5=77. B4=71 dist=6, B5=83 dist=6. 83>77 → B5.
    expect(closestOctave('B', prev('F', 5))).toBe(5)
  })
})

// ── eventDurationUnits ────────────────────────────────────────────────────────

describe('eventDurationUnits — tuplet-aware duration arithmetic', () => {
  it('plain note: returns base units unchanged', () => {
    expect(eventDurationUnits(createNote('C', 4, 'quarter'))).toBe(16)
    expect(eventDurationUnits(createNote('C', 4, 'half'))).toBe(32)
    expect(eventDurationUnits(createNote('C', 4, 'eighth'))).toBe(8)
    expect(eventDurationUnits(createNote('C', 4, 'whole'))).toBe(64)
  })

  it('dotted note: adds half the base', () => {
    const dotQ = { ...createNote('C', 4, 'quarter'), dots: 1 as 1 }
    expect(eventDurationUnits(dotQ)).toBe(24)
  })

  it('double-dotted note: adds half + quarter of base', () => {
    const ddQ = { ...createNote('C', 4, 'quarter'), dots: 2 as 2 }
    expect(eventDurationUnits(ddQ)).toBe(28)
  })

  it('plain rest: same as plain note', () => {
    expect(eventDurationUnits(createRest('quarter'))).toBe(16)
    expect(eventDurationUnits(createRest('eighth'))).toBe(8)
  })

  it('triplet eighth (3:2): base * 2/3', () => {
    const tripletEighth = { ...createRest('eighth'), tuplet: { id: 'tup', actual: 3, normal: 2 } }
    expect(eventDurationUnits(tripletEighth)).toBeCloseTo(8 * 2 / 3)
  })

  it('three triplet eighths sum to one quarter (16 units)', () => {
    const triplet = { ...createRest('eighth'), tuplet: { id: 'tup', actual: 3, normal: 2 } }
    expect(eventDurationUnits(triplet) * 3).toBeCloseTo(16, 10)
  })

  it('triplet quarter (3:2): base * 2/3', () => {
    const tripletQ = { ...createRest('quarter'), tuplet: { id: 'tup', actual: 3, normal: 2 } }
    expect(eventDurationUnits(tripletQ)).toBeCloseTo(16 * 2 / 3)
  })

  it('quintuplet 16th (5:4): base * 4/5', () => {
    const quint = { ...createRest('16th'), tuplet: { id: 'tup', actual: 5, normal: 4 } }
    expect(eventDurationUnits(quint)).toBeCloseTo(4 * 4 / 5)
  })

  it('five quintuplet 16ths sum to one quarter (16 units)', () => {
    const quint = { ...createRest('16th'), tuplet: { id: 'tup', actual: 5, normal: 4 } }
    expect(eventDurationUnits(quint) * 5).toBeCloseTo(16, 10)
  })

  it('no tuplet field → behaves identically to plain note', () => {
    const note = createNote('C', 4, 'quarter')
    expect(eventDurationUnits(note)).toBe(DURATION_UNITS['quarter'])
  })
})

// ── resolveTimeSig ────────────────────────────────────────────────────────────

describe('resolveTimeSig — walk-back resolution', () => {
  it('empty measures array → returns score default', () => {
    expect(resolveTimeSig([], 0, SIG_44)).toEqual(SIG_44)
  })

  it('no overrides in any measure → returns score default', () => {
    const measures = [{ }, { }, { }] as Measure[]
    expect(resolveTimeSig(measures, 1, SIG_44)).toEqual(SIG_44)
  })

  it('override at queried index → returns that override', () => {
    const measures = [{ }, { timeSignature: SIG_34 }, { }] as Measure[]
    expect(resolveTimeSig(measures, 1, SIG_44)).toEqual(SIG_34)
  })

  it('override at an earlier index → returned by walk-back', () => {
    const measures = [{ timeSignature: SIG_34 }, { }, { }] as Measure[]
    expect(resolveTimeSig(measures, 2, SIG_44)).toEqual(SIG_34)
  })

  it('override at a later index → ignored when querying earlier', () => {
    const measures = [{ }, { }, { timeSignature: SIG_34 }] as Measure[]
    expect(resolveTimeSig(measures, 1, SIG_44)).toEqual(SIG_44)
  })

  it('multiple overrides → returns most recent at or before idx', () => {
    const measures = [
      { timeSignature: SIG_34 },
      { },
      { timeSignature: SIG_68 },
      { },
    ] as Measure[]
    expect(resolveTimeSig(measures, 0, SIG_44)).toEqual(SIG_34) // exact match
    expect(resolveTimeSig(measures, 1, SIG_44)).toEqual(SIG_34) // walk back to idx 0
    expect(resolveTimeSig(measures, 2, SIG_44)).toEqual(SIG_68) // exact match
    expect(resolveTimeSig(measures, 3, SIG_44)).toEqual(SIG_68) // walk back to idx 2
  })

  it('idx beyond end of array → clamped to last element, then walks back', () => {
    const measures = [{ timeSignature: SIG_34 }, { }] as Measure[]
    // idx=99, clamped to 1 (last). Walk back from 1: no override at 1, found at 0.
    expect(resolveTimeSig(measures, 99, SIG_44)).toEqual(SIG_34)
  })
})

// ── resolveKeySig ─────────────────────────────────────────────────────────────

describe('resolveKeySig — walk-back resolution', () => {
  it('no overrides → returns score default', () => {
    const measures = [{ }, { }] as Measure[]
    expect(resolveKeySig(measures, 0, KEY_C)).toEqual(KEY_C)
  })

  it('override at queried index → returns it', () => {
    const measures = [{ }, { keySignature: KEY_G }, { }] as Measure[]
    expect(resolveKeySig(measures, 1, KEY_C)).toEqual(KEY_G)
  })

  it('walk-back finds earlier override', () => {
    const measures = [{ keySignature: KEY_F }, { }, { }] as Measure[]
    expect(resolveKeySig(measures, 2, KEY_C)).toEqual(KEY_F)
  })

  it('override at later index ignored', () => {
    const measures = [{ }, { keySignature: KEY_G }, { }] as Measure[]
    expect(resolveKeySig(measures, 0, KEY_C)).toEqual(KEY_C)
  })

  it('most recent override wins when multiple exist', () => {
    const measures = [{ keySignature: KEY_F }, { }, { keySignature: KEY_D }] as Measure[]
    expect(resolveKeySig(measures, 2, KEY_C)).toEqual(KEY_D)
    expect(resolveKeySig(measures, 1, KEY_C)).toEqual(KEY_F)
  })
})

// ── transposeKeyFifths ────────────────────────────────────────────────────────

describe('transposeKeyFifths — key signature for transposing instruments', () => {
  it('zero transposition → concert key unchanged', () => {
    expect(transposeKeyFifths(0, 0)).toBe(0)
    expect(transposeKeyFifths(2, 0)).toBe(2)
    expect(transposeKeyFifths(-3, 0)).toBe(-3)
  })

  it('Bb instrument (+2): adds 2 fifths to the concert key', () => {
    // Concert C (0) → written D (2 fifths)
    expect(transposeKeyFifths(0, 2)).toBe(2)
    // Concert G (1) → written A (3 fifths)
    expect(transposeKeyFifths(1, 2)).toBe(3)
    // Concert F (-1) → written G (1 fifth)
    expect(transposeKeyFifths(-1, 2)).toBe(1)
    // Concert Bb (-2) → written C (0 fifths)
    expect(transposeKeyFifths(-2, 2)).toBe(0)
  })

  it('Eb instrument (+9): adds 3 fifths', () => {
    expect(transposeKeyFifths(0, 9)).toBe(3)   // C → A (3 sharps)
    expect(transposeKeyFifths(-1, 9)).toBe(2)   // F → D (2 sharps)
  })

  it('F horn (+7): adds 1 fifth', () => {
    expect(transposeKeyFifths(0, 7)).toBe(1)    // C → G (1 sharp)
    expect(transposeKeyFifths(-2, 7)).toBe(-1)  // Bb → F (1 flat)
  })

  it('A clarinet (+3): subtracts 3 fifths', () => {
    // norm=3, raw=21%12=9, fifthsChange=9-12=-3
    expect(transposeKeyFifths(0, 3)).toBe(-3)   // C → Eb (3 flats)
    expect(transposeKeyFifths(2, 3)).toBe(-1)   // D → F (1 flat)
  })

  it('octave-equivalent transposition (12 semitones) produces same key', () => {
    expect(transposeKeyFifths(0, 12)).toBe(0)
    expect(transposeKeyFifths(2, 12)).toBe(2)
  })

  it('clamps upward at +7 (C# major, 7 sharps)', () => {
    // Concert B (5 fifths) + Eb (+9 → +3 fifths) = 8 → clamped to 7
    expect(transposeKeyFifths(5, 9)).toBe(7)
  })

  it('clamps downward at -7 (Cb major, 7 flats)', () => {
    // Concert Db (-5 fifths) + A (+3 → -3 fifths) = -8 → clamped to -7
    expect(transposeKeyFifths(-5, 3)).toBe(-7)
  })

  it('negative transposeSemitones (downward transposing instrument)', () => {
    // transposeSemitones=-2: norm=10, raw=70%12=10, fifthsChange=10-12=-2
    expect(transposeKeyFifths(0, -2)).toBe(-2)  // C → Bb (2 flats)
  })
})

// ── buildPlaybackSequence ─────────────────────────────────────────────────────

describe('buildPlaybackSequence — repeat and volta bracket ordering', () => {
  it('no repeats, no voltas → ascending order', () => {
    expect(buildPlaybackSequence([m(), m(), m()])).toEqual([0, 1, 2])
  })

  it('empty measures → empty sequence', () => {
    expect(buildPlaybackSequence([])).toEqual([])
  })

  it('single measure with no repeat → [0]', () => {
    expect(buildPlaybackSequence([m()])).toEqual([0])
  })

  it('simple repeat (no explicit start barline): plays section twice', () => {
    // measures[0]=A, measures[1]=B with repeat-end
    // No repeat-start found → jump to index 0
    expect(buildPlaybackSequence([m(), m('repeat-end')])).toEqual([0, 1, 0, 1])
  })

  it('repeat with explicit start: only the marked section repeats', () => {
    // measures[0]=A (repeat-start), measures[1]=B, measures[2]=C (repeat-end)
    // findRepeatStart(2) finds repeat-start at idx 0 → rs=1
    // So only measures 1 and 2 repeat; measure 0 plays once
    expect(buildPlaybackSequence([
      m('repeat-start'), m(), m('repeat-end'),
    ])).toEqual([0, 1, 2, 1, 2])
  })

  it('repeat-start mid-sequence: material before it plays once', () => {
    // measures[0]=intro, [1]=A (repeat-start barline), [2]=B, [3]=C (repeat-end)
    // findRepeatStart(3) → repeat-start at idx 1 → rs=2
    // Measures 2 and 3 repeat; 0 and 1 play once
    expect(buildPlaybackSequence([
      m(), m('repeat-start'), m(), m('repeat-end'),
    ])).toEqual([0, 1, 2, 3, 2, 3])
  })

  it('material after a repeat plays once', () => {
    // [A, B||, C]
    expect(buildPlaybackSequence([
      m(), m('repeat-end'), m(),
    ])).toEqual([0, 1, 0, 1, 2])
  })

  it('first/second volta: plays ending 1 on pass 1, ending 2 on pass 2', () => {
    // Layout: [0:intro, 1:main, 2:ending-1(repeat-end), 3:ending-2]
    // volta 1 covers measure 2 (has repeat-end), volta 2 covers measure 3
    const measures: Measure[] = [m(), m(), m('repeat-end'), m()]
    const voltas: Volta[] = [
      { id: 'v1', number: 1, startMeasureIndex: 2, endMeasureIndex: 2 },
      { id: 'v2', number: 2, startMeasureIndex: 3, endMeasureIndex: 3 },
    ]
    expect(buildPlaybackSequence(measures, voltas)).toEqual([0, 1, 2, 0, 1, 3])
  })

  it('volta 1 multi-measure: skips the whole volta-1 block on second pass', () => {
    // [0:A, 1:B(volta1-start), 2:C(volta1-end, repeat-end), 3:D(volta2)]
    const measures: Measure[] = [m(), m(), m('repeat-end'), m()]
    const voltas: Volta[] = [
      { id: 'v1', number: 1, startMeasureIndex: 1, endMeasureIndex: 2 },
      { id: 'v2', number: 2, startMeasureIndex: 3, endMeasureIndex: 3 },
    ]
    expect(buildPlaybackSequence(measures, voltas)).toEqual([0, 1, 2, 0, 3])
  })
})
