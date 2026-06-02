// Tests for the MIDI learn CC-value → duration mapping.
//
// The 0–127 range is divided into 7 equal bands, one per duration.
// Fully right (127) = whole note, fully left (0) = 64th note.

import { describe, it, expect } from 'vitest'
import { ccValueToDuration } from '@shared/musicUtils'

// ── Extremes ──────────────────────────────────────────────────────────────────

describe('ccValueToDuration — extremes', () => {
  it('value 0 (fully left) → 64th', () => {
    expect(ccValueToDuration(0)).toBe('64th')
  })

  it('value 127 (fully right) → whole', () => {
    expect(ccValueToDuration(127)).toBe('whole')
  })

  it('value 64 (centre) → eighth', () => {
    expect(ccValueToDuration(64)).toBe('eighth')
  })
})

// ── Band boundaries ───────────────────────────────────────────────────────────
//
// Each pair of adjacent tests straddles a band boundary, confirming the
// transition happens at the right value.

describe('ccValueToDuration — band boundaries', () => {
  it('value 17 → 64th  (top of 64th band)', () => {
    expect(ccValueToDuration(17)).toBe('64th')
  })

  it('value 18 → 32nd  (bottom of 32nd band)', () => {
    expect(ccValueToDuration(18)).toBe('32nd')
  })

  it('value 35 → 32nd  (top of 32nd band)', () => {
    expect(ccValueToDuration(35)).toBe('32nd')
  })

  it('value 36 → 16th  (bottom of 16th band)', () => {
    expect(ccValueToDuration(36)).toBe('16th')
  })

  it('value 53 → 16th  (top of 16th band)', () => {
    expect(ccValueToDuration(53)).toBe('16th')
  })

  it('value 54 → eighth  (bottom of eighth band)', () => {
    expect(ccValueToDuration(54)).toBe('eighth')
  })

  it('value 72 → eighth  (top of eighth band)', () => {
    expect(ccValueToDuration(72)).toBe('eighth')
  })

  it('value 73 → quarter  (bottom of quarter band)', () => {
    expect(ccValueToDuration(73)).toBe('quarter')
  })

  it('value 90 → quarter  (top of quarter band)', () => {
    expect(ccValueToDuration(90)).toBe('quarter')
  })

  it('value 91 → half  (bottom of half band)', () => {
    expect(ccValueToDuration(91)).toBe('half')
  })

  it('value 108 → half  (top of half band)', () => {
    expect(ccValueToDuration(108)).toBe('half')
  })

  it('value 109 → whole  (bottom of whole band)', () => {
    expect(ccValueToDuration(109)).toBe('whole')
  })
})

// ── All 7 durations are reachable ─────────────────────────────────────────────

describe('ccValueToDuration — full coverage', () => {
  it('every duration is produced by some CC value', () => {
    const durations = new Set(
      Array.from({ length: 128 }, (_, v) => ccValueToDuration(v))
    )
    expect([...durations].sort()).toEqual(['16th', '32nd', '64th', 'eighth', 'half', 'quarter', 'whole'].sort())
  })

  it('direction is monotone: higher CC value never produces a shorter duration', () => {
    const order = ['64th', '32nd', '16th', 'eighth', 'quarter', 'half', 'whole']
    let prevRank = -1
    for (let v = 0; v <= 127; v++) {
      const rank = order.indexOf(ccValueToDuration(v))
      expect(rank).toBeGreaterThanOrEqual(prevRank)
      prevRank = rank
    }
  })
})
