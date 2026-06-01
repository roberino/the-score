// Tests for MidiService — port filtering, message dispatch, and MIDI-note conversion.
//
// Each test creates a fresh MidiService instance and a mock MIDIAccess so tests
// are fully isolated from each other and from the browser environment.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MidiService, type NoteInput, type MidiControlInput } from '@renderer/services/midiService'

// ── Helpers ────────────────────────────────────────────────────────────────────

interface MockPort {
  id: string
  name: string
  onmidimessage: ((e: { data: Uint8Array }) => void) | null
}

function makeMidiAccess(ports: MockPort[]) {
  // Use the port objects themselves as map values — no spread — so the test can
  // observe mutations to the same object that wireListeners writes to.
  const inputMap = new Map(ports.map(p => [p.id, p]))
  return {
    inputs: inputMap,
    onstatechange: null as ((e: Event) => void) | null,
  }
}

/** Wires navigator.requestMIDIAccess to resolve with a given mock access object. */
function stubMidi(access: ReturnType<typeof makeMidiAccess>) {
  vi.stubGlobal('navigator', {
    requestMIDIAccess: vi.fn().mockResolvedValue(access),
  })
}

/** Fires a raw MIDI message on a mock port (simulates hardware event). */
function fireMessage(port: MockPort, data: number[]) {
  port.onmidimessage?.({ data: new Uint8Array(data) })
}

// ── wireListeners / port filtering ────────────────────────────────────────────

describe('MidiService — port filtering', () => {
  let svc:   MidiService
  let portA: MockPort
  let portB: MockPort

  beforeEach(async () => {
    svc   = new MidiService()
    portA = { id: 'a', name: 'MPKmini2',        onmidimessage: null }
    portB = { id: 'b', name: 'IAC Driver Bus 1', onmidimessage: null }
    stubMidi(makeMidiAccess([portA, portB]))
    await svc.connect()
  })

  it('null (None) silences all ports — initial state after connect', () => {
    expect(portA.onmidimessage).toBeNull()
    expect(portB.onmidimessage).toBeNull()
  })

  it('selectInput(null) silences all ports after a specific selection', () => {
    svc.selectInput('a')
    svc.selectInput(null)
    expect(portA.onmidimessage).toBeNull()
    expect(portB.onmidimessage).toBeNull()
  })

  it('selectInput(id) enables only the matching port', () => {
    svc.selectInput('a')
    expect(portA.onmidimessage).not.toBeNull()
    expect(portB.onmidimessage).toBeNull()
  })

  it('switching selection transfers the listener', () => {
    svc.selectInput('a')
    svc.selectInput('b')
    expect(portA.onmidimessage).toBeNull()
    expect(portB.onmidimessage).not.toBeNull()
  })

  it('output filter silences the named port even when it is the selected input', () => {
    svc.selectInput('a')
    svc.setOutputFilter('MPKmini2')
    // portA matches filter — silenced; portB was already silenced by selectInput
    expect(portA.onmidimessage).toBeNull()
    expect(portB.onmidimessage).toBeNull()
  })

  it('output filter with null selectInput (None): all ports remain silenced', () => {
    // Null = no device selected: all ports stay silenced regardless of the output filter.
    svc.setOutputFilter('IAC Driver Bus 1')
    expect(portA.onmidimessage).toBeNull()
    expect(portB.onmidimessage).toBeNull()
  })

  it('clearing the output filter re-enables the port when a device is selected', () => {
    svc.selectInput('b')                       // portB ('IAC Driver Bus 1') selected
    svc.setOutputFilter('IAC Driver Bus 1')    // output filter silences it
    expect(portB.onmidimessage).toBeNull()
    svc.setOutputFilter(null)                  // filter cleared — port should be active
    expect(portB.onmidimessage).not.toBeNull()
  })
})

// ── Note-on dispatch ───────────────────────────────────────────────────────────

describe('MidiService — note-on dispatch', () => {
  let svc:  MidiService
  let port: MockPort

  beforeEach(async () => {
    svc  = new MidiService()
    port = { id: 'p', name: 'TestDevice', onmidimessage: null }
    stubMidi(makeMidiAccess([port]))
    await svc.connect()
    svc.selectInput('p')
  })

  it('dispatches note-on to subscribed handlers', () => {
    const received: NoteInput[] = []
    svc.subscribe(n => received.push(n))
    fireMessage(port, [0x90, 60, 80]) // note-on C4 vel=80
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ noteName: 'C', octave: 4, velocity: 80, source: 'midi' })
  })

  it('ignores note-on with velocity 0 (note-off convention)', () => {
    const received: NoteInput[] = []
    svc.subscribe(n => received.push(n))
    fireMessage(port, [0x90, 60, 0])
    expect(received).toHaveLength(0)
  })

  it('ignores actual note-off messages (0x80)', () => {
    const received: NoteInput[] = []
    svc.subscribe(n => received.push(n))
    fireMessage(port, [0x80, 60, 64])
    expect(received).toHaveLength(0)
  })

  it('does not dispatch when the port is silenced by selectInput', () => {
    const received: NoteInput[] = []
    svc.subscribe(n => received.push(n))
    svc.selectInput('other-port') // silences 'p'
    // port.onmidimessage was set to null — no delivery path
    fireMessage(port, [0x90, 60, 80])
    expect(received).toHaveLength(0)
  })
})

// ── CC dispatch ───────────────────────────────────────────────────────────────

describe('MidiService — CC dispatch', () => {
  let svc:  MidiService
  let port: MockPort

  beforeEach(async () => {
    svc  = new MidiService()
    port = { id: 'p', name: 'TestDevice', onmidimessage: null }
    stubMidi(makeMidiAccess([port]))
    await svc.connect()
    svc.selectInput('p')
  })

  it('routes CC to control handlers, not note handlers', () => {
    const notes:    NoteInput[]          = []
    const controls: MidiControlInput[]   = []
    svc.subscribe(n => notes.push(n))
    svc.subscribeControl(c => controls.push(c))
    fireMessage(port, [0xb0, 1, 64]) // CC#1 val=64 ch=0
    expect(notes).toHaveLength(0)
    expect(controls).toHaveLength(1)
    expect(controls[0]).toMatchObject({ channel: 0, number: 1, value: 64 })
  })

  it('ignores CC with value 0', () => {
    const controls: MidiControlInput[] = []
    svc.subscribeControl(c => controls.push(c))
    fireMessage(port, [0xb0, 64, 0])
    expect(controls).toHaveLength(0)
  })
})

// ── MIDI note → NoteInput conversion ─────────────────────────────────────────

describe('MidiService — MIDI note number to NoteInput', () => {
  let svc:  MidiService
  let port: MockPort

  beforeEach(async () => {
    svc  = new MidiService()
    port = { id: 'p', name: 'TestDevice', onmidimessage: null }
    stubMidi(makeMidiAccess([port]))
    await svc.connect()
    svc.selectInput('p')
  })

  const cases: [number, { noteName: string; octave: number; accidental?: string }][] = [
    [60, { noteName: 'C', octave: 4 }],
    [61, { noteName: 'C', octave: 4, accidental: 'sharp' }],
    [62, { noteName: 'D', octave: 4 }],
    [64, { noteName: 'E', octave: 4 }],
    [65, { noteName: 'F', octave: 4 }],
    [69, { noteName: 'A', octave: 4 }],
    [71, { noteName: 'B', octave: 4 }],
    [72, { noteName: 'C', octave: 5 }],
    [48, { noteName: 'C', octave: 3 }],
    [21, { noteName: 'A', octave: 0 }],
    [108,{ noteName: 'C', octave: 8 }],
  ]

  it.each(cases)('MIDI %i → %o', (midiNote, expected) => {
    const received: NoteInput[] = []
    svc.subscribe(n => received.push(n))
    fireMessage(port, [0x90, midiNote, 64])
    expect(received[0]).toMatchObject(expected)
  })
})

// ── Subscription lifecycle ────────────────────────────────────────────────────

describe('MidiService — subscription lifecycle', () => {
  let svc:  MidiService
  let port: MockPort

  beforeEach(async () => {
    svc  = new MidiService()
    port = { id: 'p', name: 'TestDevice', onmidimessage: null }
    stubMidi(makeMidiAccess([port]))
    await svc.connect()
    svc.selectInput('p')
  })

  it('unsubscribing stops delivery', () => {
    const received: NoteInput[] = []
    const unsub = svc.subscribe(n => received.push(n))
    fireMessage(port, [0x90, 60, 80])
    unsub()
    fireMessage(port, [0x90, 62, 80])
    expect(received).toHaveLength(1)
  })

  it('multiple subscribers each receive the message', () => {
    const a: NoteInput[] = []
    const b: NoteInput[] = []
    svc.subscribe(n => a.push(n))
    svc.subscribe(n => b.push(n))
    fireMessage(port, [0x90, 60, 80])
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })
})
