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
export type BarlineType = 'single' | 'double' | 'final' | 'repeat-start' | 'repeat-end'

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
  | 'fermata' | 'trill' | 'mordent' | 'mordent-upper' | 'turn'

export interface Slur {
  readonly id: string
  readonly fromNoteId: string   // source NoteEvent id (Note or Chord)
  readonly toNoteId: string     // destination NoteEvent id
  readonly placement?: 'above' | 'below'  // omit = auto
}

// ── Performance directives ────────────────────────────────────────────────────

export type DirectiveCategory = 'tempo' | 'dynamic' | 'expression'

export interface Directive {
  readonly id: string
  readonly category: DirectiveCategory
  readonly text: string           // display text, e.g. "Allegro", "mf", "pizz."
  readonly bpm?: number           // tempo only — overrides BPM from this measure forward
  readonly midiProgram?: number   // expression only — -1 = restore original, ≥0 = override
}

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
  readonly voices: readonly Voice[]           // usually 1–2 voices per staff
  readonly clef?: Clef                        // only set when clef changes
  readonly keySignature?: KeySignature
  readonly timeSignature?: TimeSignature
  readonly tempo?: number                     // BPM — set when tempo changes
  readonly barline?: BarlineType
  readonly directives?: readonly Directive[]  // performance directives at this measure
}

export interface Staff {
  readonly id: string
  readonly clef: ClefType
  readonly measures: readonly Measure[]
  readonly slurs?: readonly Slur[]
}

export interface Part {
  readonly id: string
  readonly name: string              // e.g. "Violin I"
  readonly shortName: string         // e.g. "Vln. I"
  readonly midiProgram: number       // GM program 0–127
  readonly midiChannel?: number      // 1–16; undefined → falls back to partIndex + 1
  readonly transposeSemitones: number // 0 = concert pitch; positive = written above concert
  readonly staves: readonly Staff[]  // usually 1, piano has 2
  readonly volume: number            // 0–1
  readonly muted: boolean
  readonly labelVisible: boolean     // show label on score
}

export interface ScoreMetadata {
  readonly title: string
  readonly subtitle: string
  readonly composer: string
  readonly arranger: string
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
  readonly showPartLabels: boolean   // master label visibility
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
      subtitle: '',
      composer: '',
      arranger: '',
      lyricist: '',
      copyright: '',
      createdAt: now,
      updatedAt: now
    },
    parts: [createPart('Piano', 'Pno.', 0, 0)],
    keySignature: { fifths: 0, mode: 'major' },
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: 120,
    showPartLabels: true,
    version: 1
  }
}

export function createPart(
  name: string,
  shortName: string,
  midiProgram: number,
  transposeSemitones: number = 0,
  clef: ClefType = 'treble',
  measureCount: number = INITIAL_MEASURE_COUNT,
  midiChannel?: number,
): Part {
  return {
    id: uuid(),
    name,
    shortName,
    midiProgram,
    ...(midiChannel !== undefined ? { midiChannel } : {}),
    transposeSemitones,
    staves: [createStaff(clef, measureCount)],
    volume: 0.8,
    muted: false,
    labelVisible: true,
  }
}

const INITIAL_MEASURE_COUNT = 8

export function createStaff(clef: ClefType, measureCount: number = INITIAL_MEASURE_COUNT): Staff {
  const measures = Array.from({ length: measureCount }, (_, i) =>
    createMeasure(i + 1, i === measureCount - 1 ? 'final' : 'single')
  )
  return { id: uuid(), clef, measures }
}

export function createMeasure(number: number, barline: BarlineType = 'single'): Measure {
  return {
    id: uuid(),
    number,
    voices: [{ id: uuid(), events: [] }],
    barline,
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
