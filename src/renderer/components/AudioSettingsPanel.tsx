import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { midiOutputEngine, type MidiOutputInfo } from '../engine/midiOutputEngine'
import { isSamplerReady } from '../engine/samplerEngine'

interface AudioSettingsPanelProps {
  screenX: number
  screenY: number
  onClose: () => void
}

export function AudioSettingsPanel({ screenX, screenY, onClose }: AudioSettingsPanelProps): JSX.Element {
  const { audioMode, setAudioMode, midiOutputDeviceId, setMidiOutputDevice } = useAppStore()
  const [midiOutputs, setMidiOutputs] = useState<MidiOutputInfo[]>([])
  const [midiAvailable, setMidiAvailable] = useState(true)
  const samplerReady = isSamplerReady()

  useEffect(() => {
    midiOutputEngine.init().then(ok => {
      setMidiAvailable(ok)
      setMidiOutputs(midiOutputEngine.outputInfos)
    })
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const handleOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-audio-settings]')) onClose()
    }
    window.addEventListener('keydown', handleKey)
    const t = setTimeout(() => window.addEventListener('mousedown', handleOutside), 0)
    return () => {
      window.removeEventListener('keydown', handleKey)
      clearTimeout(t)
      window.removeEventListener('mousedown', handleOutside)
    }
  }, [onClose])

  const handleSelectMidiOutput = (id: string) => {
    setMidiOutputDevice(id)
    void midiOutputEngine.selectOutput(id)
  }

  return (
    <div
      data-audio-settings=""
      style={{
        position: 'fixed',
        left:   screenX,
        top:    screenY,
        background: '#252526',
        border: '1px solid #444',
        borderRadius: 4,
        padding: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        zIndex: 1000,
        minWidth: 220,
        color: '#d4d4d4',
        fontSize: 12,
      }}
    >
      {/* Mode toggle */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: '#777', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Playback Mode
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <ModeButton
            label="Built-in Audio"
            active={audioMode === 'builtin'}
            onClick={() => setAudioMode('builtin')}
          />
          <ModeButton
            label="MIDI Output"
            active={audioMode === 'midi-out'}
            onClick={() => setAudioMode('midi-out')}
          />
        </div>
      </div>

      {/* Built-in detail */}
      {audioMode === 'builtin' && (
        <div style={{ fontSize: 11, color: samplerReady ? '#4ec94e' : '#999' }}>
          {samplerReady ? '✓ Salamander Grand Piano loaded' : '⧗ Samples load on first play'}
        </div>
      )}

      {/* MIDI output device list */}
      {audioMode === 'midi-out' && (
        <div>
          <div style={{ fontSize: 10, color: '#777', marginBottom: 5, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Output Device
          </div>
          {!midiAvailable && (
            <div style={{ fontSize: 11, color: '#e07070' }}>Web MIDI not available</div>
          )}
          {midiAvailable && midiOutputs.length === 0 && (
            <div style={{ fontSize: 11, color: '#999' }}>No MIDI output devices found</div>
          )}
          {midiAvailable && midiOutputs.map(o => (
            <button
              key={o.id}
              onClick={() => handleSelectMidiOutput(o.id)}
              style={{
                display:    'block',
                width:      '100%',
                textAlign:  'left',
                padding:    '4px 8px',
                marginBottom: 2,
                fontSize:   11,
                borderRadius: 3,
                border:    'none',
                cursor:    'pointer',
                background: o.id === midiOutputDeviceId ? '#0e639c' : '#1e1e1e',
                color:      o.id === midiOutputDeviceId ? '#fff' : '#ccc',
              }}
            >
              {o.name}
            </button>
          ))}
          {midiAvailable && midiOutputs.length > 0 && !midiOutputDeviceId && (
            <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>Select a device above</div>
          )}
        </div>
      )}
    </div>
  )
}

function ModeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '4px 6px',
        fontSize: 11,
        borderRadius: 3,
        border: '1px solid',
        borderColor: active ? '#0e639c' : '#444',
        cursor: 'pointer',
        background: active ? '#0e639c' : '#1e1e1e',
        color:  active ? '#fff' : '#999',
      }}
    >
      {label}
    </button>
  )
}
