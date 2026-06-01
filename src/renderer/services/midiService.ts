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
  source?:     'midi' | 'keyboard'
}

export interface MidiInputInfo {
  id:   string
  name: string
}

export type NoteInputHandler = (input: NoteInput) => void

export interface MidiControlInput {
  channel: number
  number:  number   // CC number
  value:   number   // 0–127
}

export type MidiControlHandler = (input: MidiControlInput) => void

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
  return { noteName, octave, ...(accidental ? { accidental } : {}), velocity, source: 'midi' }
}

export class MidiService {
  private access:          MIDIAccess | null = null
  private handlers:        Set<NoteInputHandler> = new Set()
  private controlHandlers: Set<MidiControlHandler> = new Set()
  private _connected       = false
  private _outputFilter:   string | null = null
  private _selectedInputId: string | null = null
  private _disconnectCb:   ((portId: string) => void) | null = null

  get connected(): boolean { return this._connected }

  get inputNames(): string[] {
    if (!this.access) return []
    return Array.from(this.access.inputs.values()).map(i => i.name ?? 'Unknown')
  }

  get inputInfos(): MidiInputInfo[] {
    if (!this.access) return []
    return Array.from(this.access.inputs.values()).map(i => ({
      id:   i.id,
      name: i.name ?? 'Unknown',
    }))
  }

  // Restrict input to a single port; pass null to silence all ports (no device selected).
  selectInput(portId: string | null): void {
    this._selectedInputId = portId
    this.wireListeners()
  }

  // Register a callback that fires when the selected port disappears.
  onInputDisconnected(cb: ((portId: string) => void) | null): void {
    this._disconnectCb = cb
  }

  // Call this whenever the active MIDI output changes so the loopback
  // port is excluded from input listeners (prevents IAC Driver feedback).
  setOutputFilter(portName: string | null): void {
    this._outputFilter = portName
    this.wireListeners()
  }

  async connect(): Promise<boolean> {
    if (this._connected) return true
    if (!navigator.requestMIDIAccess) return false
    try {
      this.access = await navigator.requestMIDIAccess()
      this._connected = true
      this.wireListeners()
      this.access.onstatechange = () => {
        // Detect if the currently selected port disappeared
        if (this._selectedInputId) {
          const stillExists = this.access?.inputs.has(this._selectedInputId)
          if (!stillExists && this._disconnectCb) {
            const id = this._selectedInputId
            this._selectedInputId = null
            this._disconnectCb(id)
          }
        }
        this.wireListeners()
      }
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

  subscribeControl(handler: MidiControlHandler): () => void {
    this.controlHandlers.add(handler)
    return () => this.controlHandlers.delete(handler)
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
      // null = no device selected (silence all); non-null = restrict to selected port.
      if (this._selectedInputId === null || input.id !== this._selectedInputId) {
        input.onmidimessage = null
        return
      }
      input.onmidimessage = (msg: MIDIMessageEvent) => this.handleMessage(msg)
    })
  }

  private handleMessage(msg: MIDIMessageEvent): void {
    if (!msg.data || msg.data.length < 3) return
    const [status, data1, data2] = msg.data as unknown as [number, number, number]
    const msgType = status & 0xf0
    const channel = status & 0x0f

    if (msgType === 0xb0 && data2 > 0) {
      // CC message with non-zero value
      const controlInput: MidiControlInput = { channel, number: data1, value: data2 }
      this.controlHandlers.forEach(h => h(controlInput))
      return
    }

    const isNoteOn = msgType === 0x90 && data2 > 0
    if (!isNoteOn) return
    const input = midiNoteToInput(data1, data2)
    this.handlers.forEach(h => h(input))
  }
}

export const midiService = new MidiService()
