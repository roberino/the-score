import { useEffect, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'
import type { PedalMark } from '@shared/score'

const sectionLabel: React.CSSProperties = {
  fontSize: 10, color: '#888', textTransform: 'uppercase',
  letterSpacing: 0.5, marginBottom: 4,
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#888', cursor: 'pointer',
  fontSize: 13, lineHeight: 1, padding: '0 2px',
}

const inputStyle: React.CSSProperties = {
  background: '#3c3c3c', border: '1px solid #555', borderRadius: 3,
  color: '#d4d4d4', fontSize: 11, padding: '3px 6px',
}

export interface PedalMarkPickerProps {
  existing:     readonly PedalMark[]
  capacity:     number
  initialBeat:  number
  screenX:      number
  screenY:      number
  onAdd:    (mark: PedalMark) => void
  onRemove: (markId: string) => void
  onClose:  () => void
}

export function PedalMarkPicker({
  existing, capacity, initialBeat, screenX, screenY, onAdd, onRemove, onClose,
}: PedalMarkPickerProps): JSX.Element {
  const [beat, setBeat]         = useState(String(initialBeat))
  const [markType, setMarkType] = useState<'down' | 'up'>('down')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    const timer = setTimeout(() => window.addEventListener('mousedown', onOut), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearTimeout(timer)
      window.removeEventListener('mousedown', onOut)
    }
  }, [onClose])

  const parsedBeat = () => {
    const v = parseInt(beat, 10)
    return Number.isFinite(v) ? Math.max(0, Math.min(capacity - 1, v)) : 0
  }

  // U+E650 = keyboardPedalPed, U+E655 = keyboardPedalUp (SMuFL, Bravura)
  const PEDAL_DOWN = ''
  const PEDAL_UP   = ''

  const typeBtn = (active: boolean): React.CSSProperties => ({
    padding: '4px 14px', fontSize: 18, borderRadius: 3, border: '1px solid #555',
    cursor: 'pointer', fontFamily: 'Bravura, Academico, serif',
    background: active ? '#0e639c' : '#2d2d2d',
    color:      active ? '#fff'    : '#ccc',
    lineHeight: 1.2,
  })

  const pickerW = 220
  const pickerH = 200
  const left = Math.min(screenX, window.innerWidth  - pickerW - 8)
  const top  = Math.min(screenY, window.innerHeight - pickerH - 8)

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', left, top,
        background: '#1e1e1e', border: '1px solid #444', borderRadius: 6,
        width: pickerW, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        zIndex: 1000, display: 'flex', flexDirection: 'column', fontSize: 12,
        color: '#d4d4d4',
      }}
    >
      {existing.length > 0 && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #333' }}>
          <div style={sectionLabel}>Current</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {existing.map(m => (
              <span key={m.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                background: '#2d2d2d', border: '1px solid #2a2a8a', borderRadius: 3,
                padding: '2px 6px', fontSize: 11,
              }}>
                <span style={{ color: '#6a6ace', fontFamily: 'Bravura, Academico, serif', fontSize: 15 }}>
                  {m.type === 'down' ? PEDAL_DOWN : PEDAL_UP}
                </span>
                <span style={{ color: '#888', fontSize: 10 }}>@{m.beatPosition}</span>
                <button style={iconBtn} onClick={() => onRemove(m.id)} title="Remove">×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: '10px 10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>Beat (64th)</span>
          <input
            type="number"
            min={0}
            max={capacity - 1}
            value={beat}
            onChange={e => setBeat(e.target.value)}
            style={{ ...inputStyle, width: 60 }}
          />
        </div>

        <div>
          <div style={sectionLabel}>Type</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={typeBtn(markType === 'down')} onClick={() => setMarkType('down')}>{PEDAL_DOWN}</button>
            <button style={typeBtn(markType === 'up')}   onClick={() => setMarkType('up')}>{PEDAL_UP}</button>
          </div>
        </div>

        <button
          onClick={() => onAdd({ id: uuid(), type: markType, beatPosition: parsedBeat() })}
          style={{
            padding: '4px 10px', fontSize: 11, borderRadius: 3,
            border: 'none', cursor: 'pointer', background: '#0e639c', color: '#fff',
          }}
        >
          Add
        </button>
      </div>
    </div>
  )
}
