import type { Pitch, NoteheadType } from './score'

export interface DrumInstrument {
  midiNote:     number
  name:         string
  pitch:        Pitch
  noteheadType: NoteheadType
}

export const DRUM_MAP: DrumInstrument[] = [
  { midiNote: 35, name: 'Bass Drum 2',    pitch: { noteName: 'B', octave: 1, accidental: null },      noteheadType: 'normal' },
  { midiNote: 36, name: 'Bass Drum 1',    pitch: { noteName: 'C', octave: 2, accidental: null },      noteheadType: 'normal' },
  { midiNote: 37, name: 'Side Stick',     pitch: { noteName: 'C', octave: 3, accidental: 'sharp' },   noteheadType: 'x' },
  { midiNote: 38, name: 'Acoustic Snare', pitch: { noteName: 'D', octave: 3, accidental: null },      noteheadType: 'normal' },
  { midiNote: 39, name: 'Hand Clap',      pitch: { noteName: 'D', octave: 4, accidental: 'sharp' },   noteheadType: 'x' },
  { midiNote: 40, name: 'Electric Snare', pitch: { noteName: 'E', octave: 3, accidental: null },      noteheadType: 'normal' },
  { midiNote: 41, name: 'Low Floor Tom',  pitch: { noteName: 'F', octave: 2, accidental: null },      noteheadType: 'normal' },
  { midiNote: 42, name: 'Closed Hi-Hat',  pitch: { noteName: 'F', octave: 4, accidental: 'sharp' },   noteheadType: 'x' },
  { midiNote: 43, name: 'High Floor Tom', pitch: { noteName: 'G', octave: 2, accidental: null },      noteheadType: 'normal' },
  { midiNote: 44, name: 'Pedal Hi-Hat',   pitch: { noteName: 'A', octave: 4, accidental: null },      noteheadType: 'x' },
  { midiNote: 45, name: 'Low Tom',        pitch: { noteName: 'A', octave: 2, accidental: null },      noteheadType: 'normal' },
  { midiNote: 46, name: 'Open Hi-Hat',    pitch: { noteName: 'B', octave: 4, accidental: null },      noteheadType: 'circle-x' },
  { midiNote: 47, name: 'Low-Mid Tom',    pitch: { noteName: 'B', octave: 2, accidental: null },      noteheadType: 'normal' },
  { midiNote: 48, name: 'Hi-Mid Tom',     pitch: { noteName: 'C', octave: 3, accidental: null },      noteheadType: 'normal' },
  { midiNote: 49, name: 'Crash Cymbal 1', pitch: { noteName: 'A', octave: 5, accidental: null },      noteheadType: 'x' },
  { midiNote: 50, name: 'High Tom',       pitch: { noteName: 'D', octave: 3, accidental: null },      noteheadType: 'normal' },
  { midiNote: 51, name: 'Ride Cymbal 1',  pitch: { noteName: 'E', octave: 5, accidental: null },      noteheadType: 'x' },
  { midiNote: 52, name: 'Chinese Cymbal', pitch: { noteName: 'F', octave: 5, accidental: null },      noteheadType: 'x' },
  { midiNote: 53, name: 'Ride Bell',      pitch: { noteName: 'F', octave: 5, accidental: 'sharp' },   noteheadType: 'diamond' },
  { midiNote: 54, name: 'Tambourine',     pitch: { noteName: 'G', octave: 5, accidental: null },      noteheadType: 'x' },
  { midiNote: 55, name: 'Splash Cymbal',  pitch: { noteName: 'G', octave: 5, accidental: 'sharp' },   noteheadType: 'x' },
  { midiNote: 56, name: 'Cowbell',        pitch: { noteName: 'A', octave: 5, accidental: null },      noteheadType: 'triangle' },
  { midiNote: 57, name: 'Crash Cymbal 2', pitch: { noteName: 'A', octave: 5, accidental: 'sharp' },   noteheadType: 'x' },
  { midiNote: 59, name: 'Ride Cymbal 2',  pitch: { noteName: 'B', octave: 5, accidental: null },      noteheadType: 'x' },
]

export function pitchKey(p: Pitch): string {
  return `${p.noteName}${p.octave}${p.accidental ?? ''}`
}

export const DRUM_MAP_BY_MIDI  = new Map(DRUM_MAP.map(d => [d.midiNote, d]))
export const DRUM_MAP_BY_PITCH = new Map(DRUM_MAP.map(d => [pitchKey(d.pitch), d]))
