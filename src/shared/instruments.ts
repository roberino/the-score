import type { ClefType } from './score'
import data from './instruments.json'

export type InstrumentFamily = 'strings' | 'woodwinds' | 'brass' | 'keyboards' | 'percussion' | 'voices'

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
}

export const INSTRUMENTS: readonly InstrumentDef[] = data.instruments as InstrumentDef[]

export const INSTRUMENT_FAMILIES: InstrumentFamily[] = [
  'strings', 'woodwinds', 'brass', 'keyboards', 'voices', 'percussion',
]

export const FAMILY_LABELS: Record<InstrumentFamily, string> = {
  strings:    'Strings',
  woodwinds:  'Woodwinds',
  brass:      'Brass',
  keyboards:  'Keyboards',
  voices:     'Voices',
  percussion: 'Percussion',
}

export function getInstrument(id: string): InstrumentDef | undefined {
  return INSTRUMENTS.find(i => i.id === id)
}
