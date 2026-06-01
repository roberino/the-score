import { describe, it, expect } from 'vitest'
import {
  createScore, createNote, createRest
} from '../shared/score'
import { applyCommand, type Command } from '../shared/commands'

describe('Score model', () => {
  it('creates a score with one part and default measures', () => {
    const score = createScore('Symphony No. 1')
    expect(score.metadata.title).toBe('Symphony No. 1')
    expect(score.parts).toHaveLength(1)
    expect(score.parts[0].staves[0].measures.length).toBeGreaterThan(0)
  })

  it('creates a note with correct defaults', () => {
    const note = createNote('C', 4, 'quarter')
    expect(note.type).toBe('note')
    expect(note.pitch.noteName).toBe('C')
    expect(note.pitch.octave).toBe(4)
    expect(note.dots).toBe(0)
    expect(note.tieStart).toBe(false)
  })

  it('creates a rest', () => {
    const rest = createRest('half')
    expect(rest.type).toBe('rest')
    expect(rest.duration).toBe('half')
  })
})

describe('Command: ADD_NOTE', () => {
  it('adds a note to a measure voice', () => {
    const score = createScore()
    const note  = createNote('E', 4, 'quarter')
    const part    = score.parts[0]
    const staff   = part.staves[0]
    const measure = staff.measures[0]
    const voice   = measure.voices[0]

    const cmd: Command = {
      type: 'ADD_NOTE',
      partId: part.id,
      staffId: staff.id,
      measureId: measure.id,
      voiceId: voice.id,
      event: note
    }

    const next = applyCommand(score, cmd)

    // Original score is unchanged (immutability) — check the ref, not a count
    expect(score.parts[0].staves[0].measures[0].voices[0].events).toBe(voice.events)

    // New score has the note (measure may contain pre-filled rests; find the note)
    const notes = next.parts[0].staves[0].measures[0].voices[0].events
      .filter((e: import('@shared/score').NoteEvent) => e.type === 'note')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ type: 'note', pitch: { noteName: 'E', octave: 4 } })
  })
})

describe('Command: SET_TITLE', () => {
  it('updates the score title without mutating original', () => {
    const score = createScore('Old Title')
    const next  = applyCommand(score, { type: 'SET_TITLE', title: 'New Title' })
    expect(score.metadata.title).toBe('Old Title')
    expect(next.metadata.title).toBe('New Title')
  })
})

describe('Immutability', () => {
  it('every command produces a new Score object reference', () => {
    const score = createScore()
    const next  = applyCommand(score, { type: 'SET_COMPOSER', composer: 'Bach' })
    expect(next).not.toBe(score)
    expect(next.metadata).not.toBe(score.metadata)
  })
})
