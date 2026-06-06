import { useEffect } from 'react'
import type { ClefType } from '@shared/score'

const CLEF_OPTIONS: { clef: ClefType; label: string; detail: string }[] = [
  { clef: 'treble',     label: 'Treble',     detail: 'G clef'            },
  { clef: 'bass',       label: 'Bass',       detail: 'F clef'            },
  { clef: 'alto',       label: 'Alto',       detail: 'C clef, 3rd line'  },
  { clef: 'tenor',      label: 'Tenor',      detail: 'C clef, 4th line'  },
  { clef: 'percussion', label: 'Percussion', detail: 'Unpitched'         },
]

interface ClefPickerProps {
  current: ClefType
  screenX: number
  screenY: number
  onClose: () => void
  onSelect: (clef: ClefType) => void
}

export function ClefPicker({ current, screenX, screenY, onClose, onSelect }: ClefPickerProps): JSX.Element {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const handleOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-clef-picker]')) onClose()
    }
    window.addEventListener('keydown', handleKey)
    const timer = setTimeout(() => window.addEventListener('mousedown', handleOutside), 0)
    return () => {
      window.removeEventListener('keydown', handleKey)
      clearTimeout(timer)
      window.removeEventListener('mousedown', handleOutside)
    }
  }, [onClose])

  return (
    <div
      data-clef-picker=""
      style={{
        position: 'fixed', left: screenX, top: screenY,
        background: '#1e1e1e', border: '1px solid #444', borderRadius: 6,
        padding: '6px 8px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 2,
        minWidth: 160, fontSize: 12, color: '#d4d4d4',
      }}
    >
      {CLEF_OPTIONS.map(({ clef, label, detail }) => (
        <button
          key={clef}
          onClick={() => onSelect(clef)}
          style={{
            padding: '4px 8px', fontSize: 12, textAlign: 'left',
            cursor: 'pointer', borderRadius: 3,
            background: clef === current ? '#0e639c' : 'none',
            border: clef === current ? '1px solid #0e639c' : '1px solid transparent',
            color: clef === current ? '#fff' : '#ccc',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          }}
        >
          <span style={{ fontWeight: clef === current ? 600 : 400 }}>{label}</span>
          <span style={{ fontSize: 10, color: clef === current ? 'rgba(255,255,255,0.7)' : '#666' }}>{detail}</span>
        </button>
      ))}
    </div>
  )
}
