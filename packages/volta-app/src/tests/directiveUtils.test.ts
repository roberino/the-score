// Guards the DirectivePicker tab structure.
// Dynamics are intentionally absent from the marks menu (use select menu instead).

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
  it('always includes the expression tab', () => {
    expect(buildDirectiveTabs(true).map(t => t.id)).toContain('expression')
    expect(buildDirectiveTabs(false).map(t => t.id)).toContain('expression')
  })

  it('does not include the dynamic tab (dynamics are in the select menu only)', () => {
    expect(buildDirectiveTabs(true).map(t => t.id)).not.toContain('dynamic')
    expect(buildDirectiveTabs(false).map(t => t.id)).not.toContain('dynamic')
  })

  it('includes tempo tab when showTempo=true', () => {
    expect(buildDirectiveTabs(true).map(t => t.id)).toContain('tempo')
  })

  it('omits tempo tab when showTempo=false', () => {
    expect(buildDirectiveTabs(false).map(t => t.id)).not.toContain('tempo')
  })

  it('tempo appears before expression when present', () => {
    const ids = buildDirectiveTabs(true).map(t => t.id)
    expect(ids.indexOf('tempo')).toBeLessThan(ids.indexOf('expression'))
  })

  it('returns 2 tabs when showTempo=true', () => {
    expect(buildDirectiveTabs(true)).toHaveLength(2)
  })

  it('returns 1 tab when showTempo=false', () => {
    expect(buildDirectiveTabs(false)).toHaveLength(1)
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

  it('defaults to expression when showTempo=false', () => {
    expect(defaultDirectiveTab(false)).toBe('expression')
  })
})
