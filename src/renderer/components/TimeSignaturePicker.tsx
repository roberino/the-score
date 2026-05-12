import { useEffect } from 'react'
import type { TimeSignature } from '@shared/score'
import { timeSigsEqual } from '@shared/musicUtils'

// ── Presets ───────────────────────────────────────────────────────────────────

interface Preset { label: string; sig: TimeSignature }

const PRESET_GROUPS: { group: string; presets: Preset[] }[] = [
  {
    group: 'Simple',
    presets: [
      { label: '2/4',  sig: { numerator: 2,  denominator: 4 } },
      { label: '3/4',  sig: { numerator: 3,  denominator: 4 } },
      { label: '4/4',  sig: { numerator: 4,  denominator: 4 } },
    ],
  },
  {
    group: 'Compound',
    presets: [
      { label: '6/8',  sig: { numerator: 6,  denominator: 8 } },
      { label: '9/8',  sig: { numerator: 9,  denominator: 8 } },
      { label: '12/8', sig: { numerator: 12, denominator: 8 } },
    ],
  },
  {
    group: 'Asymmetric',
    presets: [
      { label: '5/4',  sig: { numerator: 5,  denominator: 4 } },
      { label: '7/4',  sig: { numerator: 7,  denominator: 4 } },
      { label: '5/8',  sig: { numerator: 5,  denominator: 8 } },
      { label: '7/8',  sig: { numerator: 7,  denominator: 8 } },
    ],
  },
]

export { PRESET_GROUPS }

// ── Component ─────────────────────────────────────────────────────────────────

interface TimeSignaturePickerProps {
  current: TimeSignature
  screenX: number
  screenY: number
  onClose: () => void
  onSelect: (sig: TimeSignature) => void
}

export function TimeSignaturePicker({
  current, screenX, screenY, onClose, onSelect,
}: TimeSignaturePickerProps): JSX.Element {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const handleOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-timesig-picker]')) onClose()
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
      data-timesig-picker=""
      style={{
        position: 'fixed', left: screenX, top: screenY,
        background: '#2d2d2d', border: '1px solid #555', borderRadius: 4,
        padding: '8px 10px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        zIndex: 1000, minWidth: 160,
      }}
    >
      {PRESET_GROUPS.map(({ group, presets }) => (
        <div key={group} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: '#777', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
            {group}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {presets.map(({ label, sig }) => {
              const active = timeSigsEqual(sig, current)
              return (
                <button
                  key={label}
                  onClick={() => onSelect(sig)}
                  style={{
                    padding: '4px 8px', fontSize: 12, borderRadius: 3,
                    border: active ? '1px solid #0e639c' : '1px solid #444',
                    cursor: 'pointer',
                    background: active ? '#0e639c' : '#1e1e1e',
                    color: active ? '#fff' : '#ccc',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
