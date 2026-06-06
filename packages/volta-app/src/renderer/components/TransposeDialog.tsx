import { useState, useEffect, useRef } from 'react'

const NAMED_INTERVALS: { label: string; semitones: number }[] = [
  { label: 'm2',     semitones: 1  },
  { label: 'M2',     semitones: 2  },
  { label: 'm3',     semitones: 3  },
  { label: 'M3',     semitones: 4  },
  { label: 'P4',     semitones: 5  },
  { label: 'Tritone',semitones: 6  },
  { label: 'P5',     semitones: 7  },
  { label: 'm6',     semitones: 8  },
  { label: 'M6',     semitones: 9  },
  { label: 'm7',     semitones: 10 },
  { label: 'M7',     semitones: 11 },
  { label: 'P8',     semitones: 12 },
]

interface TransposeDialogProps {
  onTranspose: (semitones: number) => void
  onClose: () => void
}

export function TransposeDialog({ onTranspose, onClose }: TransposeDialogProps): JSX.Element {
  const [direction, setDirection] = useState<'up' | 'down'>('up')
  const [amount, setAmount] = useState(1)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); e.stopPropagation() }
      if (e.key === 'Enter') { handleTranspose(); e.stopPropagation() }
    }
    const handleOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', handleKey, true)
    const timer = setTimeout(() => window.addEventListener('mousedown', handleOutside), 0)
    return () => {
      window.removeEventListener('keydown', handleKey, true)
      clearTimeout(timer)
      window.removeEventListener('mousedown', handleOutside)
    }
  }, [direction, amount])

  function handleTranspose() {
    const semitones = direction === 'up' ? amount : -amount
    onTranspose(semitones)
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, pointerEvents: 'none',
    }}>
      <div
        ref={panelRef}
        style={{
          pointerEvents: 'auto',
          background: '#fff', border: '1px solid #ccc', borderRadius: 6,
          padding: '16px 20px', boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          minWidth: 260, display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14 }}>Transpose</div>

        <div style={{ display: 'flex', gap: 8 }}>
          {(['up', 'down'] as const).map(d => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              style={{
                flex: 1, padding: '4px 0', borderRadius: 4, fontSize: 13,
                border: '1px solid #ccc', cursor: 'pointer',
                background: direction === d ? '#0e639c' : '#f5f5f5',
                color: direction === d ? '#fff' : '#333',
              }}
            >
              {d === 'up' ? '↑ Up' : '↓ Down'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {NAMED_INTERVALS.map(({ label, semitones }) => (
            <button
              key={label}
              onClick={() => setAmount(semitones)}
              style={{
                padding: '3px 7px', borderRadius: 3, fontSize: 12,
                border: '1px solid #ccc', cursor: 'pointer',
                background: amount === semitones ? '#0e639c' : '#f5f5f5',
                color: amount === semitones ? '#fff' : '#333',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <label style={{ flexShrink: 0 }}>Semitones:</label>
          <input
            type="number"
            min={1}
            max={24}
            value={amount}
            onChange={e => setAmount(Math.max(1, Math.min(24, Number(e.target.value))))}
            style={{
              width: 54, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 3,
              fontSize: 13, textAlign: 'center',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '4px 12px', borderRadius: 4, fontSize: 13,
              border: '1px solid #ccc', cursor: 'pointer', background: '#f5f5f5',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleTranspose}
            style={{
              padding: '4px 12px', borderRadius: 4, fontSize: 13,
              border: '1px solid #0e639c', cursor: 'pointer',
              background: '#0e639c', color: '#fff',
            }}
          >
            Transpose
          </button>
        </div>
      </div>
    </div>
  )
}
