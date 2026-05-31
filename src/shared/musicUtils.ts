import { v4 as uuid } from 'uuid'
import type { Duration, NoteName, Pitch, Accidental, NoteEvent, Note, Staff, Slur, TimeSignature, KeySignature, ClefType, Measure, TupletInfo, Volta, Part, SequenceAssignment } from './score'

// ── Duration arithmetic (64th-note units) ─────────────────────────────────────

export const DURATION_UNITS: Record<Duration, number> = {
  '64th':    1,
  '32nd':    2,
  '16th':    4,
  'eighth':  8,
  'quarter': 16,
  'half':    32,
  'whole':   64,
}

export function dottedUnits(base: number, dots: 0 | 1 | 2): number {
  if (dots === 0) return base
  if (dots === 1) return base + Math.floor(base / 2)
  return base + Math.floor(base / 2) + Math.floor(base / 4)
}

export function eventDurationUnits(event: NoteEvent): number {
  const base = dottedUnits(DURATION_UNITS[event.duration], event.dots)
  const t = (event as any).tuplet as TupletInfo | undefined
  return t ? base * t.normal / t.actual : base
}

export function measureCapacityUnits(timeSig: TimeSignature): number {
  // 64th-note units per measure: e.g. 4/4 → 4*(64/4)=64, 6/8 → 6*(64/8)=48
  return timeSig.numerator * (64 / timeSig.denominator)
}

export function usedUnits(events: readonly NoteEvent[]): number {
  return events.reduce((sum, e) => sum + eventDurationUnits(e), 0)
}

export function remainingUnits(events: readonly NoteEvent[], timeSig: TimeSignature): number {
  return measureCapacityUnits(timeSig) - usedUnits(events)
}

// Returns the beat position of the first rest event (i.e. the first "free" input position).
// If there are no rests, returns the total used units (measure is full of notes).
export function firstRestBeat(events: readonly NoteEvent[]): number {
  let beat = 0
  for (const e of events) {
    if (e.type === 'rest') return beat
    beat += eventDurationUnits(e)
  }
  return beat
}

const FILL_REST_TABLE: { units: number; duration: Duration; dots: 0 | 1 | 2 }[] = [
  { units: 64, duration: 'whole',   dots: 0 },
  { units: 48, duration: 'half',    dots: 1 },
  { units: 32, duration: 'half',    dots: 0 },
  { units: 24, duration: 'quarter', dots: 1 },
  { units: 16, duration: 'quarter', dots: 0 },
  { units: 12, duration: 'eighth',  dots: 1 },
  { units:  8, duration: 'eighth',  dots: 0 },
  { units:  6, duration: '16th',    dots: 1 },
  { units:  4, duration: '16th',    dots: 0 },
  { units:  3, duration: '32nd',    dots: 1 },
  { units:  2, duration: '32nd',    dots: 0 },
  { units:  1, duration: '64th',    dots: 0 },
]

export function fillWithRests(units: number): NoteEvent[] {
  const result: NoteEvent[] = []
  let remaining = units
  for (const row of FILL_REST_TABLE) {
    while (remaining >= row.units) {
      result.push({ id: uuid(), type: 'rest', duration: row.duration, dots: row.dots } as NoteEvent)
      remaining -= row.units
    }
  }
  return result
}

export function resolveTimeSig(
  measures: readonly { timeSignature?: TimeSignature }[],
  idx: number,
  scoreDefault: TimeSignature
): TimeSignature {
  for (let i = Math.min(idx, measures.length - 1); i >= 0; i--) {
    if (measures[i].timeSignature) return measures[i].timeSignature!
  }
  return scoreDefault
}

export function timeSigsEqual(a: TimeSignature, b: TimeSignature): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator
}

export function resolveKeySig(
  measures: readonly { keySignature?: KeySignature }[],
  idx: number,
  scoreDefault: KeySignature
): KeySignature {
  for (let i = Math.min(idx, measures.length - 1); i >= 0; i--) {
    if (measures[i].keySignature) return measures[i].keySignature!
  }
  return scoreDefault
}

// Convert a concert key (fifths) to written key for a transposing instrument.
// transposeSemitones: positive = written is above concert (e.g. Bb clarinet = +2).
export function transposeKeyFifths(concertFifths: number, transposeSemitones: number): number {
  if (transposeSemitones === 0) return concertFifths
  const norm = ((transposeSemitones % 12) + 12) % 12
  const raw  = (norm * 7) % 12
  const fifthsChange = raw > 6 ? raw - 12 : raw
  return Math.max(-7, Math.min(7, concertFifths + fifthsChange))
}

export function resolveClef(
  measures: readonly { clef?: { type: ClefType } }[],
  idx: number,
  staffDefault: ClefType
): ClefType {
  for (let i = Math.min(idx, measures.length - 1); i >= 0; i--) {
    if (measures[i].clef) return measures[i].clef!.type
  }
  return staffDefault
}

const MAJOR_KEY_LABELS: Partial<Record<number, string>> = {
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
  [-1]: 'F', [-2]: 'Bb', [-3]: 'Eb', [-4]: 'Ab', [-5]: 'Db', [-6]: 'Gb', [-7]: 'Cb',
}

const MINOR_KEY_LABELS: Partial<Record<number, string>> = {
  0: 'A', 1: 'E', 2: 'B', 3: 'F#', 4: 'C#', 5: 'G#', 6: 'D#',
  [-1]: 'D', [-2]: 'G', [-3]: 'C', [-4]: 'F', [-5]: 'Bb', [-6]: 'Eb', [-7]: 'Ab',
}

export function keyLabel(key: KeySignature): string {
  if (key.mode === 'major') return `${MAJOR_KEY_LABELS[key.fifths] ?? 'C'} maj`
  return `${MINOR_KEY_LABELS[key.fifths] ?? 'A'} min`
}

// ── Octave proximity ──────────────────────────────────────────────────────────
// Given a target note name and the last entered pitch, choose the octave that
// produces the smallest interval (preferring upward on ties).

const NOTE_SEMITONES: Record<NoteName, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}

function midiNote(name: NoteName, octave: number): number {
  return (octave + 1) * 12 + NOTE_SEMITONES[name]
}

const CHROMATIC_PITCH: Array<{ noteName: NoteName; accidental: 'sharp' | null }> = [
  { noteName: 'C', accidental: null },
  { noteName: 'C', accidental: 'sharp' },
  { noteName: 'D', accidental: null },
  { noteName: 'D', accidental: 'sharp' },
  { noteName: 'E', accidental: null },
  { noteName: 'F', accidental: null },
  { noteName: 'F', accidental: 'sharp' },
  { noteName: 'G', accidental: null },
  { noteName: 'G', accidental: 'sharp' },
  { noteName: 'A', accidental: null },
  { noteName: 'A', accidental: 'sharp' },
  { noteName: 'B', accidental: null },
]

export function shiftPitchBySemitones(
  noteName: NoteName,
  octave: number,
  accidental: Accidental,
  semitones: number,
): { noteName: NoteName; octave: number; accidental: 'sharp' | null } {
  let midi = (octave + 1) * 12 + NOTE_SEMITONES[noteName]
  if (accidental === 'sharp')           midi += 1
  else if (accidental === 'flat')       midi -= 1
  else if (accidental === 'doubleSharp') midi += 2
  else if (accidental === 'doubleFlat')  midi -= 2
  midi = Math.max(0, Math.min(127, midi + semitones))
  const newOctave = Math.floor(midi / 12) - 1
  const pc = ((midi % 12) + 12) % 12
  return { ...CHROMATIC_PITCH[pc], octave: newOctave }
}

export function closestOctave(noteName: NoteName, prevPitch: Pitch | null): number {
  if (!prevPitch) return 4
  const prevMidi = midiNote(prevPitch.noteName, prevPitch.octave)
  let bestOctave = 4
  let bestDist = Infinity
  for (let oct = 1; oct <= 7; oct++) {
    const midi = midiNote(noteName, oct)
    const dist = Math.abs(midi - prevMidi)
    if (dist < bestDist || (dist === bestDist && midi > prevMidi)) {
      bestDist = dist
      bestOctave = oct
    }
  }
  return bestOctave
}

// ── Staff position → pitch ────────────────────────────────────────────────────
// "step" = half a line-spacing unit, starting at 0 (top staff line), increasing
// downward. Each integer step is one staff position (alternating lines/spaces).
//
// Treble clef reference: C4 sits at step 10 (first ledger line below).
// Bass clef reference:   C2 sits at step 12 (second ledger line below).

const DIATONIC: NoteName[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

const CLEF_REF: Record<string, { step: number; octave: number }> = {
  treble:     { step: 10, octave: 4 },
  bass:       { step: 12, octave: 2 },
  alto:       { step: 4,  octave: 4 },  // C4 on 3rd (middle) line
  tenor:      { step: 6,  octave: 4 },  // C4 on 4th line
  percussion: { step: 10, octave: 4 },  // unpitched — treble fallback
}

export function stepToPitch(step: number, clef: ClefType): { noteName: NoteName; octave: number } {
  const ref = CLEF_REF[clef] ?? CLEF_REF.treble
  const stepsAboveRef = ref.step - step          // positive = above ref C
  const noteIndex = ((stepsAboveRef % 7) + 7) % 7
  const octave    = ref.octave + Math.floor(stepsAboveRef / 7)
  return { noteName: DIATONIC[noteIndex], octave }
}

// Inverse of stepToPitch: given a stored pitch and clef, returns the staff step.
export function pitchToStep(pitch: { noteName: NoteName; octave: number }, clef: ClefType): number {
  const ref       = CLEF_REF[clef] ?? CLEF_REF.treble
  const noteIndex = DIATONIC.indexOf(pitch.noteName)
  const stepsAboveRef = noteIndex + 7 * (pitch.octave - ref.octave)
  return ref.step - stepsAboveRef
}

// Convert a canvas Y coordinate to a staff step given the stave's top-line Y.
export function yToStep(clickY: number, staveTopY: number, lineSpacingPx: number = 10): number {
  return Math.round((clickY - staveTopY) / (lineSpacingPx / 2))
}

// ── Duration key map ──────────────────────────────────────────────────────────

export const KEY_TO_DURATION: Record<string, Duration> = {
  '1': '64th',
  '2': '32nd',
  '3': '16th',
  '4': 'eighth',
  '5': 'quarter',
  '6': 'half',
  '7': 'whole',
}

// ── Directive resolution ──────────────────────────────────────────────────────

export const DYNAMIC_VOLUME: Record<string, number> = {
  ppp: 0.15, pp: 0.25, p: 0.40, mp: 0.55, mf: 0.65, f: 0.80, ff: 0.90, fff: 1.00,
}

export const TEMPO_WORDS: { text: string; bpm: number }[] = [
  { text: 'Larghissimo', bpm: 24  },
  { text: 'Largo',       bpm: 40  },
  { text: 'Larghetto',   bpm: 60  },
  { text: 'Adagio',      bpm: 66  },
  { text: 'Adagietto',   bpm: 72  },
  { text: 'Andante',     bpm: 76  },
  { text: 'Andantino',   bpm: 84  },
  { text: 'Moderato',    bpm: 96  },
  { text: 'Allegretto',  bpm: 112 },
  { text: 'Allegro',     bpm: 120 },
  { text: 'Vivace',      bpm: 140 },
  { text: 'Presto',      bpm: 168 },
  { text: 'Prestissimo', bpm: 200 },
]

export function resolveDirectiveTempo(measures: readonly Measure[], idx: number, scoreTempo: number): number {
  for (let i = idx; i >= 0; i--) {
    const d = measures[i].directives?.find(d => d.category === 'tempo' && d.bpm != null)
    if (d?.bpm != null) return d.bpm
  }
  return scoreTempo
}

export function resolveDirectiveDynamic(measures: readonly Measure[], idx: number): number | null {
  for (let i = idx; i >= 0; i--) {
    const d = measures[i].directives?.find(d => d.category === 'dynamic')
    if (d) return DYNAMIC_VOLUME[d.text] ?? null
  }
  return null
}

export function resolveDirectiveMidiProgram(measures: readonly Measure[], idx: number, partMidiProgram: number): number {
  for (let i = idx; i >= 0; i--) {
    const d = measures[i].directives?.find(d => d.category === 'expression' && d.midiProgram != null)
    if (d?.midiProgram === -1) return partMidiProgram
    if (d?.midiProgram != null) return d.midiProgram
  }
  return partMidiProgram
}

// ── Articulation playback modifiers ───────────────────────────────────────────

export function articulationPlaybackMods(event: NoteEvent): {
  durFactor: number
  volDbBonus: number  // add to volDb in audio/sampler engines
  velFactor: number   // multiply MIDI velocity
} {
  const arts: readonly string[] = (event as any).articulations ?? []
  let durFactor = 1
  let volDbBonus = 0
  let velFactor = 1
  for (const art of arts) {
    if (art === 'staccato') durFactor *= 0.45
    if (art === 'fermata')  durFactor *= 2.0
    if (art === 'marcato')  { durFactor *= 0.85; volDbBonus += 4; velFactor *= 1.45 }
    if (art === 'accent')   { volDbBonus += 2;   velFactor *= 1.30 }
  }
  return { durFactor, volDbBonus, velFactor }
}

// ── Ornament expansion ────────────────────────────────────────────────────────

const SHARPS_ORDER: NoteName[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const FLATS_ORDER:  NoteName[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

function keyAccidental(noteName: NoteName, fifths: number): 'sharp' | 'flat' | null {
  if (fifths > 0) return SHARPS_ORDER.slice(0, fifths).includes(noteName) ? 'sharp' : null
  if (fifths < 0) return FLATS_ORDER.slice(0, -fifths).includes(noteName) ? 'flat' : null
  return null
}

function diatonicNeighbor(
  noteName: NoteName,
  octave: number,
  direction: 'up' | 'down',
  fifths: number,
): { noteName: NoteName; octave: number; accidental: 'sharp' | 'flat' | null } {
  const idx = DIATONIC.indexOf(noteName)
  let newIdx: number
  let newOctave: number
  if (direction === 'up') {
    newIdx = (idx + 1) % 7
    newOctave = octave + (newIdx === 0 ? 1 : 0)
  } else {
    newIdx = (idx + 6) % 7
    newOctave = octave - (newIdx === 6 ? 1 : 0)
  }
  const newName = DIATONIC[newIdx]
  return { noteName: newName, octave: newOctave, accidental: keyAccidental(newName, fifths) }
}

export interface OrnamentNote {
  noteName: NoteName
  octave: number
  accidental: 'sharp' | 'flat' | null
  startSec: number
  durSec: number
}

export function expandOrnamentNotes(
  event: NoteEvent,
  startSec: number,
  playDurSec: number,
  bpm: number,
  keySig: KeySignature,
): OrnamentNote[] | null {
  if (event.type !== 'note') return null
  const arts: readonly string[] = (event as any).articulations ?? []
  const hasTrill     = arts.includes('trill')
  const hasMordent   = arts.includes('mordent')
  const hasMordentUp = arts.includes('mordent-upper')
  const hasTurn      = arts.includes('turn')
  if (!hasTrill && !hasMordent && !hasMordentUp && !hasTurn) return null

  const n = event as Note
  const { noteName, octave } = n.pitch
  const { fifths } = keySig
  const upper = diatonicNeighbor(noteName, octave, 'up',   fifths)
  const lower = diatonicNeighbor(noteName, octave, 'down', fifths)
  const principal = { noteName, octave, accidental: null as 'sharp' | 'flat' | null }

  if (hasTrill) {
    const unitSec = Math.min((60 / bpm) / 8, playDurSec / 3)
    const rawCount = Math.max(3, Math.floor(playDurSec / unitSec))
    const count = rawCount % 2 === 0 ? rawCount - 1 : rawCount
    const notes: OrnamentNote[] = []
    for (let i = 0; i < count; i++) {
      const pitch = i % 2 === 0 ? principal : upper
      const isLast = i === count - 1
      const dur = isLast ? Math.max(0.02, playDurSec - (count - 1) * unitSec) : unitSec
      notes.push({ ...pitch, startSec: startSec + i * unitSec, durSec: dur })
    }
    return notes
  }

  if (hasMordent) {
    const u = playDurSec / 3
    return [
      { ...principal, startSec: startSec,        durSec: u },
      { ...lower,     startSec: startSec + u,     durSec: u },
      { ...principal, startSec: startSec + 2 * u, durSec: u },
    ]
  }

  if (hasMordentUp) {
    const u = playDurSec / 3
    return [
      { ...principal, startSec: startSec,        durSec: u },
      { ...upper,     startSec: startSec + u,     durSec: u },
      { ...principal, startSec: startSec + 2 * u, durSec: u },
    ]
  }

  // turn: upper → principal → lower → principal
  const u = playDurSec / 4
  return [
    { ...upper,     startSec: startSec,        durSec: u },
    { ...principal, startSec: startSec + u,     durSec: u },
    { ...lower,     startSec: startSec + 2 * u, durSec: u },
    { ...principal, startSec: startSec + 3 * u, durSec: u },
  ]
}

export function buildPlaybackSequence(measures: readonly Measure[], voltas: readonly Volta[] = []): number[] {
  const order: number[] = []

  // Pass count is tracked per repeat-start index (the measure we jump back to).
  // passCount.get(rs) = number of completed passes through this repeat block.
  const passCount = new Map<number, number>()

  // Scan backward from repeatEndIdx to find the measure we jump back to.
  const findRepeatStart = (repeatEndIdx: number): number => {
    for (let j = repeatEndIdx - 1; j >= 0; j--) {
      if (measures[j]?.barline === 'repeat-start') return j + 1
    }
    return 0
  }

  const voltaAt = (mIdx: number): Volta | undefined =>
    voltas.find(v => mIdx >= v.startMeasureIndex && mIdx <= v.endMeasureIndex)

  // For a volta, find the repeat-start index of its repeat block by scanning
  // backward from the volta's start to the nearest repeat-end or repeat-start.
  // Volta 2+ begins after a repeat-end; volta 1 begins within the block itself.
  const voltaRepeatStart = (v: Volta): number => {
    for (let j = v.startMeasureIndex - 1; j >= 0; j--) {
      if (measures[j]?.barline === 'repeat-end') return findRepeatStart(j)
      if (measures[j]?.barline === 'repeat-start') return j + 1
    }
    return 0
  }

  let i = 0
  while (i < measures.length) {
    const volta = voltaAt(i)
    if (volta) {
      const rs   = voltaRepeatStart(volta)
      const pass = (passCount.get(rs) ?? 0) + 1  // 1-based current pass number
      if (volta.number !== pass) {
        i = volta.endMeasureIndex + 1
        continue
      }
    }

    order.push(i)

    if (measures[i]?.barline === 'repeat-end') {
      const rs          = findRepeatStart(i)
      const currentPass = passCount.get(rs) ?? 0

      // All voltas whose block jumps to this same repeat-start determine how many endings exist.
      // With no voltas, maxEnding=2 means play once then repeat once (standard repeat behaviour).
      const voltasInBlock = voltas.filter(v => voltaRepeatStart(v) === rs)
      const maxEnding     = voltasInBlock.length > 0 ? Math.max(...voltasInBlock.map(v => v.number)) : 2

      if (currentPass < maxEnding - 1) {
        passCount.set(rs, currentPass + 1)
        i = rs
        continue
      }
      passCount.delete(rs)
    }

    i++
  }

  return order
}

// ── Playback scheduling ────────────────────────────────────────────────────────

const DURATION_BEATS: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5,
  '16th': 0.25, '32nd': 0.125, '64th': 0.0625,
}

export function eventToSeconds(event: NoteEvent, bpm: number): number {
  const beats = DURATION_BEATS[event.duration] ?? 1
  const dotted = event.dots === 2 ? beats * 1.75 : event.dots === 1 ? beats * 1.5 : beats
  const t = (event as any).tuplet as TupletInfo | undefined
  return dotted * (t ? t.normal / t.actual : 1) * (60 / bpm)
}

export interface FlatScheduleEntry {
  event: NoteEvent
  mIdx: number
  startSec: number
  playDurSec: number       // merged duration for tied notes; equals base duration otherwise
  skip: boolean            // tied continuation — do not schedule sound for this event
  legatoUntilSec: number | null  // non-null for slurred notes (not the last): release note here, not at startSec+playDurSec
}

// Builds a flat, time-ordered schedule of events for one staff voice,
// honouring the playback sequence (repeats) and merging tied note durations.
// Each measure boundary snaps time forward to the full measure duration so that
// partially-filled measures (notes without explicit rests) still leave the
// correct silence before the next measure begins.
export function buildFlatSchedule(
  staff: Staff,
  sequence: number[],
  tempoStaff: Staff,
  baseBpm: number,
  baseTimeSig: TimeSignature,
  slurs?: readonly Slur[],
): FlatScheduleEntry[] {
  const result: FlatScheduleEntry[] = []
  let t = 0

  for (const mIdx of sequence) {
    const measure = staff.measures[mIdx]
    if (!measure) continue

    const bpm     = resolveDirectiveTempo(tempoStaff.measures, mIdx, baseBpm)
    const timeSig = resolveTimeSig(staff.measures, mIdx, baseTimeSig)
    // Measure duration in seconds: capacity is in 64th-note units; 1 quarter = 16 units
    const measureDurSec = (measureCapacityUnits(timeSig) / 16) * (60 / bpm)
    const measureStartT = t

    // Schedule events from every voice, each starting at measureStartT (voices play in parallel)
    for (const voice of measure.voices) {
      let voiceT = measureStartT
      for (const event of voice.events) {
        const dur = eventToSeconds(event, bpm)
        result.push({ event, mIdx, startSec: voiceT, playDurSec: dur, skip: false, legatoUntilSec: null })
        voiceT += dur
      }
    }

    // Snap to measure boundary so unfilled beats don't compress subsequent measures
    t = measureStartT + measureDurSec
  }

  // Merge tied note chains: accumulate duration into the first note, mark successors skip
  for (let i = 0; i < result.length; i++) {
    const fe = result[i]
    if (fe.event.type !== 'note') continue
    if (!(fe.event as Note).tieStart) continue

    let merged = fe.playDurSec
    let j = i + 1
    while (j < result.length) {
      const next = result[j]
      if (next.event.type !== 'note') break
      const nxt = next.event as Note
      if (!nxt.tieEnd) break
      merged += next.playDurSec
      next.skip = true
      if (!nxt.tieStart) break  // chain ends here
      j++
    }
    fe.playDurSec = merged
  }

  // Legato pass: for slurred notes (all except the endpoint), set legatoUntilSec so
  // the engine can hold the note in sustain through the next note's attack rather
  // than releasing early via triggerAttackRelease.
  // 60 ms overlap ensures the release envelope overlaps the next note's attack phase.
  // Parallel-voice entries share startSec, so gap ≤ 0 → skip (single-voice slurs only).
  const LEGATO_OVERLAP_SEC = 0.06
  if (slurs?.length) {
    for (const slur of slurs) {
      const fromIdx = result.findIndex(fe => fe.event.id === slur.fromNoteId)
      const toIdx   = result.findIndex(fe => fe.event.id === slur.toNoteId)
      if (fromIdx === -1 || toIdx === -1) continue
      const lo = Math.min(fromIdx, toIdx)
      const hi = Math.max(fromIdx, toIdx)
      for (let i = lo; i < hi; i++) {
        if (result[i].skip) continue
        const gap = result[i + 1].startSec - result[i].startSec
        if (gap > 0) result[i].legatoUntilSec = result[i + 1].startSec + LEGATO_OVERLAP_SEC
      }
    }
  }

  return result
}

export interface MeasureTimeEntry {
  mIdx: number       // actual measure index in the staff
  startSec: number   // transport seconds at start of this measure
  durationSec: number
}

// Builds a time-ordered list of measure timings for the playback sequence,
// mirroring the same logic as buildFlatSchedule but without note events.
export function buildMeasureTimeline(
  staff: Staff,
  sequence: number[],
  tempoStaff: Staff,
  baseBpm: number,
  baseTimeSig: TimeSignature,
): MeasureTimeEntry[] {
  const result: MeasureTimeEntry[] = []
  let t = 0
  for (const mIdx of sequence) {
    const measure = staff.measures[mIdx]
    if (!measure) continue
    const bpm        = resolveDirectiveTempo(tempoStaff.measures, mIdx, baseBpm)
    const timeSig    = resolveTimeSig(staff.measures, mIdx, baseTimeSig)
    const durationSec = (measureCapacityUnits(timeSig) / 16) * (60 / bpm)
    result.push({ mIdx, startSec: t, durationSec })
    t += durationSec
  }
  return result
}

export const DURATION_LABELS: Record<Duration, string> = {
  '64th':    '64th',
  '32nd':    '32nd',
  '16th':    '16th',
  'eighth':  '8th',
  'quarter': 'Quarter',
  'half':    'Half',
  'whole':   'Whole',
}

// ── Sequence scheduling ───────────────────────────────────────────────────────

export interface SequenceScheduleEntry {
  midiPitch: number
  velocity:  number
  startSec:  number
  durSec:    number
}

// Returns the active SequenceAssignment at measureIndex, or null if none.
// "Active" means the assignment with the greatest startMeasureIndex ≤ measureIndex.
export function activeAssignmentAt(assignments: readonly SequenceAssignment[], mIdx: number): SequenceAssignment | null {
  let best: SequenceAssignment | null = null
  for (const a of assignments) {
    if (a.startMeasureIndex <= mIdx && (!best || a.startMeasureIndex > best.startMeasureIndex)) {
      best = a
    }
  }
  return best
}

export function buildSequenceSchedule(
  part: Part,
  measureSequence: number[],
  tempoStaff: Staff,
  baseBpm: number,
  baseTimeSig: TimeSignature,
): SequenceScheduleEntry[] {
  if (part.inputMode !== 'sequencer') return []
  const assignments = part.sequenceAssignments ?? []
  const patterns    = part.sequencePatterns ?? []
  if (assignments.length === 0) return []

  const result: SequenceScheduleEntry[] = []

  // Build timing parallel to measureSequence (array not map — a measure can appear
  // multiple times when there are repeats, so keying by measure index would collide).
  const measureTimings: { startSec: number; measureDurSec: number }[] = []
  let t = 0
  for (const mIdx of measureSequence) {
    const bpm     = resolveDirectiveTempo(tempoStaff.measures, mIdx, baseBpm)
    const timeSig = resolveTimeSig(part.staves[0]?.measures ?? [], mIdx, baseTimeSig)
    const durSec  = (measureCapacityUnits(timeSig) / 16) * (60 / bpm)
    measureTimings.push({ startSec: t, measureDurSec: durSec })
    t += durSec
  }

  for (let seqPos = 0; seqPos < measureSequence.length; seqPos++) {
    const mIdx      = measureSequence[seqPos]
    const assignment = activeAssignmentAt(assignments, mIdx)
    if (!assignment || assignment.patternId === null) continue

    const pattern = patterns.find(p => p.id === assignment.patternId)
    if (!pattern || pattern.stepsPerBar === 0) continue

    const { startSec, measureDurSec } = measureTimings[seqPos]
    const stepDurSec = measureDurSec / pattern.stepsPerBar

    for (let step = 0; step < pattern.stepsPerBar; step++) {
      const cells = pattern.steps[step]
      if (!cells || cells.length === 0) continue
      for (const cell of cells) {
        result.push({
          midiPitch: cell.pitch,
          velocity:  cell.velocity,
          startSec:  startSec + step * stepDurSec,
          durSec:    stepDurSec,
        })
      }
    }
  }

  return result
}
