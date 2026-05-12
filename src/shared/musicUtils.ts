import type { Duration, NoteName, Pitch, NoteEvent, TimeSignature, ClefType } from './score'

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
  return dottedUnits(DURATION_UNITS[event.duration], event.dots)
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

export function resolveTimeSig(
  measures: readonly { timeSignature?: TimeSignature }[],
  idx: number,
  scoreDefault: TimeSignature
): TimeSignature {
  for (let i = idx; i >= 0; i--) {
    if (measures[i].timeSignature) return measures[i].timeSignature!
  }
  return scoreDefault
}

export function timeSigsEqual(a: TimeSignature, b: TimeSignature): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator
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

const CLEF_REF: Record<'treble' | 'bass', { step: number; octave: number }> = {
  treble: { step: 10, octave: 4 },
  bass:   { step: 12, octave: 2 },
}

export function stepToPitch(step: number, clef: ClefType): { noteName: NoteName; octave: number } {
  const ref = clef === 'bass' ? CLEF_REF.bass : CLEF_REF.treble
  const stepsAboveRef = ref.step - step          // positive = above ref C
  const noteIndex = ((stepsAboveRef % 7) + 7) % 7
  const octave    = ref.octave + Math.floor(stepsAboveRef / 7)
  return { noteName: DIATONIC[noteIndex], octave }
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

export const DURATION_LABELS: Record<Duration, string> = {
  '64th':    '64th',
  '32nd':    '32nd',
  '16th':    '16th',
  'eighth':  '8th',
  'quarter': 'Quarter',
  'half':    'Half',
  'whole':   'Whole',
}
