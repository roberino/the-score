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

export type DynamicLevel = 'pppp' | 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff' | 'ffff' | 'sfz' | 'fp'

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
  readonly tuplet?: TupletInfo
  readonly dynamic?: DynamicLevel
  readonly lyric?: string
}

export interface Rest {
  readonly id: string
  readonly type: 'rest'
  readonly duration: Duration
  readonly dots: 0 | 1 | 2
  readonly tuplet?: TupletInfo
  readonly dynamic?: DynamicLevel
}

export interface Chord {
  readonly id: string
  readonly type: 'chord'
  readonly pitches: Pitch[]          // multiple pitches, same duration
  readonly duration: Duration
  readonly dots: 0 | 1 | 2
  readonly articulations: Articulation[]
  readonly tuplet?: TupletInfo
  readonly dynamic?: DynamicLevel
  readonly lyric?: string
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

// ── Piano pedal marks ─────────────────────────────────────────────────────────

export interface PedalMark {
  readonly id:           string
  readonly type:         'down' | 'up'
  readonly beatPosition: number   // 64th-note units from measure start
}

// ── MIDI score events ─────────────────────────────────────────────────────────

export type MidiScoreEventType = 'cc' | 'pc' | 'pb' | 'sysex'

export interface MidiScoreEvent {
  readonly id: string
  readonly type: MidiScoreEventType
  readonly beatPosition: number                               // 64th-note units from measure start
  readonly cc?:    { readonly controller: number; readonly value: number }
  readonly pc?:    { readonly program: number }
  readonly pb?:    { readonly value: number }                 // −8192 to +8191
  readonly sysex?: { readonly hex: string }                   // space-separated hex bytes
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
  readonly midiEvents?: readonly MidiScoreEvent[]
  readonly pedalMarks?: readonly PedalMark[]
}

// ── Tuplets ───────────────────────────────────────────────────────────────────

export interface TupletInfo {
  readonly id: string      // UUID shared by every event in the same tuplet group
  readonly actual: number  // notes written (3, 5, or 6)
  readonly normal: number  // notes they replace (2, 4, or 4)
}

// ── Hairpins ─────────────────────────────────────────────────────────────────

export type HairpinType = 'crescendo' | 'decrescendo'

export interface Hairpin {
  readonly id: string
  readonly type: HairpinType
  readonly fromNoteId: string
  readonly toNoteId:   string
}

export interface Staff {
  readonly id: string
  readonly clef: ClefType
  readonly measures: readonly Measure[]
  readonly slurs?: readonly Slur[]
  readonly hairpins?: readonly Hairpin[]
}

// ── Sequence (step-sequencer) types ───────────────────────────────────────────

export interface SequenceCell {
  pitch: number     // MIDI note number 0–127
  velocity: number  // 1–127, default 127
}

export interface SequencePattern {
  id: string
  // Outer index = step column (0 to stepsPerBar-1)
  // Inner array = active cells in that column (empty = no notes on this step)
  steps: SequenceCell[][]
  stepsPerBar: number
  label?: string
}

// An assignment pins a pattern (or silence) to a start bar.
// The pattern plays from startMeasureIndex until the next assignment's startMeasureIndex.
export interface SequenceAssignment {
  id: string
  patternId: string | null  // null = explicit silence
  startMeasureIndex: number
}

export type GroupSymbol = 'bracket' | 'brace'

export interface TabConfig {
  readonly stringCount:  number
  readonly openStrings:  readonly number[]  // MIDI note of each open string, index 0 = lowest pitch
  readonly fretCount:    number
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
  readonly groupId?: string          // parts sharing the same groupId are in one bracket/brace group
  readonly groupSymbol?: GroupSymbol // visual symbol drawn for the group (bracket or brace)
  readonly inputMode?: 'score' | 'sequencer'  // defaults to 'score' when absent
  readonly sequencePatterns?: readonly SequencePattern[]
  readonly sequenceAssignments?: readonly SequenceAssignment[]
  readonly showTab?:   boolean     // render tab staff below standard staff
  readonly tabConfig?: TabConfig   // set when instrument supports tab
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

export interface TextBox {
  readonly id: string
  readonly x: number       // canvas px at zoom=1
  readonly y: number
  readonly width: number   // box width at zoom=1
  readonly html: string    // sanitised HTML
}

export interface Volta {
  readonly id: string
  readonly number: 1 | 2 | 3
  readonly startMeasureIndex: number  // 0-based, inclusive
  readonly endMeasureIndex: number    // 0-based, inclusive
}

export interface Score {
  readonly id: string
  readonly metadata: ScoreMetadata
  readonly parts: readonly Part[]
  readonly keySignature: KeySignature
  readonly timeSignature: TimeSignature
  readonly tempo: number             // BPM
  readonly showPartLabels: boolean   // master label visibility
  readonly textBoxes?: readonly TextBox[]
  readonly voltas?: readonly Volta[]
  readonly version: number           // file format version
}

// ── Factory helpers ───────────────────────────────────────────────────────────
// Equivalent to C# static factory methods or object initialisers.

import { v4 as uuid } from 'uuid'
import { measureCapacityUnits, fillWithRests } from './musicUtils'

export function createScore(title: string = 'Untitled'): Score {
  const now = new Date().toISOString()
  const defaultTimeSig: TimeSignature = { numerator: 4, denominator: 4 }
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
    parts: [createPart('Piano', 'Pno.', 0, 0, 'treble', INITIAL_MEASURE_COUNT, undefined, defaultTimeSig)],
    keySignature: { fifths: 0, mode: 'major' },
    timeSignature: defaultTimeSig,
    tempo: 120,
    showPartLabels: true,
    textBoxes: [],
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
  timeSig?: TimeSignature,
): Part {
  return {
    id: uuid(),
    name,
    shortName,
    midiProgram,
    ...(midiChannel !== undefined ? { midiChannel } : {}),
    transposeSemitones,
    staves: [createStaff(clef, measureCount, timeSig)],
    volume: 0.8,
    muted: false,
    labelVisible: true,
  }
}

const INITIAL_MEASURE_COUNT = 8

export function createStaff(clef: ClefType, measureCount: number = INITIAL_MEASURE_COUNT, timeSig?: TimeSignature): Staff {
  const measures = Array.from({ length: measureCount }, (_, i) =>
    createMeasure(i + 1, i === measureCount - 1 ? 'final' : 'single', timeSig)
  )
  return { id: uuid(), clef, measures }
}

export function createMeasure(number: number, barline: BarlineType = 'single', timeSig?: TimeSignature): Measure {
  const events: NoteEvent[] = timeSig ? fillWithRests(measureCapacityUnits(timeSig)) : []
  return {
    id: uuid(),
    number,
    voices: [{ id: uuid(), events }],
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
