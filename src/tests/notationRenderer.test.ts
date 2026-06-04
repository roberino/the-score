// Tests for computeDisplayAccidentals in notationRenderer.
// Verifies that natural (♮) symbols are shown whenever a stored null/natural
// accidental conflicts with the active key signature, and that redundant
// accidentals are suppressed within a measure.

import { describe, it, expect } from 'vitest'
import { computeDisplayAccidentals } from '@renderer/engine/notationRenderer'
import { createNote } from '@shared/score'
import type { Note } from '@shared/score'

// Convenience: extract the single display accidental for the first (only) pitch
// of a note event from the returned map.
function disp(map: Map<string, import('@shared/score').Accidental[]>, note: Note) {
  return map.get(note.id)?.[0] ?? null
}

describe('computeDisplayAccidentals', () => {

  // ── C major (fifths=0) — baseline ──────────────────────────────────────────

  it('C major: F with no accidental shows no symbol', () => {
    const f = createNote('F', 4, 'quarter', null)
    const result = computeDisplayAccidentals([f], 0)
    expect(disp(result, f)).toBeNull()
  })

  it('C major: F# shows sharp symbol', () => {
    const f = createNote('F', 4, 'quarter', 'sharp')
    const result = computeDisplayAccidentals([f], 0)
    expect(disp(result, f)).toBe('sharp')
  })

  // ── G major (fifths=1, F is sharped) ───────────────────────────────────────

  it('G major: F with null accidental shows natural symbol', () => {
    const f = createNote('F', 4, 'quarter', null)
    const result = computeDisplayAccidentals([f], 1)
    expect(disp(result, f)).toBe('natural')
  })

  it('G major: F with explicit natural shows natural symbol', () => {
    const f = createNote('F', 4, 'quarter', 'natural')
    const result = computeDisplayAccidentals([f], 1)
    expect(disp(result, f)).toBe('natural')
  })

  it('G major: F# (explicit sharp) shows no symbol — covered by key sig', () => {
    const f = createNote('F', 4, 'quarter', 'sharp')
    const result = computeDisplayAccidentals([f], 1)
    expect(disp(result, f)).toBeNull()
  })

  it('G major: non-sharped note (G with null) shows no symbol', () => {
    const g = createNote('G', 4, 'quarter', null)
    const result = computeDisplayAccidentals([g], 1)
    expect(disp(result, g)).toBeNull()
  })

  // ── Within-measure carry-forward ───────────────────────────────────────────

  it('G major: F natural then F natural — second F suppresses redundant ♮', () => {
    const f1 = createNote('F', 4, 'quarter', null)
    const f2 = createNote('F', 4, 'quarter', null)
    const result = computeDisplayAccidentals([f1, f2], 1)
    expect(disp(result, f1)).toBe('natural')
    expect(disp(result, f2)).toBeNull()
  })

  it('G major: F# then F natural — natural symbol shown on second note', () => {
    const fSharp = createNote('F', 4, 'quarter', 'sharp')
    const fNat   = createNote('F', 4, 'quarter', null)
    const result = computeDisplayAccidentals([fSharp, fNat], 1)
    expect(disp(result, fSharp)).toBeNull()   // key sig covers F#
    expect(disp(result, fNat)).toBe('natural')
  })

  it('G major: F natural then F# — sharp shown to return to key sig', () => {
    const fNat   = createNote('F', 4, 'quarter', null)
    const fSharp = createNote('F', 4, 'quarter', 'sharp')
    const result = computeDisplayAccidentals([fNat, fSharp], 1)
    expect(disp(result, fNat)).toBe('natural')
    expect(disp(result, fSharp)).toBe('sharp')
  })

  it('G major: F natural then F# then F natural — symbols correct throughout', () => {
    const fNat1  = createNote('F', 4, 'quarter', null)
    const fSharp = createNote('F', 4, 'quarter', 'sharp')
    const fNat2  = createNote('F', 4, 'quarter', null)
    const result = computeDisplayAccidentals([fNat1, fSharp, fNat2], 1)
    expect(disp(result, fNat1)).toBe('natural')
    expect(disp(result, fSharp)).toBe('sharp')
    expect(disp(result, fNat2)).toBe('natural')
  })

  // ── Flat key: Bb major (fifths=-2, Bb and Eb are flatted) ──────────────────

  it('Bb major: B with null accidental shows natural symbol', () => {
    const b = createNote('B', 4, 'quarter', null)
    const result = computeDisplayAccidentals([b], -2)
    expect(disp(result, b)).toBe('natural')
  })

  it('Bb major: Bb (flat stored) shows no symbol — covered by key sig', () => {
    const bb = createNote('B', 4, 'quarter', 'flat')
    const result = computeDisplayAccidentals([bb], -2)
    expect(disp(result, bb)).toBeNull()
  })

  it('Bb major: E with null shows natural, A with null shows nothing', () => {
    const e = createNote('E', 4, 'quarter', null)
    const a = createNote('A', 4, 'quarter', null)
    const result = computeDisplayAccidentals([e, a], -2)
    expect(disp(result, e)).toBe('natural')
    expect(disp(result, a)).toBeNull()
  })

  // ── Tied notes ─────────────────────────────────────────────────────────────

  it('G major: tieEnd F natural pre-seeds carry; subsequent F# shows sharp', () => {
    const tieEndF  = { ...createNote('F', 4, 'quarter', null),  tieEnd: true  }
    const fSharp   = createNote('F', 4, 'quarter', 'sharp')
    const result   = computeDisplayAccidentals([tieEndF, fSharp], 1)
    expect(disp(result, tieEndF)).toBeNull()   // tie continuation: never show symbol
    expect(disp(result, fSharp)).toBe('sharp') // returning to key sig from natural carry
  })

  it('G major: tieEnd F natural pre-seeds carry; subsequent F natural suppressed', () => {
    const tieEndF = { ...createNote('F', 4, 'quarter', null), tieEnd: true }
    const fNat    = createNote('F', 4, 'quarter', null)
    const result  = computeDisplayAccidentals([tieEndF, fNat], 1)
    expect(disp(result, tieEndF)).toBeNull()  // tie continuation
    expect(disp(result, fNat)).toBeNull()     // carry already shows natural
  })

  // ── Different octaves are independent ──────────────────────────────────────

  it('G major: F4 natural carry does not affect F5', () => {
    const f4 = createNote('F', 4, 'quarter', null)
    const f5 = createNote('F', 5, 'quarter', null)
    const result = computeDisplayAccidentals([f4, f5], 1)
    expect(disp(result, f4)).toBe('natural')
    expect(disp(result, f5)).toBe('natural')  // independent carry per octave
  })
})
