import type { TabConfig } from './score'

// ── MIDI helpers ──────────────────────────────────────────────────────────────

const NOTE_SEMITONES: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}

export function pitchToMidi(
  noteName: string,
  octave: number,
  accidental: string | null | undefined,
): number {
  const base  = NOTE_SEMITONES[noteName] ?? 0
  const alter = accidental === 'sharp'       ?  1
              : accidental === 'flat'        ? -1
              : accidental === 'doubleSharp' ?  2
              : accidental === 'doubleFlat'  ? -2
              : 0
  return (octave + 1) * 12 + base + alter
}

// ── Tab position ──────────────────────────────────────────────────────────────

export interface TabPosition {
  string: number  // 1-based, VexFlow convention: 1 = highest/thinnest string
  fret:   number  // 0 = open string
}

function tabCandidates(concertMidi: number, config: TabConfig, excluded: Set<number>): TabPosition[] {
  const { openStrings, fretCount, stringCount } = config
  const out: TabPosition[] = []
  for (let s = 0; s < stringCount; s++) {
    const vexStr = stringCount - s   // 0-based array → 1-based VexFlow (1 = highest)
    if (excluded.has(vexStr)) continue
    const fret = concertMidi - openStrings[s]
    if (fret >= 0 && fret <= fretCount) out.push({ string: vexStr, fret })
  }
  return out
}

function bestCandidate(candidates: TabPosition[]): TabPosition | null {
  if (!candidates.length) return null
  candidates.sort((a, b) => {
    const aOpen = a.fret <= 7 ? 0 : 1
    const bOpen = b.fret <= 7 ? 0 : 1
    if (aOpen !== bOpen) return aOpen - bOpen
    if (a.fret !== b.fret) return a.fret - b.fret
    return b.string - a.string   // prefer thicker string when frets tie
  })
  return candidates[0]
}

/**
 * Map a concert-pitch MIDI note to the best (string, fret) position on the
 * given instrument. Returns null when no valid position exists.
 */
export function pitchToTabPosition(concertMidi: number, config: TabConfig): TabPosition | null {
  return bestCandidate(tabCandidates(concertMidi, config, new Set()))
}

/**
 * Map an array of concert-pitch MIDI notes (a chord) to tab positions,
 * assigning each note to a different string.  Uses a greedy low-to-high pass.
 * Returns null for notes that cannot be placed on any remaining string.
 */
export function chordToTabPositions(concertMidis: number[], config: TabConfig): (TabPosition | null)[] {
  const sorted   = concertMidis.map((m, i) => ({ m, i })).sort((a, b) => a.m - b.m)
  const used     = new Set<number>()
  const result: (TabPosition | null)[] = new Array(concertMidis.length).fill(null)

  for (const { m, i } of sorted) {
    const pos = bestCandidate(tabCandidates(m, config, used))
    if (pos) {
      result[i] = pos
      used.add(pos.string)
    }
  }
  return result
}
