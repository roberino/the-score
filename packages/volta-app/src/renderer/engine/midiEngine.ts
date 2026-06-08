// ─────────────────────────────────────────────────────────────────────────────
// MIDI import / export  (professional DAW quality)
//
// scoreToMidi  — Score → Uint8Array (MIDI Type 1, multi-track)
// midiToScore  — Uint8Array → Score (multi-part, dynamics, ties, triplets)
//
// Uses @tonejs/midi for binary encoding/decoding.
// Duration arithmetic is in 64th-note units (quarter = 16 units = 480 ticks at PPQ 480).
// ─────────────────────────────────────────────────────────────────────────────

import { Midi } from '@tonejs/midi'
import { v4 as uuid } from 'uuid'
import { INSTRUMENTS } from '@shared/instruments'
import type { InstrumentDef } from '@shared/instruments'
import {
  createScore, createNote, createRest,
  type Score, type Part, type Measure,
  type Note, type Chord, type Rest, type NoteEvent,
  type Duration, type Pitch, type Accidental, type NoteName,
  type BarlineType, type TimeSignature, type KeySignature, type DynamicLevel,
  type Hairpin, type TupletInfo,
} from '@shared/score'
import {
  measureCapacityUnits, resolveTimeSig, resolveDirectiveTempo,
  articulationPlaybackMods, buildPlaybackSequence, fillWithRests,
  activeAssignmentAt, DYNAMIC_VELOCITY,
} from '@shared/musicUtils'

// ── Constants ─────────────────────────────────────────────────────────────────

const PPQ = 480
const CHORD_TICK_TOLERANCE = 5
const VOLTA_MEASURES_META  = 'VOLTA_MEASURES:'  // prefix for measure-count meta text

const DURATION_BEATS: Record<Duration, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5,
  '16th': 0.25, '32nd': 0.125, '64th': 0.0625,
}


function inferDynamic(velocity: number): DynamicLevel {
  if (velocity <= 15) return 'pppp'
  if (velocity <= 31) return 'ppp'
  if (velocity <= 47) return 'pp'
  if (velocity <= 59) return 'p'
  if (velocity <= 71) return 'mp'
  if (velocity <= 85) return 'mf'
  if (velocity <= 99) return 'f'
  if (velocity <= 111) return 'ff'
  if (velocity <= 120) return 'fff'
  return 'ffff'
}

// ── Key signature helpers ──────────────────────────────────────────────────────

const FIFTHS_TO_KEY: Record<number, string> = {
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
  [-1]: 'F', [-2]: 'Bb', [-3]: 'Eb', [-4]: 'Ab', [-5]: 'Db', [-6]: 'Gb', [-7]: 'Cb',
}

const KEY_TO_FIFTHS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
}

// ── GM Drum map ────────────────────────────────────────────────────────────────

// MuseScore-convention staff positions for standard GM drum pitches
const GM_DRUM_MAP: Partial<Record<number, Pitch>> = {
  35: { noteName: 'B', octave: 1, accidental: null },    // Bass Drum 2
  36: { noteName: 'C', octave: 2, accidental: null },    // Bass Drum 1
  37: { noteName: 'C', octave: 3, accidental: 'sharp' }, // Side Stick
  38: { noteName: 'D', octave: 3, accidental: null },    // Acoustic Snare
  40: { noteName: 'E', octave: 3, accidental: null },    // Electric Snare
  41: { noteName: 'F', octave: 2, accidental: null },    // Low Floor Tom
  42: { noteName: 'F', octave: 4, accidental: 'sharp' }, // Closed Hi-Hat
  43: { noteName: 'G', octave: 2, accidental: null },    // High Floor Tom
  44: { noteName: 'A', octave: 4, accidental: null },    // Pedal Hi-Hat
  45: { noteName: 'A', octave: 2, accidental: null },    // Low Tom
  46: { noteName: 'B', octave: 4, accidental: null },    // Open Hi-Hat
  47: { noteName: 'B', octave: 2, accidental: null },    // Low-Mid Tom
  48: { noteName: 'C', octave: 3, accidental: null },    // Hi-Mid Tom
  49: { noteName: 'A', octave: 5, accidental: null },    // Crash Cymbal 1
  50: { noteName: 'D', octave: 3, accidental: null },    // High Tom
  51: { noteName: 'E', octave: 5, accidental: null },    // Ride Cymbal 1
  52: { noteName: 'F', octave: 5, accidental: null },    // Chinese Cymbal
  55: { noteName: 'G', octave: 5, accidental: null },    // Splash Cymbal
  57: { noteName: 'A', octave: 5, accidental: 'sharp' }, // Crash Cymbal 2
  59: { noteName: 'B', octave: 5, accidental: null },    // Ride Cymbal 2
}

function drumPitch(midiNum: number): Pitch {
  return GM_DRUM_MAP[midiNum] ?? { noteName: 'C', octave: Math.floor(midiNum / 12) - 1, accidental: null }
}

// ── Pitch helpers ──────────────────────────────────────────────────────────────

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

// Export: written pitch → concert MIDI note number
function pitchToMidiNum(pitch: Pitch, transposeSemitones = 0): number {
  let semi = SEMITONES[pitch.noteName] ?? 0
  if (pitch.accidental === 'sharp')            semi += 1
  else if (pitch.accidental === 'flat')        semi -= 1
  else if (pitch.accidental === 'doubleSharp') semi += 2
  else if (pitch.accidental === 'doubleFlat')  semi -= 2
  return Math.max(0, Math.min(127, (pitch.octave + 1) * 12 + semi - transposeSemitones))
}

// Import: concert MIDI note number → written pitch, key-signature-aware spelling
const SHARP_NAMES: [NoteName, Accidental][] = [
  ['C', null], ['C', 'sharp'], ['D', null], ['D', 'sharp'], ['E', null],
  ['F', null], ['F', 'sharp'], ['G', null], ['G', 'sharp'], ['A', null], ['A', 'sharp'], ['B', null],
]
const FLAT_NAMES: [NoteName, Accidental][] = [
  ['C', null], ['D', 'flat'], ['D', null], ['E', 'flat'], ['E', null],
  ['F', null], ['G', 'flat'], ['G', null], ['A', 'flat'], ['A', null], ['B', 'flat'], ['B', null],
]

function midiToPitch(midiNum: number, keySig: KeySignature): Pitch {
  const octave = Math.floor(midiNum / 12) - 1
  const semi   = midiNum % 12
  const [noteName, accidental] = keySig.fifths >= 0 ? SHARP_NAMES[semi] : FLAT_NAMES[semi]
  return { noteName, octave, accidental }
}

// ── Quantisation ───────────────────────────────────────────────────────────────

type QEntry = { duration: Duration; dots: 0 | 1; units: number }

const QUANTISE_TABLE: QEntry[] = [
  { duration: 'whole',   dots: 1, units: 96 },
  { duration: 'whole',   dots: 0, units: 64 },
  { duration: 'half',    dots: 1, units: 48 },
  { duration: 'half',    dots: 0, units: 32 },
  { duration: 'quarter', dots: 1, units: 24 },
  { duration: 'quarter', dots: 0, units: 16 },
  { duration: 'eighth',  dots: 1, units: 12 },
  { duration: 'eighth',  dots: 0, units: 8  },
  { duration: '16th',    dots: 1, units: 6  },
  { duration: '16th',    dots: 0, units: 4  },
  { duration: '32nd',    dots: 1, units: 3  },
  { duration: '32nd',    dots: 0, units: 2  },
  { duration: '64th',    dots: 0, units: 1  },
]

function quantise(units: number): QEntry {
  return QUANTISE_TABLE.reduce((best, q) =>
    Math.abs(q.units - units) < Math.abs(best.units - units) ? q : best
  )
}

// ── Tick / unit conversion ─────────────────────────────────────────────────────

function unitsToTicks(units: number): number { return Math.round(units * PPQ / 16) }
function ticksToUnits(ticks: number, ppq: number): number { return Math.round((ticks / ppq) * 16) }

function measureTickLen(ts: TimeSignature): number {
  return Math.round(ts.numerator * (4 / ts.denominator) * PPQ)
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export interface MidiExportOptions {
  /** Expand repeat signs before export so the MIDI plays through. Default: true. */
  expandRepeats?: boolean
  /**
   * Export full written note durations, ignoring articulation shortening (marcato, staccato).
   * Prevents phantom rests on re-import. Default: false (shorter notes for DAW realism).
   */
  notationDurations?: boolean
}

// Key event emitted to the conductor track — collected for post-processing.
type KeyEvent = { fifths: number; mode: 'major' | 'minor' }

// @tonejs/midi has a bug: encodes key sigs as keyIndex+7 instead of keyIndex−7,
// so every key comes back as undefined on re-parse. Scan the output bytes for
// FF 59 02 XX YY sequences and overwrite with the correct signed values.
function fixKeySignatureBytes(bytes: Uint8Array, keyEvents: KeyEvent[]): Uint8Array {
  if (keyEvents.length === 0) return bytes
  const result = new Uint8Array(bytes)
  let evIdx = 0
  for (let i = 0; i < result.length - 4 && evIdx < keyEvents.length; i++) {
    if (result[i] === 0xFF && result[i + 1] === 0x59 && result[i + 2] === 0x02) {
      const { fifths, mode } = keyEvents[evIdx]
      result[i + 3] = fifths < 0 ? (256 + fifths) : fifths  // two's complement signed byte
      result[i + 4] = mode === 'major' ? 0 : 1
      evIdx++
      i += 4
    }
  }
  return result
}

// Compute cumulative tick at the start of each position in the playback sequence.
function sequenceTicks(
  refMeasures: readonly Measure[],
  sequence: number[],
  scoreTimeSig: TimeSignature,
): number[] {
  const result: number[] = []
  let tick = 0
  for (const mIdx of sequence) {
    result.push(tick)
    const ts = resolveTimeSig(refMeasures, mIdx, scoreTimeSig)
    tick += measureTickLen(ts)
  }
  return result
}

// Populate the MIDI header and return the ordered list of key events emitted.
function populateConductorEvents(
  midi: Midi,
  score: Score,
  refMeasures: readonly Measure[],
  sequence: number[],
  seqTicks: number[],
): KeyEvent[] {
  const emittedKeys: KeyEvent[] = []

  const pushKey = (fifths: number, mode: 'major' | 'minor', ticks: number) => {
    midi.header.keySignatures.push({ ticks, key: FIFTHS_TO_KEY[fifths] ?? 'C', scale: mode })
    emittedKeys.push({ fifths, mode })
  }

  midi.header.tempos.push({ bpm: score.tempo, ticks: 0 })
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: [score.timeSignature.numerator, score.timeSignature.denominator],
  })
  pushKey(score.keySignature.fifths, score.keySignature.mode, 0)

  let lastBpm    = score.tempo
  let lastTsNum  = score.timeSignature.numerator
  let lastTsDen  = score.timeSignature.denominator
  let lastFifths = score.keySignature.fifths

  for (let si = 1; si < sequence.length; si++) {
    const mIdx    = sequence[si]
    const tick    = seqTicks[si]
    const measure = refMeasures[mIdx]
    if (!measure) continue

    const bpm = resolveDirectiveTempo(refMeasures as Measure[], mIdx, score.tempo)
    if (bpm !== lastBpm) {
      midi.header.tempos.push({ bpm, ticks: tick })
      lastBpm = bpm
    }

    const ts = measure.timeSignature
    if (ts && (ts.numerator !== lastTsNum || ts.denominator !== lastTsDen)) {
      midi.header.timeSignatures.push({ ticks: tick, timeSignature: [ts.numerator, ts.denominator] })
      lastTsNum = ts.numerator
      lastTsDen = ts.denominator
    }

    const ks = measure.keySignature
    if (ks && ks.fifths !== lastFifths) {
      pushKey(ks.fifths, ks.mode, tick)
      lastFifths = ks.fifths
    }
  }

  return emittedKeys
}

// True when the part should use MIDI channel 10 (percussion).
function isDrumPart(part: Part): boolean {
  return part.midiChannel === 10 || part.staves[0]?.clef === 'percussion'
}

// Build a collision-free channel assignment for all non-muted parts.
// Drum parts always get channel 9 (0-based). Melodic parts are remapped if they collide.
function assignChannels(parts: readonly Part[]): Map<string, number> {
  const result = new Map<string, number>()
  const used   = new Set<number>()
  const pool   = [0,1,2,3,4,5,6,7,8,10,11,12,13,14,15]  // melodic channels (no 9)
  let   poolIdx = 0

  for (const part of parts) {
    if (part.muted) continue
    if (isDrumPart(part)) {
      result.set(part.id, 9)
      used.add(9)
      continue
    }
    const requested = part.midiChannel != null ? part.midiChannel - 1 : -1
    if (requested >= 0 && requested !== 9 && !used.has(requested)) {
      result.set(part.id, requested)
      used.add(requested)
    } else {
      // Requested channel is taken or invalid — grab the next free one
      while (poolIdx < pool.length && used.has(pool[poolIdx])) poolIdx++
      const ch = pool[poolIdx] ?? 0
      poolIdx++
      result.set(part.id, ch)
      used.add(ch)
    }
  }
  return result
}

// Effective MIDI velocity for a note in a given measure of a staff.
// Priority: explicit event.velocity > note dynamic > measure directive dynamic > default mf (75).
function resolveVelocity(
  measures: readonly Measure[],
  mIdx: number,
  event: NoteEvent,
  partVolume: number,
): number {
  const mods = articulationPlaybackMods(event)
  const explicitVel = (event as any).velocity as number | undefined
  if (explicitVel !== undefined) {
    return Math.max(1, Math.min(127, Math.round(explicitVel * mods.velFactor * partVolume)))
  }
  const evDynamic = (event as any).dynamic as DynamicLevel | undefined
  let base = 75
  if (evDynamic) {
    base = DYNAMIC_VELOCITY[evDynamic] ?? 75
  } else {
    for (let i = mIdx; i >= 0; i--) {
      const d = measures[i].directives?.find(d => d.category === 'dynamic')
      if (d) { base = DYNAMIC_VELOCITY[d.text] ?? 75; break }
    }
  }
  return Math.max(1, Math.min(127, Math.round(base * mods.velFactor * partVolume)))
}

// Collected note data for one note event, used in two-pass emit (pre / post hairpin).
type NoteEntry = {
  noteEventId: string
  midiNums:    number[]
  tick:        number
  durTicks:    number
  velocity:    number  // mutable for hairpin adjustment
}

function applyHairpinVelocities(entries: NoteEntry[], hairpins: readonly Hairpin[]): void {
  const byId = new Map(entries.map(e => [e.noteEventId, e]))
  for (const hp of hairpins) {
    const from = byId.get(hp.fromNoteId)
    const to   = byId.get(hp.toNoteId)
    if (!from || !to || to.tick <= from.tick) continue
    const startVel = from.velocity
    const endVel   = to.velocity
    const span     = to.tick - from.tick
    for (const e of entries) {
      if (e.tick < from.tick || e.tick > to.tick) continue
      const t = (e.tick - from.tick) / span
      e.velocity = Math.max(1, Math.min(127, Math.round(startVel + t * (endVel - startVel))))
    }
  }
}

function buildPartTrack(
  midi: Midi,
  score: Score,
  part: Part,
  channel: number,          // pre-deduped 0-based channel
  sequence: number[],
  seqTicks: number[],
  notationDurations: boolean,
): void {
  const staff = part.staves[0]
  if (!staff) return

  const track = midi.addTrack()
  track.name              = part.name
  track.channel           = channel
  track.instrument.number = part.midiProgram

  // ── Sequencer mode ──────────────────────────────────────────────────────────
  if (part.inputMode === 'sequencer') {
    const assignments = part.sequenceAssignments ?? []
    const patterns    = part.sequencePatterns ?? []
    for (let si = 0; si < sequence.length; si++) {
      const mIdx      = sequence[si]
      const baseTick  = seqTicks[si]
      const measure   = staff.measures[mIdx]
      if (!measure) continue
      const ts        = resolveTimeSig(staff.measures, mIdx, score.timeSignature)
      const mTickLen  = measureTickLen(ts)
      const asgn      = activeAssignmentAt(assignments, mIdx)
      if (!asgn || asgn.patternId === null) continue
      const pattern   = patterns.find(p => p.id === asgn.patternId)
      if (!pattern || pattern.stepsPerBar === 0) continue
      const stepTicks = mTickLen / pattern.stepsPerBar
      for (let step = 0; step < pattern.stepsPerBar; step++) {
        for (const cell of pattern.steps[step] ?? []) {
          track.addNote({
            midi:          cell.pitch,
            ticks:         baseTick + Math.round(step * stepTicks),
            durationTicks: Math.max(1, Math.round(stepTicks)),
            velocity:      (cell.velocity / 127) * part.volume,
          })
        }
      }
    }
    return
  }

  // ── Score mode: two-pass (collect → hairpin → emit) ─────────────────────────
  const allEntries: NoteEntry[] = []
  const voiceTies = new Map<number, Map<number, NoteEntry>>()

  for (let si = 0; si < sequence.length; si++) {
    const mIdx     = sequence[si]
    const baseTick = seqTicks[si]
    const measure  = staff.measures[mIdx]
    if (!measure) continue

    // Pedal marks → CC 64
    for (const pm of measure.pedalMarks ?? []) {
      track.addCC({
        number: 64,
        ticks:  baseTick + unitsToTicks(pm.beatPosition),
        value:  pm.type === 'down' ? 1 : 0,
      })
    }

    // Embedded MIDI events (CC, pitch bend)
    for (const ev of measure.midiEvents ?? []) {
      const evTick = baseTick + unitsToTicks(ev.beatPosition)
      if (ev.type === 'cc' && ev.cc) {
        track.addCC({ number: ev.cc.controller, ticks: evTick, value: ev.cc.value / 127 })
      } else if (ev.type === 'pb' && ev.pb) {
        track.addPitchBend({ ticks: evTick, value: ev.pb.value / 8192 })
      }
    }

    for (let vi = 0; vi < measure.voices.length; vi++) {
      if (!voiceTies.has(vi)) voiceTies.set(vi, new Map())
      const ties = voiceTies.get(vi)!
      let voiceTick = baseTick

      for (const event of measure.voices[vi].events) {
        const beats     = DURATION_BEATS[event.duration] ?? 1
        const dotFactor = event.dots === 2 ? 1.75 : event.dots === 1 ? 1.5 : 1
        const tuplet    = (event as any).tuplet
        const tupFactor = tuplet ? (tuplet.normal / tuplet.actual) : 1
        const fullTicks = Math.round(beats * dotFactor * tupFactor * PPQ)
        const mods      = articulationPlaybackMods(event)
        // notationDurations: skip the durFactor shortening so notes round-trip cleanly
        const perfTicks = notationDurations
          ? fullTicks
          : Math.max(1, Math.round(fullTicks * mods.durFactor))
        const velocity  = resolveVelocity(staff.measures, mIdx, event, part.volume)

        if (event.type === 'note') {
          const n       = event as Note
          const midiNum = pitchToMidiNum(n.pitch, part.transposeSemitones)
          if (n.tieEnd) {
            const pending = ties.get(midiNum)
            if (pending) {
              pending.durTicks += perfTicks
              if (!n.tieStart) ties.delete(midiNum)
            } else {
              allEntries.push({ noteEventId: n.id, midiNums: [midiNum], tick: voiceTick, durTicks: perfTicks, velocity })
            }
          } else {
            const entry: NoteEntry = { noteEventId: n.id, midiNums: [midiNum], tick: voiceTick, durTicks: perfTicks, velocity }
            allEntries.push(entry)
            if (n.tieStart) ties.set(midiNum, entry)
          }
        } else if (event.type === 'chord') {
          const c = event as Chord
          allEntries.push({ noteEventId: c.id, midiNums: c.pitches.map(p => pitchToMidiNum(p, part.transposeSemitones)), tick: voiceTick, durTicks: perfTicks, velocity })
        }

        voiceTick += fullTicks
      }
    }
  }

  if ((staff.hairpins ?? []).length > 0) applyHairpinVelocities(allEntries, staff.hairpins!)

  for (const e of allEntries) {
    for (const midiNum of e.midiNums) {
      track.addNote({ midi: midiNum, ticks: e.tick, durationTicks: e.durTicks, velocity: e.velocity / 127 })
    }
  }
}

export function scoreToMidi(score: Score, opts: MidiExportOptions = {}): Uint8Array {
  const { expandRepeats = true, notationDurations = false } = opts
  const midi = new Midi()

  const refMeasures = score.parts[0]?.staves[0]?.measures ?? []
  const sequence = refMeasures.length > 0 && expandRepeats
    ? buildPlaybackSequence(refMeasures, score.voltas ?? [])
    : Array.from({ length: refMeasures.length }, (_, i) => i)
  const seqTicks = sequenceTicks(refMeasures, sequence, score.timeSignature)

  const keyEvents = populateConductorEvents(midi, score, refMeasures, sequence, seqTicks)

  // Store original measure count so re-import can restore it precisely
  midi.header.meta.push({ type: 'text', text: `${VOLTA_MEASURES_META}${refMeasures.length}`, ticks: 0 })

  // De-duplicate channels before building tracks
  const channelMap = assignChannels(score.parts)

  score.parts.forEach(part => {
    if (part.muted) return
    const ch = channelMap.get(part.id) ?? 0
    buildPartTrack(midi, score, part, ch, sequence, seqTicks, notationDurations)
  })

  // Fix @tonejs/midi's key-signature encoding bug (keyIndex+7 → keyIndex−7)
  return fixKeySignatureBytes(midi.toArray(), keyEvents)
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT
// ═══════════════════════════════════════════════════════════════════════════════

export interface MidiImportOptions {
  /** Detect triplet groups and import as TupletInfo notes. Default: true. */
  detectTuplets?: boolean
}

// Lowercase name fragments → instruments.json ID, ordered longest-first to prefer specifics
const TRACK_NAME_HINTS: Array<[string, string]> = [
  ['clarinet in bb',  'clarinetBb'],
  ['clarinet in a',   'clarinetA'],
  ['bass clarinet',   'bassClarinet'],
  ['english horn',    'enghorn'],
  ['cor anglais',     'enghorn'],
  ['horn in f',       'hornF'],
  ['french horn',     'hornF'],
  ['trumpet in bb',   'trumpetBb'],
  ['baritone sax',    'barSax'],
  ['soprano sax',     'sopSax'],
  ['tenor sax',       'tenSax'],
  ['alto sax',        'altSax'],
  ['double bass',     'doublebass'],
  ['contrabass',      'doublebass'],
  ['bass guitar',     'bass-guitar'],
  ['violoncello',     'cello'],
  ['clarinet',        'clarinetBb'],
  ['bassoon',         'bassoon'],
  ['piccolo',         'piccolo'],
  ['trombone',        'trombone'],
  ['oboe',            'oboe'],
  ['flute',           'flute'],
  ['tuba',            'tuba'],
  ['trumpet',         'trumpetBb'],
  ['violin',          'violin'],
  ['viola',           'viola'],
  ['cello',           'cello'],
  ['horn',            'hornF'],
  ['harp',            'harp'],
  ['piano',           'piano'],
  ['organ',           'organ'],
  ['harpsichord',     'harpsichord'],
  ['celesta',         'celesta'],
  ['timpani',         'timpani'],
  ['vibraphone',      'vibraphone'],
  ['guitar',          'guitar'],
  ['drum',            'drum-kit'],
  ['percussion',      'drum-kit'],
]

function lookupInstrumentByName(name: string): InstrumentDef | undefined {
  const lower = name.toLowerCase()
  for (const [hint, id] of TRACK_NAME_HINTS) {
    if (lower.includes(hint)) return INSTRUMENTS.find(i => i.id === id)
  }
  return undefined
}

// Pitch statistics derived from a track's actual note content (concert pitch).
interface PitchStats {
  min:    number  // lowest MIDI pitch in track
  max:    number  // highest MIDI pitch in track
  median: number  // median MIDI pitch
}

function computePitchStats(groups: RawGroup[]): PitchStats | undefined {
  const pitches = groups.flatMap(g => g.midiNums)
  if (pitches.length === 0) return undefined
  const sorted = [...pitches].sort((a, b) => a - b)
  return { min: sorted[0], max: sorted[sorted.length - 1], median: sorted[Math.floor(sorted.length / 2)] }
}

// Score how well an instrument's practical range covers the track's observed pitches.
// Inputs are concert pitches throughout. Lower score = better match.
function scoreInstrumentByRange(inst: InstrumentDef, stats: PitchStats): number {
  // Convert instrument written range to concert range
  const cMin = inst.pitchRange.min - inst.transposeSemitones
  const cMax = inst.pitchRange.max - inst.transposeSemitones

  // Heavy penalty for notes outside the instrument's practical range
  const belowPenalty = Math.max(0, cMin - stats.min) * 10
  const abovePenalty = Math.max(0, stats.max - cMax) * 10

  // Secondary: how close is the track median to the instrument's centre
  const centerDist = Math.abs(stats.median - (cMin + cMax) / 2)

  return belowPenalty + abovePenalty + centerDist
}

// Look up the best matching instrument using three signals in priority order:
//   1. GM program number (when non-zero — authoritative)
//   2. Track name substring match (for program=0 files)
//   3. Pitch range scoring (when program=0 and name gives no match)
function lookupInstrument(
  program: number,
  isDrum:  boolean,
  trackName = '',
  pitchStats?: PitchStats,
): InstrumentDef | undefined {
  if (isDrum) return INSTRUMENTS.find(i => i.midiChannel === 10)

  const melodic = INSTRUMENTS.filter(i => i.midiChannel !== 10)

  // Signal 1: explicit program number (non-zero = intentional assignment)
  if (program > 0) {
    return melodic.reduce<InstrumentDef | undefined>((best, inst) => {
      if (!best) return inst
      return Math.abs(inst.midiProgram - program) < Math.abs(best.midiProgram - program) ? inst : best
    }, undefined)
  }

  // Signal 2: track name
  if (trackName) {
    const byName = lookupInstrumentByName(trackName)
    if (byName) return byName
  }

  // Signal 3: pitch range (program=0 with no usable name)
  // Only reliable when the track spans at least an octave — a single note or
  // a narrow fragment could plausibly belong to any instrument and would
  // produce false positives, particularly for transposing instruments.
  if (pitchStats && (pitchStats.max - pitchStats.min) >= 12) {
    return melodic
      .map(inst => ({ inst, score: scoreInstrumentByRange(inst, pitchStats) }))
      .sort((a, b) => a.score - b.score)[0]?.inst
  }

  // Fallback: Piano (program 0)
  return melodic.find(i => i.id === 'piano')
}

// Split overlapping notes into two voices. Voice 0 takes priority.
function splitVoices<T extends { ticks: number; durationTicks: number }>(sorted: T[]): [T[], T[]] {
  const v0: T[] = [], v1: T[] = []
  let cursor0 = 0
  for (const n of sorted) {
    if (n.ticks >= cursor0) { v0.push(n); cursor0 = n.ticks + n.durationTicks }
    else                      v1.push(n)
  }
  return [v0, v1]
}

// A "slot" describes one measure in the global timeline built from the MIDI file.
interface MeasureSlot {
  mIdx:      number
  startTick: number
  endTick:   number
  timeSig:   TimeSignature
}

function buildMeasureSlots(
  timeSigEvents: Array<{ ticks: number; timeSignature: number[] }>,
  totalTicks: number,
  ppq: number,
): MeasureSlot[] {
  const sorted = [...timeSigEvents].sort((a, b) => a.ticks - b.ticks)
  const slots: MeasureSlot[] = []
  let currentTS: TimeSignature = { numerator: 4, denominator: 4 }
  let tsIdx = 0, tick = 0, mIdx = 0
  const target = totalTicks + Math.round(8 * 4 * ppq)
  while (tick <= target) {
    while (tsIdx < sorted.length && sorted[tsIdx].ticks <= tick) {
      currentTS = { numerator: sorted[tsIdx].timeSignature[0], denominator: sorted[tsIdx].timeSignature[1] }
      tsIdx++
    }
    const mTickLen = Math.round(currentTS.numerator * (4 / currentTS.denominator) * ppq)
    slots.push({ mIdx, startTick: tick, endTick: tick + mTickLen, timeSig: currentTS })
    tick += mTickLen; mIdx++
  }
  return slots
}

function findSlotIndex(slots: MeasureSlot[], tick: number): number {
  let lo = 0, hi = slots.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (slots[mid].endTick <= tick)       lo = mid + 1
    else if (slots[mid].startTick > tick) hi = mid - 1
    else return mid
  }
  return Math.max(0, slots.length - 1)
}

// Group near-simultaneous notes (within CHORD_TICK_TOLERANCE) into chord groups.
type RawGroup = { ticks: number; durationTicks: number; midiNums: number[]; velocity: number }

function groupChords(
  notes: ReadonlyArray<{ ticks: number; durationTicks: number; midi: number; velocity: number }>,
): RawGroup[] {
  const sorted = [...notes].sort((a, b) => a.ticks - b.ticks)
  const groups: RawGroup[] = []
  let i = 0
  while (i < sorted.length) {
    const ref = sorted[i]
    const group = [ref]
    let j = i + 1
    while (j < sorted.length && sorted[j].ticks - ref.ticks <= CHORD_TICK_TOLERANCE) { group.push(sorted[j]); j++ }
    groups.push({
      ticks:        ref.ticks,
      durationTicks: Math.max(...group.map(n => n.durationTicks)),
      midiNums:     group.map(n => n.midi),
      velocity:     group.reduce((s, n) => s + n.velocity, 0) / group.length,
    })
    i = j
  }
  return groups
}

// Triplet marker for a group index: which tupletId and what written base note.
type TripletMark = { tupletId: string; baseDuration: Duration }

// Detect groups of 3 consecutive notes with regular spacing whose total tick span
// equals a standard duple duration (within ±4% tolerance). Returns a map from
// group index to its triplet mark.
function detectTripletMarks(groups: RawGroup[], ppq: number): Map<number, TripletMark> {
  const marks    = new Map<number, TripletMark>()
  const TOLERANCE = Math.round(ppq * 0.04)  // ±4% of a quarter note
  // Standard duple note lengths in ticks (32nd to half):
  const DUPLES: Array<[number, Duration]> = [
    [ppq / 4, '16th'], [ppq / 2, 'eighth'], [ppq, 'quarter'], [ppq * 2, 'half'],
  ]

  for (let i = 0; i < groups.length - 2; i++) {
    if (marks.has(i)) continue
    const a = groups[i], b = groups[i + 1], c = groups[i + 2]

    // Require regular inter-note spacing
    const iAB = b.ticks - a.ticks
    const iBC = c.ticks - b.ticks
    if (Math.abs(iAB - iBC) > TOLERANCE) continue

    // Total span of the 3-note group
    const totalTicks = c.ticks + c.durationTicks - a.ticks

    // Find a standard duple duration that matches total × 1 (3 triplet Xths = 2 Xths)
    // total = 2 × baseNote → baseNote = total / 2
    const baseNoteTicks = totalTicks / 2
    const duple = DUPLES.find(([d]) => Math.abs(d - baseNoteTicks) <= TOLERANCE)
    if (!duple) continue

    const tupletId = uuid()
    const baseDuration = duple[1]
    marks.set(i,     { tupletId, baseDuration })
    marks.set(i + 1, { tupletId, baseDuration })
    marks.set(i + 2, { tupletId, baseDuration })
    i += 2
  }
  return marks
}

// Flat event used while packing notes into measures.
// units is a float for tuplet notes (e.g. 8/3 for triplet-16ths).
type FlatEvent = {
  type:     'note' | 'chord' | 'rest'
  units:    number
  duration: Duration
  dots:     0 | 1
  pitches?: Pitch[]
  velocity: number       // 0–127 average velocity for dynamics detection
  tuplet?:  TupletInfo
}

function trackToFlatEvents(
  groups: RawGroup[],
  isDrum: boolean,
  ppq: number,
  activeKeySig: (tick: number) => KeySignature,
  transposeSemitones: number,
  tripletMarks: Map<number, TripletMark>,
): FlatEvent[] {
  const flat: FlatEvent[] = []
  let cursor = 0

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    const startUnits = ticksToUnits(g.ticks, ppq)
    const gap        = startUnits - cursor

    if (gap >= 1) {
      const q = quantise(gap)
      flat.push({ type: 'rest', units: q.units, duration: q.duration, dots: q.dots, velocity: 0 })
      cursor = startUnits
    }

    const ks = activeKeySig(g.ticks)
    const triplet = tripletMarks.get(gi)

    let units: number
    let duration: Duration
    let dots: 0 | 1
    let tuplet: TupletInfo | undefined

    if (triplet) {
      duration = triplet.baseDuration
      dots     = 0
      // Each of 3 triplet notes consumes baseDuration × 2/3 units (exact float arithmetic)
      const baseDurUnits: Record<Duration, number> = { '64th':1,'32nd':2,'16th':4,'eighth':8,'quarter':16,'half':32,'whole':64 }
      units  = baseDurUnits[duration] * 2 / 3  // e.g. 4 * 2/3 = 2.667 for triplet-16th
      tuplet = { id: triplet.tupletId, actual: 3, normal: 2 }
    } else {
      const rawUnits = Math.max(1, ticksToUnits(g.durationTicks, ppq))
      const q = quantise(rawUnits)
      units    = q.units
      duration = q.duration
      dots     = q.dots
    }

    const vel   = Math.round(g.velocity * 127)
    const extra = tuplet ? { tuplet } : {}

    if (isDrum) {
      const pitches = g.midiNums.map(drumPitch)
      flat.push({ type: g.midiNums.length === 1 ? 'note' : 'chord', units, duration, dots: dots ?? 0, pitches, velocity: vel, ...extra })
    } else {
      const written = g.midiNums.map(m => midiToPitch(Math.max(0, Math.min(127, m + transposeSemitones)), ks))
      flat.push({ type: written.length === 1 ? 'note' : 'chord', units, duration, dots: dots ?? 0, pitches: written, velocity: vel, ...extra })
    }

    cursor = startUnits + (triplet ? Math.round(units) : units)
  }

  return flat
}

// Attach note-level dynamics to the first non-rest event of each measure when the
// inferred dynamic level changes. Uses event.dynamic (renders below the stave) rather
// than measure directives (which rendered above, incorrectly).
function injectDynamics(measures: Measure[], voiceNotes: FlatEvent[]): Measure[] {
  let lastDynamic: DynamicLevel | null = null
  let noteIdx = 0
  return measures.map(m => {
    const voice0 = m.voices[0]
    if (!voice0) return m
    const firstNoteIdx = voice0.events.findIndex(e => e.type !== 'rest')
    if (firstNoteIdx === -1) return m
    while (noteIdx < voiceNotes.length && voiceNotes[noteIdx].type === 'rest') noteIdx++
    const raw = voiceNotes[noteIdx]
    if (!raw || raw.velocity === 0) return m
    const level = inferDynamic(raw.velocity)
    noteIdx++
    if (level === lastDynamic) return m
    lastDynamic = level
    const updatedEvents = voice0.events.map((e, i) =>
      i === firstNoteIdx ? { ...e, dynamic: level } : e
    )
    return { ...m, voices: m.voices.map((v, i) => i === 0 ? { ...v, events: updatedEvents } : v) }
  })
}

// Pack a sequence of flat events into measures with tie support at barlines.
// targetMeasures: if provided, stop padding once this many measures are built.
function packIntoMeasures(
  events: FlatEvent[],
  slots: MeasureSlot[],
  tsSwitches:  Map<number, TimeSignature>,
  keySwitches: Map<number, KeySignature>,
  tempoDirs:   Map<number, number>,
  targetMeasures?: number,
): Measure[] {
  const measures: Measure[] = []
  let slotIdx  = 0
  let mEvents: NoteEvent[] = []
  let beatPos  = 0  // float-safe for tuplet accumulation
  let timeSig  = slots[0]?.timeSig ?? { numerator: 4, denominator: 4 }
  let capacity = measureCapacityUnits(timeSig)
  let mNum     = 1

  function closeMeasure(barline: BarlineType = 'single') {
    const rem = capacity - Math.round(beatPos)
    if (rem > 0) for (const r of fillWithRests(rem)) mEvents.push(r)
    const tsSwitch = tsSwitches.get(slotIdx + 1)
    const ksSwitch = keySwitches.get(slotIdx)
    const bpm      = tempoDirs.get(slotIdx)
    measures.push({
      id:     uuid(),
      number: mNum++,
      voices: [{ id: uuid(), events: mEvents }],
      barline,
      ...(ksSwitch != null ? { keySignature: ksSwitch } : {}),
      ...(bpm != null ? { directives: [{ id: uuid(), category: 'tempo' as const, text: `${bpm} bpm`, bpm }] } : {}),
    })
    mEvents = []; beatPos = 0; slotIdx++
    if (tsSwitch) { timeSig = tsSwitch; capacity = measureCapacityUnits(tsSwitch) }
    else if (slots[slotIdx]) { timeSig = slots[slotIdx].timeSig; capacity = measureCapacityUnits(timeSig) }
  }

  function makeNoteEvent(ev: FlatEvent, units: number, tieStart: boolean, tieEnd: boolean): NoteEvent {
    const q = Math.abs(units - ev.units) < 0.5 ? ev : quantise(units)
    if (ev.type === 'rest') return createRest(q.duration) as Rest
    const vel = ev.velocity > 0 ? ev.velocity : undefined
    if (ev.type === 'note') {
      const p    = ev.pitches![0]
      const base = createNote(p.noteName, p.octave, q.duration, p.accidental)
      return {
        ...base, id: uuid(), dots: q.dots, tieStart, tieEnd,
        ...(vel !== undefined ? { velocity: vel } : {}),
        ...(ev.tuplet ? { tuplet: ev.tuplet } : {}),
      } as Note
    }
    return {
      id: uuid(), type: 'chord',
      pitches: ev.pitches!, duration: q.duration, dots: q.dots as (0 | 1 | 2),
      articulations: [],
      ...(vel !== undefined ? { velocity: vel } : {}),
      ...(ev.tuplet ? { tuplet: ev.tuplet } : {}),
    } as Chord
  }

  for (const ev of events) {
    let remaining       = ev.units
    let isFirstFragment = true

    while (remaining > 0.001) {
      const space = capacity - beatPos

      if (remaining <= space + 0.001) {
        mEvents.push(makeNoteEvent(ev, Math.round(remaining), false, !isFirstFragment))
        beatPos   += remaining
        remaining  = 0
        if (beatPos >= capacity - 0.001) closeMeasure()
      } else if (ev.type === 'rest') {
        if (space >= 1) { for (const r of fillWithRests(Math.round(space))) mEvents.push(r); beatPos = capacity }
        remaining -= space
        closeMeasure()
        while (remaining > 0.001) {
          const fill = Math.min(remaining, capacity)
          for (const r of fillWithRests(Math.round(fill))) mEvents.push(r)
          beatPos    = fill
          remaining -= fill
          if (beatPos >= capacity - 0.001) closeMeasure()
        }
      } else if (space >= 1) {
        mEvents.push(makeNoteEvent(ev, Math.round(space), true, !isFirstFragment))
        beatPos        += space
        remaining      -= space
        isFirstFragment = false
        closeMeasure()
      } else {
        closeMeasure()
      }
    }
  }

  if (mEvents.length > 0) closeMeasure()

  // Pad: honour targetMeasures if provided, otherwise ensure at least 8
  const minMeasures = targetMeasures ?? 8
  while (measures.length < minMeasures) {
    const ts = slots[slotIdx]?.timeSig ?? timeSig
    measures.push({
      id:     uuid(),
      number: mNum++,
      voices: [{ id: uuid(), events: fillWithRests(measureCapacityUnits(ts)) }],
      barline: 'single',
    })
    slotIdx++
  }

  for (let k = 0; k < measures.length - 1; k++) measures[k] = { ...measures[k], barline: 'single' }
  measures[measures.length - 1] = { ...measures[measures.length - 1], barline: 'final' }
  return measures
}

export function midiToScore(bytes: Uint8Array, opts: MidiImportOptions = {}): Score {
  // Validate MIDI magic bytes: MThd = 0x4D 0x54 0x68 0x64
  if (bytes[0] !== 0x4D || bytes[1] !== 0x54 || bytes[2] !== 0x68 || bytes[3] !== 0x64) {
    const hint = bytes[0] === 0x7B ? ' — this looks like a .notation file. Use File → Open instead.' : '.'
    throw new Error(`Not a valid MIDI file${hint}`)
  }

  const { detectTuplets = true } = opts
  const midi = new Midi(bytes)
  const ppq  = midi.header.ppq

  // ── Global header events ─────────────────────────────────────────────────────
  const sortedTempos   = [...midi.header.tempos].sort((a, b) => a.ticks - b.ticks)
  const sortedTimeSigs = [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks)
  const sortedKeySigs  = [...midi.header.keySignatures].sort((a, b) => a.ticks - b.ticks)

  const initTempo    = Math.round(sortedTempos[0]?.bpm ?? 120)
  const initTsRaw    = sortedTimeSigs[0]?.timeSignature ?? [4, 4]
  const initTimeSig: TimeSignature = { numerator: initTsRaw[0], denominator: initTsRaw[1] }
  const initKsKey    = sortedKeySigs[0]?.key ?? 'C'
  const initKsScale  = sortedKeySigs[0]?.scale ?? 'major'
  const initKeySig: KeySignature = { fifths: KEY_TO_FIFTHS[initKsKey] ?? 0, mode: initKsScale as 'major' | 'minor' }

  // Original measure count stored by our exporter — use to cap padding
  const metaMeasuresText = midi.header.meta.find(m => m.text?.startsWith(VOLTA_MEASURES_META))?.text
  const targetMeasures   = metaMeasuresText
    ? (parseInt(metaMeasuresText.slice(VOLTA_MEASURES_META.length), 10) || undefined)
    : undefined

  // ── Measure timeline ─────────────────────────────────────────────────────────
  const notesTracks = midi.tracks.filter(t => t.notes.length > 0)
  const totalTicks  = notesTracks.length > 0
    ? Math.max(...notesTracks.map(t => Math.max(...t.notes.map(n => n.ticks + n.durationTicks))))
    : 0

  const slots = buildMeasureSlots(sortedTimeSigs, totalTicks, ppq)

  // ── Per-slot overrides ────────────────────────────────────────────────────────
  const tsSwitches   = new Map<number, TimeSignature>()
  const keySwitches  = new Map<number, KeySignature>()
  const tempoChanges = new Map<number, number>()

  for (let i = 1; i < slots.length; i++) {
    const prev = slots[i - 1].timeSig, curr = slots[i].timeSig
    if (prev.numerator !== curr.numerator || prev.denominator !== curr.denominator) tsSwitches.set(i, curr)
  }
  for (const ks of sortedKeySigs.slice(1)) {
    if (ks.key) keySwitches.set(findSlotIndex(slots, ks.ticks), { fifths: KEY_TO_FIFTHS[ks.key] ?? 0, mode: ks.scale as 'major' | 'minor' })
  }
  for (const t of sortedTempos.slice(1)) {
    tempoChanges.set(findSlotIndex(slots, t.ticks), Math.round(t.bpm))
  }

  function activeKeySig(tick: number): KeySignature {
    const sIdx = findSlotIndex(slots, tick)
    for (let i = sIdx; i >= 0; i--) { if (keySwitches.has(i)) return keySwitches.get(i)! }
    return initKeySig
  }

  if (notesTracks.length === 0) {
    const base = createScore(midi.header.name || 'Imported MIDI')
    return { ...base, tempo: initTempo, timeSignature: initTimeSig, keySignature: initKeySig }
  }

  // ── Import each note-bearing track as a Part ──────────────────────────────────
  const parts: ReturnType<typeof createScore>['parts'][0][] = []

  for (const track of notesTracks) {
    const trackChannel = track.channel
    const isDrum       = trackChannel === 9 || track.instrument.percussion
    const program      = isDrum ? 0 : track.instrument.number

    // Sort and chord-group first so we can compute pitch stats for range inference
    const sorted = [...track.notes].sort((a, b) => a.ticks - b.ticks)
    const groups = groupChords(sorted)

    const pitchStats   = isDrum ? undefined : computePitchStats(groups)
    const inst         = lookupInstrument(program, isDrum, track.name, pitchStats)
    const transpose    = inst?.transposeSemitones ?? 0
    const clef         = inst?.defaultClef ?? (isDrum ? 'percussion' : 'treble')
    const [v0groups, v1groups] = splitVoices(groups)
    const hasVoice1        = v1groups.length > 0

    // Triplet detection — done per-voice on the chord groups
    const v0marks = detectTuplets ? detectTripletMarks(v0groups, ppq) : new Map<number, TripletMark>()
    const v1marks = detectTuplets && hasVoice1 ? detectTripletMarks(v1groups, ppq) : new Map<number, TripletMark>()

    const v0flat = trackToFlatEvents(v0groups, isDrum, ppq, activeKeySig, transpose, v0marks)
    const v1flat = hasVoice1 ? trackToFlatEvents(v1groups, isDrum, ppq, activeKeySig, transpose, v1marks) : []

    const v0measures = packIntoMeasures(v0flat, slots, tsSwitches, keySwitches, tempoChanges, targetMeasures)
    const v0withDyn  = injectDynamics(v0measures, v0flat)

    let finalMeasures: Measure[]
    if (hasVoice1) {
      const v1measures = packIntoMeasures(v1flat, slots, new Map(), new Map(), new Map(), targetMeasures)
      finalMeasures = v0withDyn.map((m, i) => {
        const v1 = v1measures[i]
        return v1 ? { ...m, voices: [...m.voices, { id: uuid(), events: v1.voices[0]?.events ?? [] }] } : m
      })
    } else {
      finalMeasures = v0withDyn
    }

    // CC 64 → pedal marks
    const cc64 = track.controlChanges[64] ?? []
    if (cc64.length > 0) {
      const pedalByMeasure = new Map<number, typeof finalMeasures[0]['pedalMarks']>()
      for (const cc of cc64) {
        const sIdx = findSlotIndex(slots, cc.ticks)
        if (sIdx >= finalMeasures.length) continue
        const beatPos = ticksToUnits(cc.ticks - slots[sIdx].startTick, ppq)
        pedalByMeasure.set(sIdx, [...(pedalByMeasure.get(sIdx) ?? []), { id: uuid(), type: cc.value >= 0.5 ? 'down' : 'up', beatPosition: beatPos }])
      }
      finalMeasures = finalMeasures.map((m, i) => {
        const pm = pedalByMeasure.get(i)
        return pm ? { ...m, pedalMarks: pm } : m
      })
    }

    const partName  = track.name || (isDrum ? 'Drums' : inst?.name ?? 'Piano')
    const shortName = partName.slice(0, 6) + (partName.length > 6 ? '.' : '')

    parts.push({
      id:                uuid(),
      name:              partName,
      shortName,
      midiProgram:       inst?.midiProgram ?? program,
      midiChannel:       isDrum ? 10 : trackChannel + 1,
      transposeSemitones: transpose,
      staves:            [{ id: uuid(), clef, measures: finalMeasures }],
      volume:            0.8,
      muted:             false,
      labelVisible:      true,
    })
  }

  const base = createScore(midi.header.name || 'Imported MIDI')
  return {
    ...base,
    tempo:         initTempo,
    timeSignature: initTimeSig,
    keySignature:  initKeySig,
    parts:         parts as Score['parts'],
  }
}
