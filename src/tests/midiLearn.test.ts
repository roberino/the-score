// Tests for MIDI learn:
//   CC-value → duration mapping (range control)
//   Key-binding eligibility (acceptsKeyBinding flag per function)
//   Note-input blocking logic for bound keys

import { describe, it, expect } from 'vitest'
import { ccValueToDuration } from '@shared/musicUtils'
import { MIDI_LEARN_FUNCTIONS } from '@renderer/store/midiLearnDefs'
import { noteInputToMidi } from '@renderer/services/midiService'
import type { NoteInput } from '@renderer/services/midiService'
import type { MidiLearnBinding } from '@renderer/store/midiLearnDefs'

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

// ── Key-binding eligibility ───────────────────────────────────────────────────

describe('MIDI_LEARN_FUNCTIONS — acceptsKeyBinding flag', () => {
  it('durationCycle does not accept key bindings (Range type)', () => {
    const fn = MIDI_LEARN_FUNCTIONS.find(f => f.id === 'durationCycle')!
    expect(fn.acceptsKeyBinding).toBe(false)
  })

  it('cursorLeft accepts key bindings (Directional type)', () => {
    expect(MIDI_LEARN_FUNCTIONS.find(f => f.id === 'cursorLeft')!.acceptsKeyBinding).toBe(true)
  })

  it('cursorRight accepts key bindings (Directional type)', () => {
    expect(MIDI_LEARN_FUNCTIONS.find(f => f.id === 'cursorRight')!.acceptsKeyBinding).toBe(true)
  })

  it('delete accepts key bindings (Trigger type)', () => {
    expect(MIDI_LEARN_FUNCTIONS.find(f => f.id === 'delete')!.acceptsKeyBinding).toBe(true)
  })

  it('dotToggle accepts key bindings (Trigger type)', () => {
    expect(MIDI_LEARN_FUNCTIONS.find(f => f.id === 'dotToggle')!.acceptsKeyBinding).toBe(true)
  })

  it('all Trigger and Directional functions accept key bindings', () => {
    const nonRange = MIDI_LEARN_FUNCTIONS.filter(f => f.type !== 'Range')
    expect(nonRange.every(f => f.acceptsKeyBinding)).toBe(true)
  })

  it('all Range functions reject key bindings', () => {
    const range = MIDI_LEARN_FUNCTIONS.filter(f => f.type === 'Range')
    expect(range.every(f => !f.acceptsKeyBinding)).toBe(true)
  })
})

// ── Key-binding blocking logic ────────────────────────────────────────────────

describe('Key-binding blocking — note-input guard', () => {
  function isBound(
    input: NoteInput,
    bindings: Partial<Record<string, MidiLearnBinding>>,
  ): boolean {
    const midiNote = noteInputToMidi(input)
    const channel  = input.channel ?? 0
    return Object.values(bindings).some(
      b => b?.type === 'note' && b.number === midiNote && b.channel === channel,
    )
  }

  const C4: NoteInput = { noteName: 'C', octave: 4, velocity: 80, channel: 0 }
  const D4: NoteInput = { noteName: 'D', octave: 4, velocity: 80, channel: 0 }

  it('blocks a note that is bound to a function on the same channel', () => {
    const bindings = { delete: { type: 'note' as const, channel: 0, number: 60 } }
    expect(isBound(C4, bindings)).toBe(true)
  })

  it('passes through a note that is not bound', () => {
    const bindings = { delete: { type: 'note' as const, channel: 0, number: 60 } }
    expect(isBound(D4, bindings)).toBe(false)
  })

  it('passes through when the binding is CC type (not a key binding)', () => {
    const bindings = { delete: { type: 'cc' as const, channel: 0, number: 60 } }
    expect(isBound(C4, bindings)).toBe(false)
  })

  it('passes through when the channel does not match', () => {
    const bindings = { delete: { type: 'note' as const, channel: 1, number: 60 } }
    const inputCh0: NoteInput = { ...C4, channel: 0 }
    expect(isBound(inputCh0, bindings)).toBe(false)
  })

  it('blocks when multiple functions have bindings and one matches', () => {
    const bindings = {
      delete:    { type: 'note' as const, channel: 0, number: 62 },
      dotToggle: { type: 'note' as const, channel: 0, number: 60 },
    }
    expect(isBound(C4, bindings)).toBe(true)
    expect(isBound(D4, bindings)).toBe(true)
  })

  it('empty bindings: nothing is blocked', () => {
    expect(isBound(C4, {})).toBe(false)
  })
})
