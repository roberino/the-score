// Tests for pure coordinate helpers in PerformanceView.
// measureIndexFromClickX maps a click x-offset within a track canvas cell
// to a 0-based measure index, clamped to [0, totalMeasures - 1].

import { describe, it, expect } from 'vitest'
import { measureIndexFromClickX } from '@shared/performanceViewUtils'

const MW = 88   // MEASURE_W constant used in the component

describe('measureIndexFromClickX', () => {
  it('click at x=0 → measure 0', () => {
    expect(measureIndexFromClickX(0, MW, 8)).toBe(0)
  })

  it('click at left edge of measure 1 → measure 1', () => {
    expect(measureIndexFromClickX(MW, MW, 8)).toBe(1)
  })

  it('click in the middle of measure 3 → measure 3', () => {
    expect(measureIndexFromClickX(3 * MW + 40, MW, 8)).toBe(3)
  })

  it('click at right edge of last measure → last measure index', () => {
    expect(measureIndexFromClickX(7 * MW + MW - 1, MW, 8)).toBe(7)
  })

  it('click exactly at a barline belongs to the next measure', () => {
    // floor(2 * MW / MW) = 2
    expect(measureIndexFromClickX(2 * MW, MW, 8)).toBe(2)
  })

  it('negative offset clamped to 0', () => {
    expect(measureIndexFromClickX(-10, MW, 8)).toBe(0)
  })

  it('offset beyond canvas width clamped to last measure', () => {
    expect(measureIndexFromClickX(100 * MW, MW, 8)).toBe(7)
  })

  it('single-measure score: any click → measure 0', () => {
    expect(measureIndexFromClickX(50, MW, 1)).toBe(0)
    expect(measureIndexFromClickX(200, MW, 1)).toBe(0)
  })

  it('fractional click within measure rounds down', () => {
    // 1.9 * MW → floor = 1
    expect(measureIndexFromClickX(Math.round(1.9 * MW), MW, 8)).toBe(1)
  })

  it('works with different measure widths', () => {
    const w = 120
    expect(measureIndexFromClickX(250, w, 10)).toBe(2)  // floor(250/120) = 2
    expect(measureIndexFromClickX(360, w, 10)).toBe(3)  // floor(360/120) = 3
  })
})
