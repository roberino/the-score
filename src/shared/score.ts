// ─────────────────────────────────────────────────────────────────────────────
// Score model
//
// Immutable value tree: Score → Part → Measure → Voice → Note
// Analogous to a C# record hierarchy. All mutations happen via Commands
// (see commands.ts), never by direct property assignment.
// ─────────────────────────────────────────────────────────────────────────────

export type NoteName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'
export type Accidental = 'sharp' | 'flat' | 'natural' | 'doubleSharp' | 'doubleFlat' | null
export type Duration =
  | 'whole' | 'half' | 'quarter' | 'eighth'
  | '16th' | '32nd' | '64th'

export type ClefType = 'treble' | 'bass' | 'alto' | 'tenor' | 'percussion'

// ── Pitch ─────────────────────────────────────────────────────────────────────

export interface Pitch {
  readonly noteName: NoteName
  readonly octave: number           // 4 = middle C octave
  readonly accidental: Accidental
}

// ── Notes & Rests ─────────────────────────────────────────────────────────────

export interface Note {
  readonly id: string
  readonly type: 'note'
  readonly pitch: Pitch
  readonly duration: Duration
  readonly dots: 0 | 1 | 2
  readonly tieStart: boolean
  readonly tieEnd: boolean
  readonly beamStart: boolean
  readonly beamEnd: boolean
  readonly articulations: Articulation[]
}

export interface Rest {
  readonly id: string
  readonly type: 'rest'
  readonly duration: Duration
  readonly dots: 0 | 1 | 2
}

export interface Chord {
  readonly id: string
  readonly type: 'chord'
  readonly pitches: Pitch[]          // multiple pitches, same duration
  readonly duration: Duration
  readonly dots: 0 | 1 | 2
  readonly articulations: Articulation[]
}

export type NoteEvent = Note | Rest | Chord

export type Articulation =
  | 'staccato' | 'accent' | 'tenuto' | 'marcato'
  | 'fermata' | 'trill' | 'mordent' | 'turn'

// ── Structure ─────────────────────────────────────────────────────────────────

export interface TimeSignature {
  readonly numerator: number         // beats per measure
  readonly denominator: number       // beat unit (4 = quarter, 8 = eighth)
}

export interface KeySignature {
  readonly fifths: number            // -7 (7 flats) to +7 (7 sharps)
  readonly mode: 'major' | 'minor'
}

export interface Clef {
  readonly type: ClefType
}

export interface Voice {
  readonly id: string
  readonly events: readonly NoteEvent[]
}

export interface Measure {
  readonly id: string
  readonly number: number
  readonly voices: readonly Voice[]  // usually 1–2 voices per staff
  readonly clef?: Clef               // only set when clef changes
  readonly keySignature?: KeySignature
  readonly timeSignature?: TimeSignature
  readonly tempo?: number            // BPM — set when tempo changes
  readonly barline?: 'single' | 'double' | 'final' | 'repeat-start' | 'repeat-end'
}

export interface Staff {
  readonly id: string
  readonly clef: ClefType
  readonly measures: readonly Measure[]
}

export interface Part {
  readonly id: string
  readonly name: string              // e.g. "Violin I"
  readonly shortName: string         // e.g. "Vln. I"
  readonly midiProgram: number       // GM program 0–127
  readonly staves: readonly Staff[]  // usually 1, piano has 2
  readonly volume: number            // 0–1
  readonly muted: boolean
}

export interface ScoreMetadata {
  readonly title: string
  readonly composer: string
  readonly lyricist: string
  readonly copyright: string
  readonly createdAt: string         // ISO 8601
  readonly updatedAt: string
}

export interface Score {
  readonly id: string
  readonly metadata: ScoreMetadata
  readonly parts: readonly Part[]
  readonly keySignature: KeySignature
  readonly timeSignature: TimeSignature
  readonly tempo: number             // BPM
  readonly version: number           // file format version
}

// ── Factory helpers ───────────────────────────────────────────────────────────
// Equivalent to C# static factory methods or object initialisers.

import { v4 as uuid } from 'uuid'

export function createScore(title: string = 'Untitled'): Score {
  const now = new Date().toISOString()
  return {
    id: uuid(),
    metadata: {
      title,
      composer: '',
      lyricist: '',
      copyright: '',
      createdAt: now,
      updatedAt: now
    },
    parts: [createPart('Piano', 'Pno.', 0)],
    keySignature: { fifths: 0, mode: 'major' },
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    version: 1
  }
}

export function createPart(name: string, shortName: string, midiProgram: number): Part {
  return {
    id: uuid(),
    name,
    shortName,
    midiProgram,
    staves: [createStaff('treble')],
    volume: 0.8,
    muted: false
  }
}

export function createStaff(clef: ClefType): Staff {
  return {
    id: uuid(),
    clef,
    measures: [createMeasure(1)]
  }
}

export function createMeasure(number: number): Measure {
  return {
    id: uuid(),
    number,
    voices: [{ id: uuid(), events: [] }]
  }
}

export function createNote(
  noteName: NoteName,
  octave: number,
  duration: Duration,
  accidental: Accidental = null
): Note {
  return {
    id: uuid(),
    type: 'note',
    pitch: { noteName, octave, accidental },
    duration,
    dots: 0,
    tieStart: false,
    tieEnd: false,
    beamStart: false,
    beamEnd: false,
    articulations: []
  }
}

export function createRest(duration: Duration): Rest {
  return { id: uuid(), type: 'rest', duration, dots: 0 }
}
