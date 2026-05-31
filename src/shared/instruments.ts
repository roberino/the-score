import type { ClefType, TabConfig } from './score'
import data from './instruments.json'

export type InstrumentFamily = 'strings' | 'woodwinds' | 'brass' | 'keyboards' | 'percussion' | 'voices' | 'synths'

export interface PitchRange {
  /** Minimum written MIDI note number (concert pitch for non-transposing instruments). */
  readonly min: number
  /** Maximum written MIDI note number. */
  readonly max: number
}

export interface InstrumentDef {
  readonly id: string
  readonly name: string
  readonly shortName: string
  readonly family: InstrumentFamily
  readonly defaultClef: ClefType
  readonly midiProgram: number
  // Semitones written pitch is above concert pitch.
  // Playback: concertMidi = writtenMidi − transposeSemitones
  readonly transposeSemitones: number
  /** SVG asset filename (relative to src/renderer/assets/instruments/). */
  readonly icon: string
  /** Practical written pitch range for range advisory warnings. */
  readonly pitchRange: PitchRange
  /** Fixed MIDI channel (1–16). Used for e.g. drum kit (channel 10). */
  readonly midiChannel?: number
  /** Default input mode for this instrument. */
  readonly inputMode?: 'score' | 'sequencer'
  /** Tab config — present only for fretted string instruments. */
  readonly tab?: TabConfig
}

export const INSTRUMENTS: readonly InstrumentDef[] = data.instruments as InstrumentDef[]

export const INSTRUMENT_FAMILIES: InstrumentFamily[] = [
  'strings', 'woodwinds', 'brass', 'keyboards', 'voices', 'percussion', 'synths',
]

export const FAMILY_LABELS: Record<InstrumentFamily, string> = {
  strings:    'Strings',
  woodwinds:  'Woodwinds',
  brass:      'Brass',
  keyboards:  'Keyboards',
  voices:     'Voices',
  percussion: 'Percussion',
  synths:     'Synths',
}

export function getInstrument(id: string): InstrumentDef | undefined {
  return INSTRUMENTS.find(i => i.id === id)
}
