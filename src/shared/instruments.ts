import type { ClefType } from './score'

export type InstrumentFamily = 'strings' | 'woodwinds' | 'brass' | 'keyboards' | 'percussion' | 'voices'

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
}

export const INSTRUMENTS: readonly InstrumentDef[] = [
  // ── Strings ─────────────────────────────────────────────────────────────────
  { id: 'violin',       name: 'Violin',        shortName: 'Vln.',  family: 'strings',    defaultClef: 'treble', midiProgram: 40,  transposeSemitones: 0   },
  { id: 'viola',        name: 'Viola',         shortName: 'Vla.',  family: 'strings',    defaultClef: 'alto',   midiProgram: 41,  transposeSemitones: 0   },
  { id: 'cello',        name: 'Cello',         shortName: 'Vc.',   family: 'strings',    defaultClef: 'bass',   midiProgram: 42,  transposeSemitones: 0   },
  { id: 'doublebass',   name: 'Double Bass',   shortName: 'D.B.',  family: 'strings',    defaultClef: 'bass',   midiProgram: 43,  transposeSemitones: 12  },
  { id: 'harp',         name: 'Harp',          shortName: 'Hrp.',  family: 'strings',    defaultClef: 'treble', midiProgram: 46,  transposeSemitones: 0   },
  { id: 'guitar',       name: 'Guitar',        shortName: 'Gtr.',  family: 'strings',    defaultClef: 'treble', midiProgram: 25,  transposeSemitones: 12  },

  // ── Woodwinds ────────────────────────────────────────────────────────────────
  { id: 'piccolo',      name: 'Piccolo',       shortName: 'Picc.', family: 'woodwinds',  defaultClef: 'treble', midiProgram: 72,  transposeSemitones: -12 },
  { id: 'flute',        name: 'Flute',         shortName: 'Fl.',   family: 'woodwinds',  defaultClef: 'treble', midiProgram: 73,  transposeSemitones: 0   },
  { id: 'oboe',         name: 'Oboe',          shortName: 'Ob.',   family: 'woodwinds',  defaultClef: 'treble', midiProgram: 68,  transposeSemitones: 0   },
  { id: 'enghorn',      name: 'English Horn',  shortName: 'E.H.',  family: 'woodwinds',  defaultClef: 'treble', midiProgram: 69,  transposeSemitones: 7   },
  { id: 'clarinetBb',   name: 'Clarinet in Bb',shortName: 'Cl.',   family: 'woodwinds',  defaultClef: 'treble', midiProgram: 71,  transposeSemitones: 2   },
  { id: 'clarinetA',    name: 'Clarinet in A', shortName: 'Cl.',   family: 'woodwinds',  defaultClef: 'treble', midiProgram: 71,  transposeSemitones: 3   },
  { id: 'bassClarinet', name: 'Bass Clarinet', shortName: 'B.Cl.', family: 'woodwinds',  defaultClef: 'treble', midiProgram: 71,  transposeSemitones: 14  },
  { id: 'bassoon',      name: 'Bassoon',       shortName: 'Bsn.',  family: 'woodwinds',  defaultClef: 'bass',   midiProgram: 70,  transposeSemitones: 0   },
  { id: 'sopSax',       name: 'Soprano Sax',   shortName: 'S.Sx.', family: 'woodwinds',  defaultClef: 'treble', midiProgram: 64,  transposeSemitones: 2   },
  { id: 'altSax',       name: 'Alto Sax',      shortName: 'A.Sx.', family: 'woodwinds',  defaultClef: 'treble', midiProgram: 65,  transposeSemitones: 9   },
  { id: 'tenSax',       name: 'Tenor Sax',     shortName: 'T.Sx.', family: 'woodwinds',  defaultClef: 'treble', midiProgram: 66,  transposeSemitones: 14  },
  { id: 'barSax',       name: 'Baritone Sax',  shortName: 'B.Sx.', family: 'woodwinds',  defaultClef: 'treble', midiProgram: 67,  transposeSemitones: 21  },

  // ── Brass ────────────────────────────────────────────────────────────────────
  { id: 'trumpetBb',    name: 'Trumpet in Bb', shortName: 'Tpt.',  family: 'brass',      defaultClef: 'treble', midiProgram: 56,  transposeSemitones: 2   },
  { id: 'hornF',        name: 'French Horn',   shortName: 'Hn.',   family: 'brass',      defaultClef: 'treble', midiProgram: 60,  transposeSemitones: 7   },
  { id: 'trombone',     name: 'Trombone',      shortName: 'Tbn.',  family: 'brass',      defaultClef: 'bass',   midiProgram: 57,  transposeSemitones: 0   },
  { id: 'tuba',         name: 'Tuba',          shortName: 'Tba.',  family: 'brass',      defaultClef: 'bass',   midiProgram: 58,  transposeSemitones: 0   },

  // ── Keyboards ────────────────────────────────────────────────────────────────
  { id: 'piano',        name: 'Piano',         shortName: 'Pno.',  family: 'keyboards',  defaultClef: 'treble', midiProgram: 0,   transposeSemitones: 0   },
  { id: 'organ',        name: 'Organ',         shortName: 'Org.',  family: 'keyboards',  defaultClef: 'treble', midiProgram: 19,  transposeSemitones: 0   },
  { id: 'harpsichord',  name: 'Harpsichord',   shortName: 'Hpd.',  family: 'keyboards',  defaultClef: 'treble', midiProgram: 6,   transposeSemitones: 0   },
  { id: 'celesta',      name: 'Celesta',        shortName: 'Cel.',  family: 'keyboards',  defaultClef: 'treble', midiProgram: 8,   transposeSemitones: -12 },

  // ── Voices ───────────────────────────────────────────────────────────────────
  { id: 'soprano',      name: 'Soprano',       shortName: 'S.',    family: 'voices',     defaultClef: 'treble', midiProgram: 52,  transposeSemitones: 0   },
  { id: 'alto',         name: 'Alto',          shortName: 'A.',    family: 'voices',     defaultClef: 'treble', midiProgram: 52,  transposeSemitones: 0   },
  { id: 'tenor',        name: 'Tenor',         shortName: 'T.',    family: 'voices',     defaultClef: 'treble', midiProgram: 52,  transposeSemitones: 12  },
  { id: 'bass',         name: 'Bass',          shortName: 'B.',    family: 'voices',     defaultClef: 'bass',   midiProgram: 52,  transposeSemitones: 0   },

  // ── Percussion ───────────────────────────────────────────────────────────────
  { id: 'timpani',      name: 'Timpani',       shortName: 'Tmp.',  family: 'percussion', defaultClef: 'bass',   midiProgram: 47,  transposeSemitones: 0   },
  { id: 'vibraphone',   name: 'Vibraphone',    shortName: 'Vib.',  family: 'percussion', defaultClef: 'treble', midiProgram: 11,  transposeSemitones: 0   },
]

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
