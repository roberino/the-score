import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { midiService, type MidiInputInfo } from '../services/midiService'

interface MidiInputPanelProps {
  screenX: number
  screenY: number
  onClose: () => void
}

export function MidiInputPanel({ screenX, screenY, onClose }: MidiInputPanelProps): JSX.Element {
  const { midiInputDeviceId, setMidiInputDevice } = useAppStore()
  const [inputInfos,   setInputInfos]   = useState<MidiInputInfo[]>([])
  const [midiAvailable, setMidiAvailable] = useState(true)

  useEffect(() => {
    if (midiService.connected) {
      setInputInfos(midiService.inputInfos)
    } else {
      midiService.connect().then(ok => {
        setMidiAvailable(ok)
        setInputInfos(midiService.inputInfos)
      })
    }
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const handleOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-midi-input-panel]')) onClose()
    }
    window.addEventListener('keydown', handleKey)
    const t = setTimeout(() => window.addEventListener('mousedown', handleOutside), 0)
    return () => {
      window.removeEventListener('keydown', handleKey)
      clearTimeout(t)
      window.removeEventListener('mousedown', handleOutside)
    }
  }, [onClose])

  const handleSelect = (id: string, name: string) => {
    setMidiInputDevice(id, name)
    onClose()
  }

  const handleNone = () => {
    setMidiInputDevice(null, null)
    onClose()
  }

  return (
    <div
      data-midi-input-panel=""
      style={{
        position:  'fixed',
        left:      screenX,
        top:       screenY,
        background: '#252526',
        border:    '1px solid #444',
        borderRadius: 4,
        padding:   10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        zIndex:    1000,
        minWidth:  220,
        color:     '#d4d4d4',
        fontSize:  12,
      }}
    >
      <div style={{ fontSize: 10, color: '#777', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        MIDI Input Device
      </div>

      {!midiAvailable && (
        <div style={{ fontSize: 11, color: '#e07070' }}>Web MIDI not available</div>
      )}

      {midiAvailable && (
        <>
          <button
            onClick={handleNone}
            style={{
              display:      'block',
              width:        '100%',
              textAlign:    'left',
              padding:      '4px 8px',
              marginBottom: 2,
              fontSize:     11,
              borderRadius: 3,
              border:       'none',
              cursor:       'pointer',
              background:   midiInputDeviceId === null ? '#0e639c' : '#1e1e1e',
              color:        midiInputDeviceId === null ? '#fff'    : '#ccc',
            }}
          >
            None
          </button>

          {inputInfos.length === 0 && (
            <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>No MIDI input devices found</div>
          )}

          {inputInfos.map(info => (
            <button
              key={info.id}
              onClick={() => handleSelect(info.id, info.name)}
              style={{
                display:      'block',
                width:        '100%',
                textAlign:    'left',
                padding:      '4px 8px',
                marginBottom: 2,
                fontSize:     11,
                borderRadius: 3,
                border:       'none',
                cursor:       'pointer',
                background:   info.id === midiInputDeviceId ? '#0e639c' : '#1e1e1e',
                color:        info.id === midiInputDeviceId ? '#fff'    : '#ccc',
              }}
            >
              {info.name}
            </button>
          ))}
        </>
      )}
    </div>
  )
}
