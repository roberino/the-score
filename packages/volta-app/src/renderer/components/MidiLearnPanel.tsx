import { useEffect, useRef, useState } from 'react'
import { useAppStore, MIDI_LEARN_FUNCTIONS } from '../store/appStore'
import type { MidiLearnFunctionId } from '../store/appStore'

function formatBinding(b: { type: string; channel: number; number: number }) {
  return b.type === 'cc'
    ? `CC ${b.number}, Ch ${b.channel + 1}`
    : `Note ${b.number}, Ch ${b.channel + 1}`
}

const TYPE_COLOURS: Record<string, string> = {
  Range:       '#1a4a6e',
  Directional: '#3a3a1a',
  Trigger:     '#2a1a3a',
}

interface MidiLearnPanelProps {
  screenX: number
  screenY: number
  onClose: () => void
}

export function MidiLearnPanel({ screenX, screenY, onClose }: MidiLearnPanelProps): JSX.Element {
  const {
    midiLearnListening,
    midiLearnBindings,
    midiLearnErrors,
    startMidiLearnListening,
    stopMidiLearnListening,
    setMidiLearnBinding,
    setMidiLearnError,
  } = useAppStore()

  // Pulse animation for listening rows
  const [pulse, setPulse] = useState(false)
  useEffect(() => {
    if (!midiLearnListening) { setPulse(false); return }
    const t = setInterval(() => setPulse(v => !v), 500)
    return () => clearInterval(t)
  }, [midiLearnListening])

  // Auto-clear per-row errors after 4 s
  const errorTimers = useRef<Partial<Record<MidiLearnFunctionId, ReturnType<typeof setTimeout>>>>({})
  useEffect(() => {
    for (const fn of MIDI_LEARN_FUNCTIONS) {
      const msg = midiLearnErrors[fn.id]
      if (msg) {
        if (errorTimers.current[fn.id]) clearTimeout(errorTimers.current[fn.id])
        errorTimers.current[fn.id] = setTimeout(() => setMidiLearnError(fn.id, null), 4000)
      }
    }
  }, [midiLearnErrors, setMidiLearnError])

  // Close on Escape or outside click
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const handleOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-midi-learn-panel]')) onClose()
    }
    window.addEventListener('keydown', handleKey)
    const t = setTimeout(() => window.addEventListener('mousedown', handleOutside), 0)
    return () => {
      window.removeEventListener('keydown', handleKey)
      clearTimeout(t)
      window.removeEventListener('mousedown', handleOutside)
    }
  }, [onClose])

  const handleLearnClick = (fnId: MidiLearnFunctionId) => {
    if (midiLearnListening === fnId) {
      stopMidiLearnListening()
    } else {
      // Cancels any current listener first (startMidiLearnListening replaces the value)
      startMidiLearnListening(fnId)
    }
  }

  const handleClear = (fnId: MidiLearnFunctionId) => {
    setMidiLearnBinding(fnId, null)
  }

  return (
    <div
      data-midi-learn-panel=""
      style={{
        position:     'fixed',
        left:         screenX,
        top:          screenY,
        background:   '#252526',
        border:       '1px solid #444',
        borderRadius: 4,
        boxShadow:    '0 4px 16px rgba(0,0,0,0.5)',
        zIndex:       1000,
        minWidth:     340,
        color:        '#d4d4d4',
        fontSize:     12,
      }}
    >
      {/* Header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '8px 10px 6px',
        borderBottom:   '1px solid #333',
      }}>
        <span style={{ fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          MIDI Learn
        </span>
        <button
          onClick={onClose}
          title="Close"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#777', fontSize: 14, lineHeight: 1, padding: '0 2px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Function rows */}
      <div style={{ padding: '6px 0' }}>
        {MIDI_LEARN_FUNCTIONS.map(fn => {
          const binding    = midiLearnBindings[fn.id]
          const isListening = midiLearnListening === fn.id
          const isAssigned  = !!binding && !isListening
          const error       = midiLearnErrors[fn.id]

          return (
            <div key={fn.id} style={{ padding: '5px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Function name */}
                <span style={{ flex: 1, color: '#d4d4d4' }}>{fn.label}</span>

                {/* Type badge */}
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 3,
                  background: TYPE_COLOURS[fn.type] ?? '#333',
                  color: '#aac',
                  textTransform: 'uppercase', letterSpacing: 0.3,
                }}>
                  {fn.type}
                </span>

                {/* Binding / status */}
                <span style={{
                  minWidth: 90, textAlign: 'right', fontSize: 11,
                  color: isListening
                    ? (pulse ? '#7ec8e3' : '#5aa8c3')
                    : isAssigned ? '#7ec8e3' : '#555',
                }}>
                  {isListening ? 'Listening…' : isAssigned ? formatBinding(binding!) : 'Unassigned'}
                </span>

                {/* Learn / Cancel / Clear button */}
                <button
                  onClick={() => isAssigned ? handleClear(fn.id) : handleLearnClick(fn.id)}
                  title={
                    isListening ? 'Cancel'
                    : isAssigned ? 'Clear binding'
                    : 'Learn: click then move a control'
                  }
                  style={{
                    padding: '2px 8px', fontSize: 11, borderRadius: 3, border: 'none',
                    cursor: 'pointer', minWidth: 52,
                    background: isListening
                      ? (pulse ? '#1a4a6e' : '#0e4060')
                      : isAssigned ? '#3a1a1a'
                      : '#1e1e1e',
                    color: isListening ? '#7ec8e3' : isAssigned ? '#e07070' : '#9d9d9d',
                    transition: isListening ? 'none' : 'background 0.1s',
                  }}
                >
                  {isListening ? 'Cancel' : isAssigned ? 'Clear' : 'Learn'}
                </button>
              </div>

              {/* Inline error */}
              {error && (
                <div style={{ marginTop: 4, fontSize: 10, color: '#e07070', paddingLeft: 2 }}>
                  {error}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
