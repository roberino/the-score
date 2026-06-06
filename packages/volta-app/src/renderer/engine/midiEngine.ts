// ─────────────────────────────────────────────────────────────────────────────
// MIDI import / export
//
// scoreToMidi  — Score → Uint8Array (Standard MIDI Type 0)
// midiToScore  — Uint8Array → Score
//
// Uses @tonejs/midi for binary encoding/decoding.
// All duration arithmetic is in 64th-note units to keep it integer-clean.
// ─────────────────────────────────────────────────────────────────────────────

import { Midi } from '@tonejs/midi'
import { v4 as uuid } from 'uuid'
import {
  createScore, createMeasure, createNote, createRest,
  type Score, type Note, type Chord, type Rest, type NoteEvent,
  type Duration, type Pitch, type BarlineType, type TimeSignature,
} from '@shared/score'
import { measureCapacityUnits, activeAssignmentAt } from '@shared/musicUtils'

// ── Duration tables ───────────────────────────────────────────────────────────

const DURATION_BEATS: Record<Duration, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5,
  '16th': 0.25, '32nd': 0.125, '64th': 0.0625,
}

// All standard durations + dotted, sorted largest-first for greedy fill
const QUANTISE_TABLE: { duration: Duration; dots: 0 | 1; units: number }[] = [
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

function quantise(units: number): { duration: Duration; dots: 0 | 1; units: number } {
  return QUANTISE_TABLE.reduce((best, q) =>
    Math.abs(q.units - units) < Math.abs(best.units - units) ? q : best
  )
}

// Greedy fill of `totalUnits` with rests, largest-first
function fillRests(totalUnits: number): Array<{ duration: Duration; dots: 0 | 1; units: number }> {
  const out: typeof QUANTISE_TABLE = []
  let remaining = totalUnits
  for (const q of QUANTISE_TABLE) {
    while (remaining >= q.units) {
      out.push(q)
      remaining -= q.units
    }
  }
  return out
}

// ── Pitch helpers ─────────────────────────────────────────────────────────────

const SEMITONES_FROM_C: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}

const MIDI_NOTE_NAMES: Array<{ name: string; accidental: 'sharp' | null }> = [
  { name: 'C',  accidental: null  },
  { name: 'C',  accidental: 'sharp' },
  { name: 'D',  accidental: null  },
  { name: 'D',  accidental: 'sharp' },
  { name: 'E',  accidental: null  },
  { name: 'F',  accidental: null  },
  { name: 'F',  accidental: 'sharp' },
  { name: 'G',  accidental: null  },
  { name: 'G',  accidental: 'sharp' },
  { name: 'A',  accidental: null  },
  { name: 'A',  accidental: 'sharp' },
  { name: 'B',  accidental: null  },
]

function midiToPitch(midi: number): Pitch {
  const semi   = midi % 12
  const octave = Math.floor(midi / 12) - 1
  const entry  = MIDI_NOTE_NAMES[semi]
  return { noteName: entry.name as Pitch['noteName'], octave, accidental: entry.accidental }
}

function pitchToMidi(pitch: Pitch): number {
  let semi = SEMITONES_FROM_C[pitch.noteName] ?? 0
  if (pitch.accidental === 'sharp')        semi += 1
  else if (pitch.accidental === 'flat')    semi -= 1
  else if (pitch.accidental === 'doubleSharp') semi += 2
  else if (pitch.accidental === 'doubleFlat')  semi -= 2
  return (pitch.octave + 1) * 12 + semi
}

// ── Export ────────────────────────────────────────────────────────────────────

function measureTicks(timeSig: TimeSignature, ppq: number): number {
  return Math.round(timeSig.numerator * (4 / timeSig.denominator) * ppq)
}

export function scoreToMidi(score: Score): Uint8Array {
  const midi = new Midi()

  midi.header.tempos.push({ bpm: score.tempo, ticks: 0 })
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: [score.timeSignature.numerator, score.timeSignature.denominator],
    measures: 0,
  })

  const ppq = midi.header.ppq   // 480

  for (const part of score.parts) {
    const staff = part.staves[0]
    if (!staff) continue

    const track = midi.addTrack()
    track.name = part.name
    const channel = (part.midiChannel ?? 1) - 1  // @tonejs/midi uses 0-based channels
    track.channel = channel

    let currentTick = 0

    if (part.inputMode === 'sequencer') {
      // Expand sequence assignments inline
      const assignments = part.sequenceAssignments ?? []
      const patterns    = part.sequencePatterns ?? []

      for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
        const timeSig  = staff.measures[mIdx].timeSignature ?? score.timeSignature
        const mTicks   = measureTicks(timeSig, ppq)
        const assignment = activeAssignmentAt(assignments, mIdx)

        if (assignment && assignment.patternId !== null) {
          const pattern = patterns.find(p => p.id === assignment.patternId)
          if (pattern && pattern.stepsPerBar > 0) {
            const stepTicks = mTicks / pattern.stepsPerBar
            for (let step = 0; step < pattern.stepsPerBar; step++) {
              const cells = pattern.steps[step]
              if (!cells || cells.length === 0) continue
              for (const cell of cells) {
                track.addNote({
                  midi:         cell.pitch,
                  ticks:        currentTick + Math.round(step * stepTicks),
                  durationTicks: Math.max(1, Math.round(stepTicks)),
                  velocity:     cell.velocity / 127,
                })
              }
            }
          }
        }

        currentTick += mTicks
      }
    } else {
      // Standard score part
      for (const measure of staff.measures) {
        for (const event of measure.voices[0]?.events ?? []) {
          const beats         = DURATION_BEATS[event.duration] ?? 1
          const dotFactor     = event.dots === 2 ? 1.75 : event.dots === 1 ? 1.5 : 1
          const durationTicks = Math.round(beats * dotFactor * ppq)

          if (event.type === 'note') {
            track.addNote({
              midi:         pitchToMidi((event as Note).pitch),
              ticks:        currentTick,
              durationTicks,
              velocity:     0.8,
            })
          } else if (event.type === 'chord') {
            for (const pitch of (event as Chord).pitches) {
              track.addNote({
                midi:         pitchToMidi(pitch),
                ticks:        currentTick,
                durationTicks,
                velocity:     0.8,
              })
            }
          }
          // rests: just advance tick

          currentTick += durationTicks
        }
      }
    }
  }

  return midi.toArray()
}

// ── Import ────────────────────────────────────────────────────────────────────

const CHORD_TICK_TOLERANCE = 5

export function midiToScore(bytes: Uint8Array): Score {
  const midi = new Midi(bytes)
  const ppq  = midi.header.ppq

  const bpm   = Math.round(midi.header.tempos[0]?.bpm ?? 120)
  const tsRaw = midi.header.timeSignatures[0]?.timeSignature ?? ([4, 4] as [number, number])
  const timeSig: TimeSignature = { numerator: tsRaw[0], denominator: tsRaw[1] }

  const track = midi.tracks.find(t => t.notes.length > 0)

  if (!track) {
    const base = createScore(midi.header.name || 'Imported MIDI')
    return { ...base, tempo: bpm, timeSignature: timeSig }
  }

  // ── Step 1: group simultaneous notes into chords ─────────────────────────

  type Group = { ticks: number; durationTicks: number; pitches: Pitch[] }
  const sorted = [...track.notes].sort((a, b) => a.ticks - b.ticks)
  const groups: Group[] = []

  let i = 0
  while (i < sorted.length) {
    const ref   = sorted[i]
    const group = [ref]
    let   j     = i + 1
    while (j < sorted.length && sorted[j].ticks - ref.ticks <= CHORD_TICK_TOLERANCE) {
      group.push(sorted[j])
      j++
    }
    groups.push({
      ticks:        ref.ticks,
      durationTicks: Math.max(...group.map(n => n.durationTicks)),
      pitches:      group.map(n => midiToPitch(n.midi)),
    })
    i = j
  }

  // ── Step 2: build flat event list, filling gaps with rests ───────────────

  // Convert ticks → 64th-note units (quarter = 16)
  const toUnits = (t: number) => Math.round((t / ppq) * 16)

  type FlatEv = { duration: Duration; dots: 0 | 1; units: number; type: 'note' | 'chord' | 'rest'; pitches?: Pitch[] }
  const flat: FlatEv[] = []
  let cursor = 0  // in 64th-note units

  for (const g of groups) {
    const start = toUnits(g.ticks)
    const gap   = start - cursor

    if (gap > 0) {
      for (const r of fillRests(gap)) {
        flat.push({ ...r, type: 'rest' })
      }
      cursor = start
    }

    const rawUnits = Math.max(toUnits(g.durationTicks), 1)
    const q        = quantise(rawUnits)
    flat.push({
      ...q,
      type:   g.pitches.length === 1 ? 'note' : 'chord',
      pitches: g.pitches,
    })
    cursor = start + q.units
  }

  // ── Step 3: pack flat events into measures ───────────────────────────────

  const capacity = measureCapacityUnits(timeSig)
  const measures: Measure[] = []
  let mNum    = 1
  let mEvents: NoteEvent[] = []
  let beatPos = 0

  const buildEvent = (ev: FlatEv): NoteEvent => {
    if (ev.type === 'rest') {
      return { ...createRest(ev.duration), dots: ev.dots } as Rest
    }
    if (ev.type === 'note') {
      const p = ev.pitches![0]
      return { ...createNote(p.noteName, p.octave, ev.duration, p.accidental), dots: ev.dots } as Note
    }
    // chord
    return {
      id:           uuid(),
      type:         'chord',
      duration:     ev.duration,
      dots:         ev.dots,
      pitches:      ev.pitches!,
      articulations: [],
    } as Chord
  }

  const closeMeasure = (barline: BarlineType = 'single') => {
    // Pad remainder with rests
    let rem = capacity - beatPos
    for (const r of fillRests(rem)) {
      mEvents.push(buildEvent({ ...r, type: 'rest' }))
      rem -= r.units
    }
    measures.push({
      id:     uuid(),
      number: mNum++,
      voices: [{ id: uuid(), events: mEvents }],
      barline,
    })
    mEvents  = []
    beatPos  = 0
  }

  for (const ev of flat) {
    if (beatPos + ev.units > capacity) closeMeasure()

    mEvents.push(buildEvent(ev))
    beatPos += ev.units

    if (beatPos >= capacity) closeMeasure()
  }

  if (mEvents.length > 0) closeMeasure()

  // Pad to at least 8 measures
  while (measures.length < 8) measures.push(createMeasure(mNum++))

  // Enforce barlines
  for (let k = 0; k < measures.length - 1; k++) {
    measures[k] = { ...measures[k], barline: 'single' }
  }
  measures[measures.length - 1] = { ...measures[measures.length - 1], barline: 'final' }

  // ── Build Score ───────────────────────────────────────────────────────────

  const base = createScore(midi.header.name || track.name || 'Imported MIDI')
  return {
    ...base,
    tempo:         bpm,
    timeSignature: timeSig,
    parts: [{
      ...base.parts[0],
      name:      track.name || base.parts[0].name,
      shortName: base.parts[0].shortName,
      staves:    [{ ...base.parts[0].staves[0], measures }],
    }],
  }
}

// TypeScript: Measure is inferred inline — make it explicit
type Measure = ReturnType<typeof createMeasure>
