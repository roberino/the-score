// MIDI learn function registry — no renderer/tone dependencies so it can be
// imported directly by tests without triggering the full appStore module graph.

export type MidiLearnFunctionId = 'durationCycle' | 'cursorLeft' | 'cursorRight' | 'delete' | 'dotToggle'

export interface MidiLearnBinding {
  type:    'cc' | 'note'
  channel: number
  number:  number  // CC number (for 'cc') or MIDI note number (for 'note')
}

export type MidiLearnFunctionType = 'Range' | 'Directional' | 'Trigger'

export interface MidiLearnFunctionDef {
  id:                MidiLearnFunctionId
  label:             string
  type:              MidiLearnFunctionType
  acceptsKeyBinding: boolean
}

export const MIDI_LEARN_FUNCTIONS: MidiLearnFunctionDef[] = [
  { id: 'durationCycle', label: 'Duration select', type: 'Range',       acceptsKeyBinding: false },
  { id: 'cursorLeft',    label: 'Cursor left',     type: 'Directional', acceptsKeyBinding: true  },
  { id: 'cursorRight',   label: 'Cursor right',    type: 'Directional', acceptsKeyBinding: true  },
  { id: 'delete',        label: 'Delete',          type: 'Trigger',     acceptsKeyBinding: true  },
  { id: 'dotToggle',     label: 'Dot toggle',      type: 'Trigger',     acceptsKeyBinding: true  },
]
