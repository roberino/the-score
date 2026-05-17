// ─────────────────────────────────────────────────────────────────────────────
// MIDI input service — Web MIDI API
//
// Singleton. Connects to all available MIDI input ports and forwards Note-On
// messages to registered NoteInputHandler callbacks.
// Both virtual keyboard and external MIDI devices share the same NoteInput type.
// ─────────────────────────────────────────────────────────────────────────────

import type { NoteName } from '@shared/score'

export interface NoteInput {
  noteName:    NoteName
  octave:      number
  accidental?: 'sharp' | 'flat' | 'natural'
  velocity:    number   // 0–127
}

export type NoteInputHandler = (input: NoteInput) => void

// Chromatic MIDI note → noteName + optional sharp accidental
const CHROMATIC: { noteName: NoteName; accidental?: 'sharp' }[] = [
  { noteName: 'C' },
  { noteName: 'C', accidental: 'sharp' },
  { noteName: 'D' },
  { noteName: 'D', accidental: 'sharp' },
  { noteName: 'E' },
  { noteName: 'F' },
  { noteName: 'F', accidental: 'sharp' },
  { noteName: 'G' },
  { noteName: 'G', accidental: 'sharp' },
  { noteName: 'A' },
  { noteName: 'A', accidental: 'sharp' },
  { noteName: 'B' },
]

function midiNoteToInput(midiNote: number, velocity: number): NoteInput {
  const octave       = Math.floor(midiNote / 12) - 1
  const noteInOctave = midiNote % 12
  const { noteName, accidental } = CHROMATIC[noteInOctave] ?? { noteName: 'C' }
  return { noteName, octave, ...(accidental ? { accidental } : {}), velocity }
}

class MidiService {
  private access:        MIDIAccess | null = null
  private handlers:      Set<NoteInputHandler> = new Set()
  private _connected     = false
  private _outputFilter: string | null = null

  get connected(): boolean { return this._connected }

  get inputNames(): string[] {
    if (!this.access) return []
    return Array.from(this.access.inputs.values()).map(i => i.name ?? 'Unknown')
  }

  // Call this whenever the active MIDI output changes so the loopback
  // port is excluded from input listeners (prevents IAC Driver feedback).
  setOutputFilter(portName: string | null): void {
    this._outputFilter = portName
    this.wireListeners()
  }

  async connect(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) return false
    try {
      this.access = await navigator.requestMIDIAccess()
      this._connected = true
      this.wireListeners()
      this.access.onstatechange = () => this.wireListeners()
      return true
    } catch {
      return false
    }
  }

  disconnect(): void {
    if (this.access) {
      this.access.inputs.forEach(input => { input.onmidimessage = null })
    }
    this.access     = null
    this._connected = false
  }

  subscribe(handler: NoteInputHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  private wireListeners(): void {
    this.access?.inputs.forEach(input => {
      // Skip the port whose name matches the active output — on virtual buses
      // like IAC Driver, input and output share the same name and any note
      // sent to the output immediately loops back as input.
      if (this._outputFilter && input.name === this._outputFilter) {
        input.onmidimessage = null
        return
      }
      input.onmidimessage = (msg: MIDIMessageEvent) => this.handleMessage(msg)
    })
  }

  private handleMessage(msg: MIDIMessageEvent): void {
    if (!msg.data || msg.data.length < 3) return
    const [status, note, velocity] = msg.data as unknown as [number, number, number]
    const isNoteOn = (status & 0xf0) === 0x90 && velocity > 0
    if (!isNoteOn) return
    const input = midiNoteToInput(note, velocity)
    this.handlers.forEach(h => h(input))
  }
}

export const midiService = new MidiService()
