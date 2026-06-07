// ─────────────────────────────────────────────────────────────────────────────
// MIDI import / export  (professional DAW quality)
//
// scoreToMidi  — Score → Uint8Array (MIDI Type 1, multi-track)
// midiToScore  — Uint8Array → Score (multi-part, dynamics, ties)
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
  type Hairpin,
} from '@shared/score'
import {
  measureCapacityUnits, resolveTimeSig, resolveDirectiveTempo,
  articulationPlaybackMods, buildPlaybackSequence, fillWithRests,
  activeAssignmentAt,
} from '@shared/musicUtils'

// ── Constants ─────────────────────────────────────────────────────────────────

const PPQ = 480
const CHORD_TICK_TOLERANCE = 5

const DURATION_BEATS: Record<Duration, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5,
  '16th': 0.25, '32nd': 0.125, '64th': 0.0625,
}

// ── Dynamic velocity ───────────────────────────────────────────────────────────

const DYNAMIC_VELOCITY: Record<string, number> = {
  pppp: 10, ppp: 22, pp: 36, p: 50, mp: 62, mf: 75,
  f: 88, ff: 101, fff: 112, ffff: 120, sfz: 122, fp: 88,
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
  /** Expand repeat signs before export so the MIDI file plays through. Default: true. */
  expandRepeats?: boolean
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

// Populate the MIDI header with tempo / time-sig / key-sig events from the score.
function populateConductorEvents(
  midi: Midi,
  score: Score,
  refMeasures: readonly Measure[],
  sequence: number[],
  seqTicks: number[],
): void {
  midi.header.tempos.push({ bpm: score.tempo, ticks: 0 })
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: [score.timeSignature.numerator, score.timeSignature.denominator],
  })
  midi.header.keySignatures.push({
    ticks: 0,
    key:   FIFTHS_TO_KEY[score.keySignature.fifths] ?? 'C',
    scale: score.keySignature.mode,
  })

  let lastBpm   = score.tempo
  let lastTsNum = score.timeSignature.numerator
  let lastTsDen = score.timeSignature.denominator
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
      midi.header.keySignatures.push({ ticks: tick, key: FIFTHS_TO_KEY[ks.fifths] ?? 'C', scale: ks.mode })
      lastFifths = ks.fifths
    }
  }
}

// Effective MIDI velocity for a note in a given measure of a staff.
function resolveVelocity(
  measures: readonly Measure[],
  mIdx: number,
  event: NoteEvent,
  partVolume: number,
): number {
  const evDynamic = (event as any).dynamic as DynamicLevel | undefined
  let base = 75  // default mf
  if (evDynamic) {
    base = DYNAMIC_VELOCITY[evDynamic] ?? 75
  } else {
    for (let i = mIdx; i >= 0; i--) {
      const d = measures[i].directives?.find(d => d.category === 'dynamic')
      if (d) { base = DYNAMIC_VELOCITY[d.text] ?? 75; break }
    }
  }
  const mods = articulationPlaybackMods(event)
  return Math.max(1, Math.min(127, Math.round(base * mods.velFactor * partVolume)))
}

// Collected note data for one note event, used in two-pass emit (pre / post hairpin).
type NoteEntry = {
  noteEventId: string    // Note.id or Chord.id — matches Hairpin.fromNoteId / toNoteId
  midiNums:    number[]  // one element for Note, multiple for Chord
  tick:        number    // absolute tick position
  durTicks:    number    // performance duration (after articulation mod)
  velocity:    number    // 1–127, mutable for hairpin adjustment
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

// Build and add one MIDI track for a Part. Handles both score and sequencer modes.
function buildPartTrack(
  midi: Midi,
  score: Score,
  part: Part,
  partIndex: number,
  sequence: number[],
  seqTicks: number[],
): void {
  const staff = part.staves[0]
  if (!staff) return

  const channel = (part.midiChannel ?? (partIndex + 1)) - 1  // @tonejs/midi is 0-based
  const track   = midi.addTrack()
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

  // Per-voice tie accumulators: MIDI pitch → NoteEntry of the open tieStart note
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

    // Walk each voice
    for (let vi = 0; vi < measure.voices.length; vi++) {
      if (!voiceTies.has(vi)) voiceTies.set(vi, new Map())
      const ties = voiceTies.get(vi)!
      let voiceTick = baseTick

      for (const event of measure.voices[vi].events) {
        const beats     = DURATION_BEATS[event.duration] ?? 1
        const dotFactor = event.dots === 2 ? 1.75 : event.dots === 1 ? 1.5 : 1
        const tuplet    = (event as any).tuplet
        const tupFactor = tuplet ? (tuplet.normal / tuplet.actual) : 1
        // fullTicks: nominal duration for cursor advance (not performance-adjusted)
        const fullTicks = Math.round(beats * dotFactor * tupFactor * PPQ)
        const mods      = articulationPlaybackMods(event)
        const perfTicks = Math.max(1, Math.round(fullTicks * mods.durFactor))
        const velocity  = resolveVelocity(staff.measures, mIdx, event, part.volume)

        if (event.type === 'note') {
          const n       = event as Note
          const midiNum = pitchToMidiNum(n.pitch, part.transposeSemitones)

          if (n.tieEnd) {
            // Extend the open tie chain for this pitch, if any
            const pending = ties.get(midiNum)
            if (pending) {
              pending.durTicks += perfTicks
              if (!n.tieStart) ties.delete(midiNum)  // chain ends here
            } else {
              // Orphaned tieEnd: emit normally
              allEntries.push({ noteEventId: n.id, midiNums: [midiNum], tick: voiceTick, durTicks: perfTicks, velocity })
            }
          } else {
            const entry: NoteEntry = { noteEventId: n.id, midiNums: [midiNum], tick: voiceTick, durTicks: perfTicks, velocity }
            allEntries.push(entry)
            if (n.tieStart) ties.set(midiNum, entry)
          }
        } else if (event.type === 'chord') {
          const c      = event as Chord
          const midis  = c.pitches.map(p => pitchToMidiNum(p, part.transposeSemitones))
          allEntries.push({ noteEventId: c.id, midiNums: midis, tick: voiceTick, durTicks: perfTicks, velocity })
        }
        // rests: just advance cursor

        voiceTick += fullTicks
      }
    }
  }

  // Hairpin velocity interpolation
  if ((staff.hairpins ?? []).length > 0) applyHairpinVelocities(allEntries, staff.hairpins!)

  // Emit
  for (const e of allEntries) {
    for (const midiNum of e.midiNums) {
      track.addNote({ midi: midiNum, ticks: e.tick, durationTicks: e.durTicks, velocity: e.velocity / 127 })
    }
  }
}

export function scoreToMidi(score: Score, opts: MidiExportOptions = {}): Uint8Array {
  const { expandRepeats = true } = opts
  const midi = new Midi()

  const refMeasures = score.parts[0]?.staves[0]?.measures ?? []
  const sequence = refMeasures.length > 0 && expandRepeats
    ? buildPlaybackSequence(refMeasures, score.voltas ?? [])
    : Array.from({ length: refMeasures.length }, (_, i) => i)
  const seqTicks = sequenceTicks(refMeasures, sequence, score.timeSignature)

  populateConductorEvents(midi, score, refMeasures, sequence, seqTicks)
  score.parts.forEach((part, idx) => {
    if (!part.muted) buildPartTrack(midi, score, part, idx, sequence, seqTicks)
  })

  return midi.toArray()
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT
// ═══════════════════════════════════════════════════════════════════════════════


// Split overlapping notes into two voices. Voice 0 takes priority.
function splitVoices<T extends { ticks: number; durationTicks: number }>(
  sorted: T[],
): [T[], T[]] {
  const v0: T[] = [], v1: T[] = []
  let cursor0 = 0
  for (const n of sorted) {
    if (n.ticks >= cursor0) { v0.push(n); cursor0 = n.ticks + n.durationTicks }
    else                      { v1.push(n) }
  }
  return [v0, v1]
}

// Find the closest instrument in the database by GM program number.
function lookupInstrument(program: number, isDrum: boolean): InstrumentDef | undefined {
  if (isDrum) return INSTRUMENTS.find(i => i.midiChannel === 10)
  return INSTRUMENTS
    .filter(i => i.midiChannel !== 10)  // exclude drum kit from melodic lookup
    .reduce<InstrumentDef | undefined>((best, inst) => {
      if (!best) return inst
      return Math.abs(inst.midiProgram - program) < Math.abs(best.midiProgram - program) ? inst : best
    }, undefined)
}

// A "slot" describes one measure in the global timeline built from the MIDI file.
interface MeasureSlot {
  mIdx:      number
  startTick: number
  endTick:   number
  timeSig:   TimeSignature
}

// Build the global measure timeline from header time-signature events.
function buildMeasureSlots(
  timeSigEvents: Array<{ ticks: number; timeSignature: number[] }>,
  totalTicks: number,
  ppq: number,
): MeasureSlot[] {
  const sorted = [...timeSigEvents].sort((a, b) => a.ticks - b.ticks)
  const slots: MeasureSlot[] = []
  let currentTS: TimeSignature = { numerator: 4, denominator: 4 }
  let tsIdx = 0
  let tick  = 0
  let mIdx  = 0

  // Generate enough slots to cover all notes plus a few extra measures
  const target = totalTicks + Math.round(8 * 4 * ppq)

  while (tick <= target) {
    while (tsIdx < sorted.length && sorted[tsIdx].ticks <= tick) {
      currentTS = { numerator: sorted[tsIdx].timeSignature[0], denominator: sorted[tsIdx].timeSignature[1] }
      tsIdx++
    }
    const mTickLen = Math.round(currentTS.numerator * (4 / currentTS.denominator) * ppq)
    slots.push({ mIdx, startTick: tick, endTick: tick + mTickLen, timeSig: currentTS })
    tick += mTickLen
    mIdx++
  }

  return slots
}

// Return the slot index that contains the given tick.
function findSlotIndex(slots: MeasureSlot[], tick: number): number {
  let lo = 0, hi = slots.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (slots[mid].endTick <= tick)   { lo = mid + 1 }
    else if (slots[mid].startTick > tick) { hi = mid - 1 }
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
    while (j < sorted.length && sorted[j].ticks - ref.ticks <= CHORD_TICK_TOLERANCE) {
      group.push(sorted[j]); j++
    }
    groups.push({
      ticks:        ref.ticks,
      durationTicks: Math.max(...group.map(n => n.durationTicks)),
      midiNums:     group.map(n => n.midi),
      velocity:     group.reduce((s, n) => s + n.velocity, 0) / group.length,  // keep 0-1 precision
    })
    i = j
  }
  return groups
}

// Flat event used while packing notes into measures.
type FlatEvent = {
  type:     'note' | 'chord' | 'rest'
  units:    number           // quantised 64th-note units
  duration: Duration
  dots:     0 | 1
  pitches?: Pitch[]
  velocity: number           // 0–127 average velocity for dynamics detection
}

// Pack a sequence of flat events into measures with tie support at barlines.
function packIntoMeasures(
  events: FlatEvent[],
  slots: MeasureSlot[],
  tsSwitches: Map<number, TimeSignature>,    // slotIdx → new time sig override
  keySwitches: Map<number, KeySignature>,    // slotIdx → new key sig override
  tempoDirs: Map<number, number>,            // slotIdx → bpm directive
): Measure[] {
  const measures: Measure[] = []
  let slotIdx   = 0
  let mEvents: NoteEvent[] = []
  let beatPos   = 0
  let timeSig   = slots[0]?.timeSig ?? { numerator: 4, denominator: 4 }
  let capacity  = measureCapacityUnits(timeSig)
  let mNum      = 1

  function closeMeasure(barline: BarlineType = 'single') {
    // Fill remaining space with rests
    const rem = capacity - beatPos
    if (rem > 0) for (const r of fillWithRests(rem)) mEvents.push(r)

    const tsSwitch = tsSwitches.get(slotIdx + 1)  // next measure may have a new time sig
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

    mEvents  = []
    beatPos  = 0
    slotIdx++

    if (tsSwitch) {
      timeSig  = tsSwitch
      capacity = measureCapacityUnits(tsSwitch)
    } else if (slots[slotIdx]) {
      timeSig  = slots[slotIdx].timeSig
      capacity = measureCapacityUnits(timeSig)
    }
  }

  function makeNoteEvent(ev: FlatEvent, units: number, tieStart: boolean, tieEnd: boolean): NoteEvent {
    const q = units === ev.units ? ev : quantise(units)
    if (ev.type === 'rest') {
      return createRest(q.duration) as Rest
    }
    if (ev.type === 'note') {
      const p = ev.pitches![0]
      const base = createNote(p.noteName, p.octave, q.duration, p.accidental)
      return { ...base, id: uuid(), dots: q.dots, tieStart, tieEnd } as Note
    }
    // chord
    return {
      id:    uuid(), type: 'chord',
      pitches: ev.pitches!, duration: q.duration, dots: q.dots as (0 | 1 | 2),
      articulations: [],
    } as Chord
  }

  for (const ev of events) {
    let remaining       = ev.units
    let isFirstFragment = true

    while (remaining > 0) {
      const space = capacity - beatPos

      if (remaining <= space) {
        // Fits in current measure
        mEvents.push(makeNoteEvent(ev, remaining, false, !isFirstFragment))
        beatPos += remaining
        remaining = 0
        if (beatPos >= capacity) closeMeasure()
      } else if (ev.type === 'rest') {
        // Rests split without ties: fill current measure remainder, then continue
        if (space > 0) {
          for (const r of fillWithRests(space)) mEvents.push(r)
          beatPos = capacity
        }
        remaining -= space
        closeMeasure()
        // Distribute the remaining rest across subsequent measures
        while (remaining > 0) {
          const nextSpace = capacity  // capacity may have changed after closeMeasure
          const fill = Math.min(remaining, nextSpace)
          for (const r of fillWithRests(fill)) mEvents.push(r)
          beatPos    = fill
          remaining -= fill
          if (beatPos >= capacity) closeMeasure()
        }
      } else if (space >= 1) {
        // Note/chord overflows: create tied fragment
        mEvents.push(makeNoteEvent(ev, space, /*tieStart:*/ true, /*tieEnd:*/ !isFirstFragment))
        beatPos        += space
        remaining      -= space
        isFirstFragment = false
        closeMeasure()
      } else {
        // No space at all — just close and retry
        closeMeasure()
      }
    }
  }

  if (mEvents.length > 0) closeMeasure()

  // Pad to at least 8 measures
  while (measures.length < 8) {
    const ts = slots[slotIdx]?.timeSig ?? timeSig
    measures.push({
      id:     uuid(),
      number: mNum++,
      voices: [{ id: uuid(), events: fillWithRests(measureCapacityUnits(ts)) }],
      barline: 'single',
    })
    slotIdx++
  }

  // Enforce barlines
  for (let k = 0; k < measures.length - 1; k++) measures[k] = { ...measures[k], barline: 'single' }
  measures[measures.length - 1] = { ...measures[measures.length - 1], barline: 'final' }

  return measures
}

// Import a single MIDI track's notes into a voice's flat event list.
function trackToFlatEvents(
  groups: RawGroup[],
  isDrum: boolean,
  ppq: number,
  activeKeySig: (tick: number) => KeySignature,
  transposeSemitones: number,
): FlatEvent[] {
  const flat: FlatEvent[] = []
  let cursor = 0  // in 64th-note units

  for (const g of groups) {
    const startUnits = ticksToUnits(g.ticks, ppq)
    const gap        = startUnits - cursor

    // Fill gap with rests
    if (gap >= 1) {
      const q = quantise(gap)
      flat.push({ type: 'rest', units: q.units, duration: q.duration, dots: q.dots, velocity: 0 })
      cursor = startUnits
    }

    const rawUnits = Math.max(1, ticksToUnits(g.durationTicks, ppq))
    const q        = quantise(rawUnits)
    const ks       = activeKeySig(g.ticks)

    if (isDrum) {
      const pitches = g.midiNums.map(drumPitch)
      flat.push({ type: g.midiNums.length === 1 ? 'note' : 'chord', units: q.units, duration: q.duration, dots: q.dots, pitches, velocity: Math.round(g.velocity * 127) })
    } else {
      // Concert → written pitch
      const written = g.midiNums.map(m => {
        const writtenMidi = Math.max(0, Math.min(127, m + transposeSemitones))
        return midiToPitch(writtenMidi, ks)
      })
      flat.push({
        type:    written.length === 1 ? 'note' : 'chord',
        units:   q.units,
        duration: q.duration,
        dots:    q.dots,
        pitches: written,
        velocity: Math.round(g.velocity * 127),
      })
    }

    cursor = startUnits + q.units
  }

  return flat
}

// Add dynamic directives to measures when the inferred level changes.
function injectDynamics(measures: Measure[], voiceNotes: FlatEvent[]): Measure[] {
  let lastDynamic: DynamicLevel | null = null
  let noteIdx = 0

  return measures.map(m => {
    const eventsInMeasure = m.voices[0]?.events ?? []
    const firstNote = eventsInMeasure.find(e => e.type !== 'rest')
    if (!firstNote) return m

    // Find the matching flat event for this measure's first note
    while (noteIdx < voiceNotes.length && voiceNotes[noteIdx].type === 'rest') noteIdx++
    const raw = voiceNotes[noteIdx]
    if (!raw || raw.velocity === 0) return m

    const level = inferDynamic(raw.velocity)
    if (level === lastDynamic) { noteIdx++; return m }

    lastDynamic = level
    noteIdx++
    const directive = { id: uuid(), category: 'dynamic' as const, text: level }
    return { ...m, directives: [...(m.directives ?? []), directive] }
  })
}

export function midiToScore(bytes: Uint8Array): Score {
  const midi = new Midi(bytes)
  const ppq  = midi.header.ppq

  // ── Global header events ─────────────────────────────────────────────────────
  const sortedTempos  = [...midi.header.tempos].sort((a, b) => a.ticks - b.ticks)
  const sortedTimeSigs = [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks)
  const sortedKeySigs = [...midi.header.keySignatures].sort((a, b) => a.ticks - b.ticks)

  const initTempo   = Math.round(sortedTempos[0]?.bpm ?? 120)
  const initTsRaw   = sortedTimeSigs[0]?.timeSignature ?? [4, 4]
  const initTimeSig: TimeSignature = { numerator: initTsRaw[0], denominator: initTsRaw[1] }
  const initKsKey   = sortedKeySigs[0]?.key ?? 'C'
  const initKsScale = sortedKeySigs[0]?.scale ?? 'major'
  const initKeySig: KeySignature = { fifths: KEY_TO_FIFTHS[initKsKey] ?? 0, mode: initKsScale as 'major' | 'minor' }

  // ── Measure timeline ─────────────────────────────────────────────────────────
  const notesTracks = midi.tracks.filter(t => t.notes.length > 0)
  const totalTicks  = notesTracks.length > 0
    ? Math.max(...notesTracks.map(t => Math.max(...t.notes.map(n => n.ticks + n.durationTicks))))
    : 0

  const slots = buildMeasureSlots(sortedTimeSigs, totalTicks, ppq)

  // ── Per-slot overrides derived from mid-score events ─────────────────────────
  const tsSwitches   = new Map<number, TimeSignature>()
  const keySwitches  = new Map<number, KeySignature>()
  const tempoChanges = new Map<number, number>()  // slotIdx → bpm

  // Time sig switches: detect when a slot has a different TS than its predecessor
  for (let i = 1; i < slots.length; i++) {
    const prev = slots[i - 1].timeSig, curr = slots[i].timeSig
    if (prev.numerator !== curr.numerator || prev.denominator !== curr.denominator) {
      tsSwitches.set(i, curr)
    }
  }

  // Key sig changes: map each event to the nearest measure start
  for (const ks of sortedKeySigs.slice(1)) {
    const sIdx = findSlotIndex(slots, ks.ticks)
    keySwitches.set(sIdx, { fifths: KEY_TO_FIFTHS[ks.key] ?? 0, mode: ks.scale as 'major' | 'minor' })
  }

  // Tempo changes: map each event to the nearest measure start
  for (const t of sortedTempos.slice(1)) {
    const sIdx = findSlotIndex(slots, t.ticks)
    tempoChanges.set(sIdx, Math.round(t.bpm))
  }

  // Key sig lookup at a given tick
  function activeKeySig(tick: number): KeySignature {
    const sIdx = findSlotIndex(slots, tick)
    for (let i = sIdx; i >= 0; i--) {
      if (keySwitches.has(i)) return keySwitches.get(i)!
    }
    return initKeySig
  }

  if (notesTracks.length === 0) {
    const base = createScore(midi.header.name || 'Imported MIDI')
    return { ...base, tempo: initTempo, timeSignature: initTimeSig, keySignature: initKeySig }
  }

  // ── Import each note-bearing track as a Part ─────────────────────────────────
  const parts: ReturnType<typeof createScore>['parts'][0][] = []

  for (const track of notesTracks) {
    const trackChannel = track.channel   // 0-based; 9 = GM drum channel
    const isDrum    = trackChannel === 9 || track.instrument.percussion
    const program   = isDrum ? 0 : track.instrument.number
    const inst      = lookupInstrument(program, isDrum)
    const transpose = inst?.transposeSemitones ?? 0
    const clef      = inst?.defaultClef ?? (isDrum ? 'percussion' : 'treble')

    // Sort → chord group → split voices (in that order: simultaneous notes = chords, not different voices)
    const sorted   = [...track.notes].sort((a, b) => a.ticks - b.ticks)
    const groups   = groupChords(sorted)
    const [v0groups, v1groups] = splitVoices(groups)
    const hasVoice1 = v1groups.length > 0

    // Convert to flat events
    const v0flat = trackToFlatEvents(v0groups, isDrum, ppq, activeKeySig, transpose)
    const v1flat = hasVoice1 ? trackToFlatEvents(v1groups, isDrum, ppq, activeKeySig, transpose) : []

    // Pack into measures
    const v0measures = packIntoMeasures(v0flat, slots, tsSwitches, keySwitches, tempoChanges)
    // Inject dynamics based on note velocities
    const v0withDyn  = injectDynamics(v0measures, v0flat)

    let finalMeasures: Measure[]

    if (hasVoice1) {
      // Pack Voice 1 and merge into Voice 0 measures
      const v1measures = packIntoMeasures(v1flat, slots, new Map(), new Map(), new Map())
      finalMeasures = v0withDyn.map((m, i) => {
        const v1 = v1measures[i]
        if (!v1) return m
        return { ...m, voices: [...m.voices, { id: uuid(), events: v1.voices[0]?.events ?? [] }] }
      })
    } else {
      finalMeasures = v0withDyn
    }

    // CC 64 → pedal marks (on Voice 0 measures)
    const cc64 = track.controlChanges[64] ?? []
    if (cc64.length > 0) {
      const pedalByMeasure = new Map<number, typeof finalMeasures[0]['pedalMarks']>()
      for (const cc of cc64) {
        const sIdx = findSlotIndex(slots, cc.ticks)
        if (sIdx >= finalMeasures.length) continue
        const slot     = slots[sIdx]
        const beatPos  = ticksToUnits(cc.ticks - slot.startTick, ppq)
        const existing = pedalByMeasure.get(sIdx) ?? []
        pedalByMeasure.set(sIdx, [
          ...existing,
          { id: uuid(), type: cc.value >= 0.5 ? 'down' : 'up', beatPosition: beatPos },
        ])
      }
      finalMeasures = finalMeasures.map((m, i) => {
        const pm = pedalByMeasure.get(i)
        return pm ? { ...m, pedalMarks: pm } : m
      })
    }

    // Build Staff and Part
    const partName  = track.name || (isDrum ? 'Drums' : inst?.name ?? 'Piano')
    const shortName = partName.slice(0, 6) + (partName.length > 6 ? '.' : '')
    const midiCh    = isDrum ? 10 : trackChannel + 1  // convert back to 1-based

    const staff = {
      id: uuid(),
      clef,
      measures: finalMeasures,
    }

    parts.push({
      id:                uuid(),
      name:              partName,
      shortName,
      midiProgram:       inst?.midiProgram ?? program,
      midiChannel:       midiCh,
      transposeSemitones: transpose,
      staves:            [staff],
      volume:            0.8,
      muted:             false,
      labelVisible:      true,
    })
  }

  // ── Assemble Score ────────────────────────────────────────────────────────────
  const base = createScore(midi.header.name || 'Imported MIDI')
  return {
    ...base,
    tempo:         initTempo,
    timeSignature: initTimeSig,
    keySignature:  initKeySig,
    parts:         parts as Score['parts'],
  }
}
