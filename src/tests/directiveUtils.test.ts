// Guards against the dynamics tab being dropped from DirectivePicker.
// The bug: the 'dynamic' tab was absent from buildDirectiveTabs, making
// ppp–fff presets unreachable. These tests enforce the contract.

import { describe, it, expect } from 'vitest'
import { DYNAMICS, buildDirectiveTabs, defaultDirectiveTab } from '@shared/directiveUtils'

// ── DYNAMICS constant ─────────────────────────────────────────────────────────

describe('DYNAMICS', () => {
  it('contains exactly 8 levels', () => {
    expect(DYNAMICS).toHaveLength(8)
  })

  it('contains all standard dynamic markings in soft-to-loud order', () => {
    expect([...DYNAMICS]).toEqual(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'])
  })
})

// ── buildDirectiveTabs ────────────────────────────────────────────────────────

describe('buildDirectiveTabs', () => {
  it('always includes the dynamic tab', () => {
    expect(buildDirectiveTabs(true).map(t => t.id)).toContain('dynamic')
    expect(buildDirectiveTabs(false).map(t => t.id)).toContain('dynamic')
  })

  it('always includes the expression tab', () => {
    expect(buildDirectiveTabs(true).map(t => t.id)).toContain('expression')
    expect(buildDirectiveTabs(false).map(t => t.id)).toContain('expression')
  })

  it('includes tempo tab when showTempo=true', () => {
    expect(buildDirectiveTabs(true).map(t => t.id)).toContain('tempo')
  })

  it('omits tempo tab when showTempo=false', () => {
    expect(buildDirectiveTabs(false).map(t => t.id)).not.toContain('tempo')
  })

  it('tempo appears before dynamic when present', () => {
    const ids = buildDirectiveTabs(true).map(t => t.id)
    expect(ids.indexOf('tempo')).toBeLessThan(ids.indexOf('dynamic'))
  })

  it('dynamic appears before expression', () => {
    const ids = buildDirectiveTabs(false).map(t => t.id)
    expect(ids.indexOf('dynamic')).toBeLessThan(ids.indexOf('expression'))
  })

  it('returns 3 tabs when showTempo=true', () => {
    expect(buildDirectiveTabs(true)).toHaveLength(3)
  })

  it('returns 2 tabs when showTempo=false', () => {
    expect(buildDirectiveTabs(false)).toHaveLength(2)
  })

  it('each tab has a non-empty label', () => {
    for (const tab of buildDirectiveTabs(true)) {
      expect(tab.label.length).toBeGreaterThan(0)
    }
  })
})

// ── defaultDirectiveTab ───────────────────────────────────────────────────────

describe('defaultDirectiveTab', () => {
  it('defaults to tempo when showTempo=true', () => {
    expect(defaultDirectiveTab(true)).toBe('tempo')
  })

  it('defaults to dynamic (not expression) when showTempo=false', () => {
    expect(defaultDirectiveTab(false)).toBe('dynamic')
  })
})
