// Tests for pitchToMidi — the function that converts every note in the score
// to a MIDI note number before playback or external MIDI output.

import { describe, it, expect, vi } from 'vitest'

// Tone.js uses Web Audio APIs unavailable in Node. Mock the entire package so
// the midiOutputEngine module can load; pitchToMidi itself has no Tone dependency.
vi.mock('tone', () => ({}))

import { pitchToMidi } from '@renderer/engine/midiOutputEngine'

describe('pitchToMidi — natural notes at concert pitch', () => {
  it.each([
    ['C', 60],
    ['D', 62],
    ['E', 64],
    ['F', 65],
    ['G', 67],
    ['A', 69],
    ['B', 71],
  ] as [string, number][])('%s4 = MIDI %i', (name, expected) => {
    expect(pitchToMidi(name, 4, null)).toBe(expected)
  })

  it('C5 = 72 (one octave above C4)', () => {
    expect(pitchToMidi('C', 5, null)).toBe(72)
  })

  it('C3 = 48', () => {
    expect(pitchToMidi('C', 3, null)).toBe(48)
  })

  it('A0 = 21 (lowest piano note)', () => {
    expect(pitchToMidi('A', 0, null)).toBe(21)
  })
})

describe('pitchToMidi — accidentals', () => {
  it('sharp adds 1 semitone', () => {
    expect(pitchToMidi('C', 4, 'sharp')).toBe(61)   // C#4
    expect(pitchToMidi('F', 4, 'sharp')).toBe(66)   // F#4
  })

  it('flat subtracts 1 semitone', () => {
    expect(pitchToMidi('B', 4, 'flat')).toBe(70)    // Bb4
    expect(pitchToMidi('E', 4, 'flat')).toBe(63)    // Eb4
  })

  it('doubleSharp adds 2 semitones', () => {
    expect(pitchToMidi('C', 4, 'doubleSharp')).toBe(62)  // Cx4 = D4
    expect(pitchToMidi('F', 4, 'doubleSharp')).toBe(67)  // Fx4 = G4
  })

  it('doubleFlat subtracts 2 semitones', () => {
    expect(pitchToMidi('D', 4, 'doubleFlat')).toBe(60)   // Dbb4 = C4
    expect(pitchToMidi('B', 4, 'doubleFlat')).toBe(69)   // Bbb4 = A4
  })

  it("'natural' produces no offset (same as null)", () => {
    expect(pitchToMidi('C', 4, 'natural')).toBe(pitchToMidi('C', 4, null))
    expect(pitchToMidi('F', 4, 'natural')).toBe(pitchToMidi('F', 4, null))
  })

  it('undefined accidental produces no offset', () => {
    expect(pitchToMidi('C', 4, undefined)).toBe(60)
  })
})

describe('pitchToMidi — transposition', () => {
  // transposeSemitones is positive when the written note is above concert pitch.
  // Formula: (octave+1)*12 + semi − transposeSemitones

  it('Bb instrument (+2): written C4 sounds as Bb3', () => {
    // Concert Bb3 = MIDI 58
    expect(pitchToMidi('C', 4, null, 2)).toBe(58)
  })

  it('Eb instrument (+9): written C4 sounds as Eb3', () => {
    // Concert Eb3 = 60 - 9 = 51
    expect(pitchToMidi('C', 4, null, 9)).toBe(51)
  })

  it('F instrument (+7): written C4 sounds as F3', () => {
    // Concert F3 = 60 - 7 = 53
    expect(pitchToMidi('C', 4, null, 7)).toBe(53)
  })

  it('zero transposition leaves pitch unchanged', () => {
    expect(pitchToMidi('G', 4, null, 0)).toBe(67)
  })

  it('negative transposition (upward transposing instrument, rare)', () => {
    // e.g. written C4, transposeSemitones = -2 → 60 - (-2) = 62 = D4
    expect(pitchToMidi('C', 4, null, -2)).toBe(62)
  })
})

describe('pitchToMidi — MIDI range clamping', () => {
  it('G9 = MIDI 127 (upper boundary, not clamped)', () => {
    expect(pitchToMidi('G', 9, null)).toBe(127)
  })

  it('G#9 clamped to 127 (would be 128)', () => {
    expect(pitchToMidi('G', 9, 'sharp')).toBe(127)
  })

  it('C-1 = MIDI 0 (lower boundary, not clamped)', () => {
    // C(-1): ((-1)+1)*12 + 0 = 0
    expect(pitchToMidi('C', -1, null)).toBe(0)
  })

  it('transposition pushing below 0 clamps to 0', () => {
    // C0 = 12; transpose +13 → 12 - 13 = -1 → 0
    expect(pitchToMidi('C', 0, null, 13)).toBe(0)
  })

  it('transposition pushing above 127 clamps to 127', () => {
    // G9 = 127; transposeSemitones = -5 → 127 + 5 = 132 → 127
    expect(pitchToMidi('G', 9, null, -5)).toBe(127)
  })
})
