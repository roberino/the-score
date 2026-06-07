import { useState, useEffect, useRef } from 'react'

export type InsertPosition = 'after-cursor' | 'end'

export interface PartOption {
  id: string
  name: string
}

interface InsertBarsDialogProps {
  parts: PartOption[]
  onInsert: (count: number, position: InsertPosition, partId: string | null) => void
  onClose: () => void
}

export function InsertBarsDialog({ parts, onInsert, onClose }: InsertBarsDialogProps): JSX.Element {
  const [count, setCount] = useState(1)
  const [position, setPosition] = useState<InsertPosition>('after-cursor')
  const [partId, setPartId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); e.stopPropagation() }
      if (e.key === 'Enter') { handleInsert(); e.stopPropagation() }
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
  }, [count, position, partId])

  function handleInsert() {
    onInsert(Math.max(1, Math.min(99, count)), position, partId)
    onClose()
  }

  const showPartSelector = parts.length > 1
  const partOptions: { id: string | null; label: string }[] = [
    { id: null, label: 'All parts' },
    ...parts.map(p => ({ id: p.id, label: p.name })),
  ]

  const btnInactive: React.CSSProperties = {
    flex: 1, padding: '4px 0', borderRadius: 4, fontSize: 13,
    border: '1px solid #555', cursor: 'pointer',
    background: '#2d2d2d', color: '#ccc',
  }
  const btnActive: React.CSSProperties = {
    ...btnInactive, background: '#0e639c', border: '1px solid #0e639c', color: '#fff',
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
          background: '#1e1e1e', border: '1px solid #444', borderRadius: 6,
          padding: '16px 20px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          minWidth: 260, display: 'flex', flexDirection: 'column', gap: 12,
          color: '#d4d4d4',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14 }}>Insert Bars</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <label style={{ flexShrink: 0, color: '#ccc' }}>Number of bars:</label>
          <input
            ref={inputRef}
            type="number"
            min={1}
            max={99}
            value={count}
            onChange={e => setCount(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
            style={{
              width: 54, padding: '3px 6px', border: '1px solid #555', borderRadius: 3,
              fontSize: 13, textAlign: 'center', background: '#2d2d2d', color: '#ccc',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {(['after-cursor', 'end'] as const).map(pos => (
            <button
              key={pos}
              onClick={() => setPosition(pos)}
              style={position === pos ? btnActive : btnInactive}
            >
              {pos === 'after-cursor' ? 'After current bar' : 'At end of score'}
            </button>
          ))}
        </div>

        {showPartSelector && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>
              Apply to
            </div>
            {partOptions.map(opt => (
              <button
                key={opt.id ?? 'all'}
                onClick={() => setPartId(opt.id)}
                style={{
                  padding: '4px 8px', borderRadius: 4, fontSize: 13, textAlign: 'left',
                  border: '1px solid #555', cursor: 'pointer',
                  background: partId === opt.id ? '#0e639c' : '#2d2d2d',
                  color: partId === opt.id ? '#fff' : '#ccc',
                }}
              >
                {opt.label}
              </button>
            ))}
            {partId !== null && (
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                Other parts will have empty bars added at the end to stay aligned.
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '4px 12px', borderRadius: 4, fontSize: 13, border: '1px solid #555', cursor: 'pointer', background: '#2d2d2d', color: '#ccc' }}
          >
            Cancel
          </button>
          <button
            onClick={handleInsert}
            style={{ padding: '4px 12px', borderRadius: 4, fontSize: 13, border: '1px solid #0e639c', cursor: 'pointer', background: '#0e639c', color: '#fff' }}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  )
}
