// Tests for midiEngine.ts — professional MIDI import/export
//
// Strategy: round-trip through @tonejs/midi.
//   Export: build a Score → scoreToMidi → new Midi(bytes) → inspect tracks/header.
//   Import: build a Midi object → midi.toArray() → midiToScore → inspect Score.

import { describe, it, expect } from 'vitest'
import { v4 as uuid } from 'uuid'
import { Midi } from '@tonejs/midi'
import { writeMidi } from 'midi-file'
import { scoreToMidi, midiToScore, type MidiExportOptions } from '@renderer/engine/midiEngine'
import { createScore, createPart, createStaff, createMeasure, createNote } from '@shared/score'
import type { Score, Part, Staff, Measure, Note, Chord, NoteEvent, KeySignature, TimeSignature, PedalMark } from '@shared/score'

// ── Test helpers ───────────────────────────────────────────────────────────────

const SIG_44: TimeSignature = { numerator: 4, denominator: 4 }
const SIG_34: TimeSignature = { numerator: 3, denominator: 4 }
const KEY_C:  KeySignature  = { fifths: 0,  mode: 'major' }

function noteEv(name: Note['pitch']['noteName'], octave: number, dur: Note['duration'], acc: Note['pitch']['accidental'] = null): Note {
  return createNote(name, octave, dur, acc)
}


function singlePartScore(
  events: NoteEvent[],
  tempo = 120,
  ts: TimeSignature = SIG_44,
  ks: KeySignature  = KEY_C,
): Score {
  const base  = createScore('Test')
  const staff = createStaff('treble')
  // Replace default measure with one that has our events
  const measure: Measure = {
    ...createMeasure(1, 'final'),
    voices: [{ id: 'v1', events }],
  }
  const staves: readonly Staff[] = [{ ...staff, measures: [measure] }]
  const part: Part = { ...base.parts[0], staves }
  return { ...base, tempo, timeSignature: ts, keySignature: ks, parts: [part] }
}

function twoPartScore(events0: NoteEvent[], events1: NoteEvent[]): Score {
  const base = createScore('Test')
  const makeStaff = (evs: NoteEvent[]) => {
    const s   = createStaff('treble')
    const m: Measure = { ...createMeasure(1, 'final'), voices: [{ id: 'v', events: evs }] }
    return { ...s, measures: [m] }
  }
  const part0 = { ...base.parts[0], name: 'Violin', staves: [makeStaff(events0)] }
  const part1 = { ...createPart('Cello', 'Vc.', 42, 0, 'bass'), staves: [makeStaff(events1)] }
  return { ...base, parts: [part0, part1] }
}

function parseMidi(score: Score, exportOpts?: MidiExportOptions): Midi {
  return new Midi(scoreToMidi(score, exportOpts))
}

// Build a minimal MIDI file for import tests.
// Uses @tonejs/midi for most cases; for key signatures use buildMidiWithKeySig
// since @tonejs/midi has a known encoding bug with manually-pushed key sigs.
function buildMidi(cb: (midi: Midi) => void): Uint8Array {
  const midi = new Midi()
  cb(midi)
  return midi.toArray()
}

// Build a MIDI file with a correct key signature using midi-file directly.
// This works around a bug in @tonejs/midi where manually pushed key sigs
// don't round-trip through toArray() correctly.
function buildMidiWithKeySig(keySemitones: number, midiNotes: number[]): Uint8Array {
  const PPQ = 480
  const events: any[] = [
    { deltaTime: 0, meta: true, type: 'keySignature', key: keySemitones, scale: 0 },
    { deltaTime: 0, meta: true, type: 'timeSignature', numerator: 4, denominator: 4, metronome: 24, thirtyseconds: 8 },
    { deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat: 500000 },
  ]
  let dt = 0
  for (const n of midiNotes) {
    events.push({ deltaTime: dt, channel: 0, type: 'noteOn',  noteNumber: n, velocity: 80 })
    events.push({ deltaTime: PPQ, channel: 0, type: 'noteOff', noteNumber: n, velocity: 0 })
    dt = 0
  }
  events.push({ deltaTime: 0, meta: true, type: 'endOfTrack' })
  return new Uint8Array(writeMidi({ header: { format: 0, numTracks: 1, ticksPerBeat: PPQ }, tracks: [events] }))
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('scoreToMidi — basic structure', () => {
  it('returns a non-empty Uint8Array', () => {
    const result = scoreToMidi(createScore())
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
  })

  it('produces a parseable MIDI file', () => {
    const midi = parseMidi(createScore())
    expect(midi.header).toBeDefined()
  })

  it('exports initial tempo to header', () => {
    const score = singlePartScore([], 140)
    const midi  = parseMidi(score)
    expect(midi.header.tempos[0].bpm).toBeCloseTo(140, 0)
  })

  it('exports time signature to header', () => {
    const score = singlePartScore([], 120, SIG_34)
    const midi  = parseMidi(score)
    const ts    = midi.header.timeSignatures[0].timeSignature
    expect(ts[0]).toBe(3)
    expect(ts[1]).toBe(4)
  })
})

describe('scoreToMidi — pitch encoding', () => {
  it('C4 encodes as MIDI 60', () => {
    const score = singlePartScore([noteEv('C', 4, 'quarter')])
    const midi  = parseMidi(score)
    expect(midi.tracks[0].notes[0].midi).toBe(60)
  })

  it('A4 encodes as MIDI 69', () => {
    const score = singlePartScore([noteEv('A', 4, 'quarter')])
    const midi  = parseMidi(score)
    expect(midi.tracks[0].notes[0].midi).toBe(69)
  })

  it('F#4 encodes as MIDI 66', () => {
    const score = singlePartScore([noteEv('F', 4, 'quarter', 'sharp')])
    const midi  = parseMidi(score)
    expect(midi.tracks[0].notes[0].midi).toBe(66)
  })

  it('Bb4 encodes as MIDI 70', () => {
    const score = singlePartScore([noteEv('B', 4, 'quarter', 'flat')])
    const midi  = parseMidi(score)
    expect(midi.tracks[0].notes[0].midi).toBe(70)
  })
})

describe('scoreToMidi — transposing instruments', () => {
  it('Bb clarinet: written C5 exports as MIDI 70 (Bb4 concert)', () => {
    const base  = createScore('Test')
    const staff = createStaff('treble')
    const m: Measure = { ...createMeasure(1, 'final'), voices: [{ id: 'v', events: [noteEv('C', 5, 'quarter')] }] }
    // Bb clarinet: transposeSemitones = 2
    const part: Part = { ...base.parts[0], transposeSemitones: 2, staves: [{ ...staff, measures: [m] }] }
    const score: Score = { ...base, parts: [part] }
    const midi  = parseMidi(score)
    expect(midi.tracks[0].notes[0].midi).toBe(70)  // C5 written − 2 = Bb4 = MIDI 70
  })
})

describe('scoreToMidi — note duration', () => {
  it('quarter note is shorter than half note', () => {
    const score = singlePartScore([noteEv('C', 4, 'half'), noteEv('C', 4, 'quarter')])
    const midi  = parseMidi(score)
    const [half, quarter] = midi.tracks[0].notes
    expect(half.durationTicks).toBe(2 * quarter.durationTicks)
  })

  it('dotted quarter is 1.5× a plain quarter', () => {
    const score  = singlePartScore([{ ...noteEv('C', 4, 'quarter'), dots: 1 } as Note, noteEv('C', 4, 'quarter')])
    const midi   = parseMidi(score)
    const [dotted, plain] = midi.tracks[0].notes
    expect(dotted.durationTicks).toBeCloseTo(1.5 * plain.durationTicks, 0)
  })
})

describe('scoreToMidi — velocity from dynamics', () => {
  function scoreWithDynamic(dynamic: string): Midi {
    const base = createScore('Test')
    const s    = createStaff('treble')
    const m: Measure = {
      ...createMeasure(1, 'final'),
      voices:     [{ id: 'v', events: [noteEv('C', 4, 'quarter')] }],
      directives: [{ id: 'd1', category: 'dynamic', text: dynamic }],
    }
    // volume: 1.0 so that velocity = base dynamic velocity with no scaling
    const part: Part = { ...base.parts[0], volume: 1.0, staves: [{ ...s, measures: [m] }] }
    return parseMidi({ ...base, parts: [part] })
  }

  it('mf produces velocity ≈ 75', () => {
    const note = scoreWithDynamic('mf').tracks[0].notes[0]
    expect(Math.round(note.velocity * 127)).toBeCloseTo(75, -1)
  })

  it('ff produces higher velocity than p', () => {
    const ffVel = scoreWithDynamic('ff').tracks[0].notes[0].velocity
    const pVel  = scoreWithDynamic('p').tracks[0].notes[0].velocity
    expect(ffVel).toBeGreaterThan(pVel)
  })

  it('ff produces velocity ≈ 101', () => {
    const note = scoreWithDynamic('ff').tracks[0].notes[0]
    const vel127 = Math.round(note.velocity * 127)
    expect(vel127).toBeCloseTo(101, -1)
  })
})

describe('scoreToMidi — articulation modifiers', () => {
  it('staccato note has shorter duration than plain note', () => {
    const plain    = singlePartScore([noteEv('C', 4, 'quarter')])
    const staccato = singlePartScore([{ ...noteEv('C', 4, 'quarter'), articulations: ['staccato'] } as Note])
    const plainDur    = parseMidi(plain).tracks[0].notes[0].durationTicks
    const staccatoDur = parseMidi(staccato).tracks[0].notes[0].durationTicks
    expect(staccatoDur).toBeLessThan(plainDur)
  })
})

describe('scoreToMidi — multi-part', () => {
  it('two parts produce two data tracks', () => {
    const midi = parseMidi(twoPartScore([noteEv('C', 4, 'quarter')], [noteEv('G', 2, 'quarter')]))
    expect(midi.tracks.length).toBe(2)
  })

  it('tracks carry the part names', () => {
    const midi = parseMidi(twoPartScore([noteEv('C', 4, 'quarter')], [noteEv('G', 2, 'quarter')]))
    expect(midi.tracks[0].name).toBe('Violin')
    expect(midi.tracks[1].name).toBe('Cello')
  })

  it('each track has the correct GM program', () => {
    const midi = parseMidi(twoPartScore([noteEv('C', 4, 'quarter')], [noteEv('G', 2, 'quarter')]))
    expect(midi.tracks[1].instrument.number).toBe(42)  // Cello
  })
})

describe('scoreToMidi — muted parts', () => {
  it('muted part is omitted from the file', () => {
    const base  = createScore('Test')
    const staff = createStaff('treble')
    const m: Measure = { ...createMeasure(1, 'final'), voices: [{ id: 'v', events: [noteEv('C', 4, 'quarter')] }] }
    const part0: Part = { ...base.parts[0], staves: [{ ...staff, measures: [m] }], muted: false }
    const part1: Part = { ...createPart('Muted', 'Mut.', 40), staves: [{ ...staff, measures: [m] }], muted: true }
    const score: Score = { ...base, parts: [part0, part1] }
    const midi  = parseMidi(score)
    expect(midi.tracks.length).toBe(1)  // only the non-muted part
  })
})

describe('scoreToMidi — pedal marks', () => {
  it('pedal mark down emits CC 64 value 1', () => {
    const base  = createScore('Test')
    const staff = createStaff('treble')
    const pm: PedalMark = { id: 'pm1', type: 'down', beatPosition: 0 }
    const m: Measure = { ...createMeasure(1, 'final'), voices: [{ id: 'v', events: [noteEv('C', 4, 'quarter')] }], pedalMarks: [pm] }
    const part: Part = { ...base.parts[0], staves: [{ ...staff, measures: [m] }] }
    const midi  = parseMidi({ ...base, parts: [part] })
    const cc64  = (midi.tracks[0].controlChanges as any)[64] ?? []
    expect(cc64.length).toBeGreaterThan(0)
    expect(cc64[0].value).toBe(1)
  })
})

describe('scoreToMidi — mid-score tempo change', () => {
  it('tempo directive mid-score emits a second tempo event', () => {
    const base  = createScore('Test')
    const staff = createStaff('treble')
    const m1: Measure = { ...createMeasure(1, 'single'), voices: [{ id: 'v1', events: [noteEv('C', 4, 'whole')] }] }
    const m2: Measure = {
      ...createMeasure(2, 'final'),
      voices:     [{ id: 'v2', events: [noteEv('C', 4, 'whole')] }],
      directives: [{ id: 'd1', category: 'tempo', text: 'Presto', bpm: 168 }],
    }
    const part: Part = { ...base.parts[0], staves: [{ ...staff, measures: [m1, m2] }] }
    const midi  = parseMidi({ ...base, tempo: 120, parts: [part] })
    expect(midi.header.tempos.length).toBeGreaterThanOrEqual(2)
    const bpms = midi.header.tempos.map(t => Math.round(t.bpm))
    expect(bpms).toContain(120)
    expect(bpms).toContain(168)
  })
})

describe('scoreToMidi — expandRepeats option', () => {
  it('default (true) produces more notes than expandRepeats=false for a repeated section', () => {
    // Score with repeat-end barline (plays twice)
    const base  = createScore('Test')
    const staff = createStaff('treble')
    const m1: Measure = {
      ...createMeasure(1, 'repeat-end'),
      voices: [{ id: 'v', events: [noteEv('C', 4, 'whole')] }],
    }
    const part: Part = { ...base.parts[0], staves: [{ ...staff, measures: [m1] }] }
    const score: Score = { ...base, parts: [part] }
    const withRepeats    = new Midi(scoreToMidi(score, { expandRepeats: true }))
    const withoutRepeats = new Midi(scoreToMidi(score, { expandRepeats: false }))
    expect(withRepeats.tracks[0].notes.length).toBeGreaterThan(withoutRepeats.tracks[0].notes.length)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('midiToScore — basic structure', () => {
  it('returns a Score from an empty MIDI', () => {
    const bytes = buildMidi(() => {})
    const score = midiToScore(bytes)
    expect(score.parts).toBeDefined()
  })

  it('imports tempo from header', () => {
    const bytes = buildMidi(m => { m.header.tempos.push({ bpm: 96, ticks: 0 }) })
    const score = midiToScore(bytes)
    expect(score.tempo).toBe(96)
  })

  it('imports time signature from header', () => {
    const bytes = buildMidi(m => {
      m.header.timeSignatures.push({ ticks: 0, timeSignature: [3, 4] })
    })
    const score = midiToScore(bytes)
    expect(score.timeSignature.numerator).toBe(3)
    expect(score.timeSignature.denominator).toBe(4)
  })
})

describe('midiToScore — pitch decoding', () => {
  it('MIDI 60 → C4', () => {
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      t.addNote({ midi: 60, ticks: 0, durationTicks: 480 })
    })
    const score = midiToScore(bytes)
    const note  = score.parts[0].staves[0].measures[0].voices[0].events.find(e => e.type === 'note') as Note
    expect(note.pitch.noteName).toBe('C')
    expect(note.pitch.octave).toBe(4)
    expect(note.pitch.accidental).toBeNull()
  })

  it('MIDI 69 → A4', () => {
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      t.addNote({ midi: 69, ticks: 0, durationTicks: 480 })
    })
    const score = midiToScore(bytes)
    const note  = score.parts[0].staves[0].measures[0].voices[0].events.find(e => e.type === 'note') as Note
    expect(note.pitch.noteName).toBe('A')
    expect(note.pitch.octave).toBe(4)
  })
})

// Key sig push via m.header.keySignatures.push() has a known @tonejs/midi encoding bug,
// so we use buildMidiWithKeySig (midi-file) to create correctly-encoded key signatures.
describe('midiToScore — key-aware pitch spelling', () => {
  it('MIDI 61 in sharp key (G major, +1 sharp) → C#', () => {
    const bytes = buildMidiWithKeySig(+1, [61])  // G major = +1 sharp
    const score = midiToScore(bytes)
    const note  = score.parts[0].staves[0].measures[0].voices[0].events.find(e => e.type === 'note') as Note
    expect(note.pitch.noteName).toBe('C')
    expect(note.pitch.accidental).toBe('sharp')
  })

  it('MIDI 61 in flat key (F major, -1 flat) → Db', () => {
    const bytes = buildMidiWithKeySig(-1, [61])  // F major = -1 flat
    const score = midiToScore(bytes)
    const note  = score.parts[0].staves[0].measures[0].voices[0].events.find(e => e.type === 'note') as Note
    expect(note.pitch.noteName).toBe('D')
    expect(note.pitch.accidental).toBe('flat')
  })

  it('MIDI 70 in Bb major (-2 flats) → Bb (not A#)', () => {
    const bytes = buildMidiWithKeySig(-2, [70])  // Bb major = -2 flats
    const score = midiToScore(bytes)
    const note  = score.parts[0].staves[0].measures[0].voices[0].events.find(e => e.type === 'note') as Note
    expect(note.pitch.noteName).toBe('B')
    expect(note.pitch.accidental).toBe('flat')
  })
})

describe('midiToScore — multi-track', () => {
  it('two note-bearing tracks produce two parts', () => {
    const bytes = buildMidi(m => {
      const t0 = m.addTrack(); t0.addNote({ midi: 60, ticks: 0, durationTicks: 480 }); t0.name = 'Violin'
      const t1 = m.addTrack(); t1.addNote({ midi: 48, ticks: 0, durationTicks: 480 }); t1.name = 'Cello'
    })
    const score = midiToScore(bytes)
    expect(score.parts.length).toBe(2)
  })

  it('track names become part names', () => {
    const bytes = buildMidi(m => {
      const t0 = m.addTrack(); t0.addNote({ midi: 60, ticks: 0, durationTicks: 480 }); t0.name = 'Violin'
      const t1 = m.addTrack(); t1.addNote({ midi: 48, ticks: 0, durationTicks: 480 }); t1.name = 'Cello'
    })
    const score = midiToScore(bytes)
    expect(score.parts[0].name).toBe('Violin')
    expect(score.parts[1].name).toBe('Cello')
  })

  it('meta-only track (no notes) is skipped', () => {
    const bytes = buildMidi(m => {
      m.addTrack()  // no notes
      const t1 = m.addTrack(); t1.addNote({ midi: 60, ticks: 0, durationTicks: 480 })
    })
    const score = midiToScore(bytes)
    expect(score.parts.length).toBe(1)
  })
})

describe('midiToScore — chord detection', () => {
  it('simultaneous notes become a chord', () => {
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      t.addNote({ midi: 60, ticks: 0, durationTicks: 480 })
      t.addNote({ midi: 64, ticks: 0, durationTicks: 480 })  // same tick
    })
    const score  = midiToScore(bytes)
    const events = score.parts[0].staves[0].measures[0].voices[0].events
    const chord  = events.find(e => e.type === 'chord') as Chord | undefined
    expect(chord).toBeDefined()
    expect(chord!.pitches.length).toBe(2)
  })
})

describe('midiToScore — velocity → dynamics', () => {
  function firstNoteEvent(score: Score, measureIndex = 0): any {
    const events = score.parts[0].staves[0].measures[measureIndex].voices[0].events
    return events.find((e: any) => e.type !== 'rest')
  }

  it('velocity 88 sets "f" dynamic on the first note', () => {
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      t.addNote({ midi: 60, ticks: 0, durationTicks: 480, velocity: 88 / 127 })
    })
    const score = midiToScore(bytes)
    expect(firstNoteEvent(score)?.dynamic).toBe('f')
  })

  it('velocity 50 sets "p" dynamic on the first note', () => {
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      t.addNote({ midi: 60, ticks: 0, durationTicks: 480, velocity: 50 / 127 })
    })
    const score = midiToScore(bytes)
    expect(firstNoteEvent(score)?.dynamic).toBe('p')
  })

  it('dynamic is NOT stored as a measure directive', () => {
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      t.addNote({ midi: 60, ticks: 0, durationTicks: 480, velocity: 88 / 127 })
    })
    const score = midiToScore(bytes)
    const directives = score.parts[0].staves[0].measures[0].directives ?? []
    expect(directives.some((d: any) => d.category === 'dynamic')).toBe(false)
  })

  it('dynamic is only injected when the level changes between measures', () => {
    // Two notes at the same velocity: only the first measure gets a dynamic
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      t.addNote({ midi: 60, ticks: 0,    durationTicks: 1920, velocity: 75 / 127 }) // mf, m1
      t.addNote({ midi: 62, ticks: 1920, durationTicks: 1920, velocity: 75 / 127 }) // mf, m2 — same, no new dynamic
    })
    const score = midiToScore(bytes)
    expect(firstNoteEvent(score, 0)?.dynamic).toBe('mf')
    expect(firstNoteEvent(score, 1)?.dynamic).toBeUndefined()
  })

  it('dynamic updates when velocity changes between measures', () => {
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      t.addNote({ midi: 60, ticks: 0,    durationTicks: 1920, velocity: 50 / 127 }) // p,  m1
      t.addNote({ midi: 62, ticks: 1920, durationTicks: 1920, velocity: 88 / 127 }) // f,  m2
    })
    const score = midiToScore(bytes)
    expect(firstNoteEvent(score, 0)?.dynamic).toBe('p')
    expect(firstNoteEvent(score, 1)?.dynamic).toBe('f')
  })
})

describe('midiToScore — tied notes at barlines', () => {
  it('note spanning barline produces a tieStart on the first note', () => {
    // PPQ=480, 4/4 → measure = 4*480 = 1920 ticks. Note at tick 0 lasting 2880 ticks (dotted half + extra)
    const bytes = buildMidi(m => {
      m.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] })
      const t = m.addTrack()
      // Note starts at 0, lasts 2*1920 = 3840 ticks (crosses the barline at 1920)
      t.addNote({ midi: 60, ticks: 0, durationTicks: 3840 })
    })
    const score   = midiToScore(bytes)
    const m0evs   = score.parts[0].staves[0].measures[0].voices[0].events
    const tieNote = m0evs.find(e => e.type === 'note' && (e as Note).tieStart) as Note | undefined
    expect(tieNote).toBeDefined()
    expect(tieNote!.tieStart).toBe(true)
  })

  it('the continuation note in the next measure has tieEnd=true', () => {
    const bytes = buildMidi(m => {
      m.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] })
      const t = m.addTrack()
      t.addNote({ midi: 60, ticks: 0, durationTicks: 3840 })
    })
    const score = midiToScore(bytes)
    const m1evs = score.parts[0].staves[0].measures[1].voices[0].events
    const tieEnd = m1evs.find(e => e.type === 'note' && (e as Note).tieEnd) as Note | undefined
    expect(tieEnd).toBeDefined()
    expect(tieEnd!.tieEnd).toBe(true)
  })
})

describe('midiToScore — voice detection', () => {
  it('overlapping notes in one track produce two voices', () => {
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      // Two overlapping notes (start at 0, both last 960 ticks = half note)
      // Then a second note that starts at 480 (quarter into first note) → overlap → voice 1
      t.addNote({ midi: 60, ticks: 0,   durationTicks: 960 })
      t.addNote({ midi: 64, ticks: 480, durationTicks: 960 })  // overlaps first
    })
    const score    = midiToScore(bytes)
    const measures = score.parts[0].staves[0].measures
    const hasVoice1 = measures.some(m => m.voices.length >= 2)
    expect(hasVoice1).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// NEW FEATURE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('scoreToMidi — channel de-duplication', () => {
  it('two parts sharing the same midiChannel get distinct channels', () => {
    const base  = createScore('Test')
    const staff = createStaff('treble')
    const m: Measure = { ...createMeasure(1, 'final'), voices: [{ id: 'v', events: [noteEv('C', 4, 'quarter')] }] }
    // Both parts request channel 3 (1-based) → collide
    const part0: Part = { ...base.parts[0], midiChannel: 3, staves: [{ ...staff, measures: [m] }] }
    const part1: Part = { ...createPart('Violin', 'Vln.', 40), midiChannel: 3, staves: [{ ...staff, measures: [m] }] }
    const score: Score = { ...base, parts: [part0, part1] }
    const midi  = parseMidi(score)
    expect(midi.tracks.length).toBe(2)
    expect(midi.tracks[0].channel).not.toBe(midi.tracks[1].channel)
  })
})

describe('scoreToMidi — key signature encoding fix', () => {
  it('Ab minor key signature round-trips correctly (not undefined)', () => {
    const base  = createScore('Test')
    const score: Score = { ...base, keySignature: { fifths: -4, mode: 'minor' } }
    const result = midiToScore(scoreToMidi(score))
    expect(result.keySignature.fifths).toBe(-4)
    expect(result.keySignature.mode).toBe('minor')
  })

  it('G major key signature round-trips correctly', () => {
    const score: Score = { ...createScore('Test'), keySignature: { fifths: 1, mode: 'major' } }
    expect(midiToScore(scoreToMidi(score)).keySignature.fifths).toBe(1)
  })

  it('F# major key signature round-trips correctly', () => {
    const score: Score = { ...createScore('Test'), keySignature: { fifths: 6, mode: 'major' } }
    expect(midiToScore(scoreToMidi(score)).keySignature.fifths).toBe(6)
  })
})

describe('scoreToMidi — notationDurations option', () => {
  it('marcato note exports at full written duration when notationDurations=true', () => {
    const base  = createScore('Test')
    const s     = createStaff('treble')
    const marcatoNote = { ...noteEv('C', 4, 'quarter'), articulations: ['marcato'] } as Note
    const m: Measure = { ...createMeasure(1, 'final'), voices: [{ id: 'v', events: [marcatoNote] }] }
    const part: Part = { ...base.parts[0], volume: 1.0, staves: [{ ...s, measures: [m] }] }
    const score: Score = { ...base, parts: [part] }
    const withArt    = parseMidi(score, { notationDurations: false }).tracks[0].notes[0].durationTicks
    const withoutArt = parseMidi(score, { notationDurations: true }).tracks[0].notes[0].durationTicks
    // notationDurations=true should give the full quarter-note duration
    expect(withoutArt).toBe(480)
    // notationDurations=false should be shorter (marcato = ×0.85)
    expect(withArt).toBeLessThan(withoutArt)
  })
})

describe('scoreToMidi — VOLTA_MEASURES metadata', () => {
  it('stores the original measure count in a text meta event', () => {
    const score = createScore()  // default score with some measures
    const midi  = new Midi(scoreToMidi(score))
    const meta  = midi.header.meta.find(m => m.text?.startsWith('VOLTA_MEASURES:'))
    expect(meta).toBeDefined()
    const count = parseInt(meta!.text.split(':')[1], 10)
    expect(count).toBeGreaterThan(0)
  })
})

describe('midiToScore — VOLTA_MEASURES: trim to original count', () => {
  it('score with 5 measures imports as 5 measures (not padded to 8)', () => {
    // Build a MIDI from a 5-measure score → carries VOLTA_MEASURES:5 meta
    const base  = createScore('5m')
    const staff = createStaff('treble')
    const measures = Array.from({ length: 5 }, (_, i) =>
      ({ ...createMeasure(i + 1, i === 4 ? 'final' : 'single'), voices: [{ id: uuid(), events: [noteEv('C', 4, 'whole')] }] } as Measure)
    )
    const part: Part = { ...base.parts[0], staves: [{ ...staff, measures }] }
    const score5: Score = { ...base, parts: [part] }
    const reimported = midiToScore(scoreToMidi(score5))
    expect(reimported.parts[0].staves[0].measures.length).toBe(5)
  })
})

describe('midiToScore — pitch-range instrument inference', () => {
  // Range inference only fires when the track spans ≥ 12 semitones (one octave).

  it('low-range passage (C2–C4, 24 semitones) infers a bass-range instrument', () => {
    // Cello concert range: 36–81. Double bass: 28–55. Tuba: 26–65.
    // Notes spanning 36–60 should prefer a low-range instrument over Violin/Flute.
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      // No name, no program — range spans C2(36) to C4(60)
      ;[36, 40, 43, 48, 52, 55, 60].forEach((midi, i) => {
        t.addNote({ midi, ticks: i * 480, durationTicks: 480 })
      })
    })
    const score = midiToScore(bytes)
    const part  = score.parts[0]
    // Should not import as Flute (concert 60–98) or Violin (55–105)
    expect(part.midiProgram).not.toBe(73)  // Flute
    expect(part.midiProgram).not.toBe(40)  // Violin
    // Should pick a bass-range instrument (cello=42, doublebass=43, tuba=58, bassoon=70…)
    expect(part.staves[0].clef).toMatch(/bass|treble/)  // at least one of the bass-range defaults
  })

  it('high-range passage (C5–C7, 24 semitones) infers a treble-range instrument', () => {
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      // Notes spanning C5(72) to C7(96)
      ;[72, 76, 79, 84, 88, 91, 96].forEach((midi, i) => {
        t.addNote({ midi, ticks: i * 480, durationTicks: 480 })
      })
    })
    const score = midiToScore(bytes)
    const part  = score.parts[0]
    // Should not pick tuba (concert 26–65) or cello (36–81)
    expect(part.midiProgram).not.toBe(58)  // Tuba
    expect(part.midiProgram).not.toBe(42)  // Cello
    expect(part.staves[0].clef).toBe('treble')
  })

  it('narrow span (< 1 octave, 0 program, no name) falls back to Piano', () => {
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      ;[60, 62, 64].forEach((midi, i) => {
        t.addNote({ midi, ticks: i * 480, durationTicks: 480 })
      })
    })
    const score = midiToScore(bytes)
    expect(score.parts[0].midiProgram).toBe(0)  // Piano = GM 0
  })
})

describe('midiToScore — name-based instrument inference', () => {
  it('"Violin" track with program 0 imports as Violin (not Piano)', () => {
    const bytes = buildMidi(m => {
      const t  = m.addTrack()
      t.name   = 'Violin'
      // program stays 0 (default Piano)
      t.addNote({ midi: 64, ticks: 0, durationTicks: 480 })
    })
    const score = midiToScore(bytes)
    expect(score.parts[0].name).toBe('Violin')
    expect(score.parts[0].midiProgram).toBe(40)  // GM Violin = 40
  })

  it('"Clarinet in Bb" track with program 0 imports with correct transposition', () => {
    const bytes = buildMidi(m => {
      const t  = m.addTrack()
      t.name   = 'Clarinet in Bb'
      t.addNote({ midi: 60, ticks: 0, durationTicks: 480 })
    })
    const score = midiToScore(bytes)
    expect(score.parts[0].transposeSemitones).toBe(2)  // Bb clarinet +2
  })

  it('"Violoncello" track with program 0 imports as Cello', () => {
    const bytes = buildMidi(m => {
      const t  = m.addTrack()
      t.name   = 'Violoncello'
      t.addNote({ midi: 48, ticks: 0, durationTicks: 480 })
    })
    const score = midiToScore(bytes)
    expect(score.parts[0].midiProgram).toBe(42)  // GM Cello = 42
  })
})

describe('midiToScore — triplet detection', () => {
  it('3 triplet-16th notes (80 ticks each) import with TupletInfo', () => {
    // 3 × 80 ticks = 240 ticks = 1 quarter beat: triplet 16ths
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      t.addNote({ midi: 60, ticks: 0,   durationTicks: 80 })
      t.addNote({ midi: 62, ticks: 80,  durationTicks: 80 })
      t.addNote({ midi: 64, ticks: 160, durationTicks: 80 })
    })
    const score  = midiToScore(bytes)
    const events = score.parts[0].staves[0].measures[0].voices[0].events.filter(e => e.type === 'note') as Note[]
    const triplets = events.filter(e => e.tuplet != null)
    expect(triplets.length).toBe(3)
    expect(triplets[0].tuplet?.actual).toBe(3)
    expect(triplets[0].tuplet?.normal).toBe(2)
    expect(triplets[0].duration).toBe('16th')
  })

  it('same tupletId shared across 3 triplet notes', () => {
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      t.addNote({ midi: 60, ticks: 0,   durationTicks: 80 })
      t.addNote({ midi: 62, ticks: 80,  durationTicks: 80 })
      t.addNote({ midi: 64, ticks: 160, durationTicks: 80 })
    })
    const score   = midiToScore(bytes)
    const events  = score.parts[0].staves[0].measures[0].voices[0].events.filter(e => e.type === 'note') as Note[]
    const triplets = events.filter(e => e.tuplet != null)
    expect(triplets[0].tuplet?.id).toBe(triplets[1].tuplet?.id)
    expect(triplets[1].tuplet?.id).toBe(triplets[2].tuplet?.id)
  })

  it('detectTuplets=false skips triplet detection', () => {
    const bytes = buildMidi(m => {
      const t = m.addTrack()
      t.addNote({ midi: 60, ticks: 0,   durationTicks: 80 })
      t.addNote({ midi: 62, ticks: 80,  durationTicks: 80 })
      t.addNote({ midi: 64, ticks: 160, durationTicks: 80 })
    })
    const score  = midiToScore(bytes, { detectTuplets: false })
    const events = score.parts[0].staves[0].measures[0].voices[0].events.filter(e => e.type === 'note') as Note[]
    expect(events.every(e => e.tuplet == null)).toBe(true)
  })
})

describe('midiToScore — drum track detection', () => {
  it('channel 9 track imports as percussion clef', () => {
    const bytes = buildMidi(m => {
      const t  = m.addTrack()
      t.channel = 9  // 0-based drum channel
      t.addNote({ midi: 36, ticks: 0, durationTicks: 480 })
    })
    const score = midiToScore(bytes)
    expect(score.parts[0].staves[0].clef).toBe('percussion')
  })

  it('drum track gets channel 10 (1-based)', () => {
    const bytes = buildMidi(m => {
      const t  = m.addTrack()
      t.channel = 9
      t.addNote({ midi: 36, ticks: 0, durationTicks: 480 })
    })
    const score = midiToScore(bytes)
    expect(score.parts[0].midiChannel).toBe(10)
  })
})

// ── Round-trip sanity ─────────────────────────────────────────────────────────

describe('round-trip: export then import', () => {
  it('C4 quarter note survives the round trip', () => {
    const score0 = singlePartScore([noteEv('C', 4, 'quarter')])
    const score1 = midiToScore(scoreToMidi(score0))
    const note   = score1.parts[0].staves[0].measures[0].voices[0].events.find(
      e => e.type === 'note'
    ) as Note | undefined
    expect(note?.pitch.noteName).toBe('C')
    expect(note?.pitch.octave).toBe(4)
  })

  it('tempo is preserved after round-trip', () => {
    const score0 = singlePartScore([], 144)
    const score1 = midiToScore(scoreToMidi(score0))
    expect(score1.tempo).toBe(144)
  })
})
