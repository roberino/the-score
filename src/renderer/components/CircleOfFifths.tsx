import { useEffect } from 'react'
import type { KeySignature } from '@shared/score'

// ── Circle data ───────────────────────────────────────────────────────────────
// Clockwise from 12 o'clock = C major. Each entry covers 30°.

const POSITIONS = [
  { major: 'C',  minor: 'Am',  fifths: 0  },
  { major: 'G',  minor: 'Em',  fifths: 1  },
  { major: 'D',  minor: 'Bm',  fifths: 2  },
  { major: 'A',  minor: 'F♯m', fifths: 3  },
  { major: 'E',  minor: 'C♯m', fifths: 4  },
  { major: 'B',  minor: 'G♯m', fifths: 5  },
  { major: 'F♯', minor: 'D♯m', fifths: 6  },
  { major: 'D♭', minor: 'B♭m', fifths: -5 },
  { major: 'A♭', minor: 'Fm',  fifths: -4 },
  { major: 'E♭', minor: 'Cm',  fifths: -3 },
  { major: 'B♭', minor: 'Gm',  fifths: -2 },
  { major: 'F',  minor: 'Dm',  fifths: -1 },
]

// ── SVG geometry ──────────────────────────────────────────────────────────────

const CX = 140, CY = 140
const R_OUTER_IN = 84, R_OUTER_OUT = 130   // major ring
const R_INNER_IN = 46, R_INNER_OUT = 84    // minor ring

function toRad(deg: number): number { return (deg * Math.PI) / 180 }

function sectorPath(
  r1: number, r2: number,
  startDeg: number, endDeg: number,
  gap = 1.2
): string {
  const s = toRad(startDeg + gap)
  const e = toRad(endDeg   - gap)
  const x1 = CX + r2 * Math.cos(s), y1 = CY + r2 * Math.sin(s)
  const x2 = CX + r2 * Math.cos(e), y2 = CY + r2 * Math.sin(e)
  const x3 = CX + r1 * Math.cos(e), y3 = CY + r1 * Math.sin(e)
  const x4 = CX + r1 * Math.cos(s), y4 = CY + r1 * Math.sin(s)
  return `M ${x1} ${y1} A ${r2} ${r2} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${r1} ${r1} 0 0 0 ${x4} ${y4} Z`
}

function textPt(r: number, midDeg: number): [number, number] {
  return [CX + r * Math.cos(toRad(midDeg)), CY + r * Math.sin(toRad(midDeg))]
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CircleOfFifthsProps {
  current: KeySignature
  screenX: number
  screenY: number
  onClose: () => void
  onSelect: (key: KeySignature) => void
  onReset?: () => void
}

export function CircleOfFifths({
  current, screenX, screenY, onClose, onSelect, onReset,
}: CircleOfFifthsProps): JSX.Element {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const handleOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-cof-picker]')) onClose()
    }
    window.addEventListener('keydown', handleKey)
    const timer = setTimeout(() => window.addEventListener('mousedown', handleOutside), 0)
    return () => {
      window.removeEventListener('keydown', handleKey)
      clearTimeout(timer)
      window.removeEventListener('mousedown', handleOutside)
    }
  }, [onClose])

  // Clamp so the picker stays on screen
  const left = Math.min(screenX, window.innerWidth  - 310)
  const top  = Math.min(screenY, window.innerHeight - 320)

  return (
    <div
      data-cof-picker=""
      style={{
        position: 'fixed', left, top,
        background: '#2d2d2d', border: '1px solid #555', borderRadius: 8,
        padding: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        zIndex: 1000,
      }}
    >
      {onReset && (
        <button
          onClick={onReset}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: '4px 8px', marginBottom: 8, fontSize: 11,
            borderRadius: 3, border: '1px solid #555',
            cursor: 'pointer', background: '#1e1e1e', color: '#aaa',
          }}
        >
          ↩ Reset to inherited
        </button>
      )}
      <svg width={280} height={280} viewBox="0 0 280 280">
        {POSITIONS.map((pos, i) => {
          const startDeg = -90 + i * 30
          const endDeg   = -90 + (i + 1) * 30
          const midDeg   = -90 + (i + 0.5) * 30

          const outerActive = pos.fifths === current.fifths && current.mode === 'major'
          const innerActive = pos.fifths === current.fifths && current.mode === 'minor'

          const [tx1, ty1] = textPt((R_OUTER_IN + R_OUTER_OUT) / 2, midDeg)
          const [tx2, ty2] = textPt((R_INNER_IN + R_INNER_OUT) / 2, midDeg)

          return (
            <g key={i}>
              {/* Major sector */}
              <path
                d={sectorPath(R_OUTER_IN, R_OUTER_OUT, startDeg, endDeg)}
                fill={outerActive ? '#0e639c' : '#1e1e1e'}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect({ fifths: pos.fifths, mode: 'major' })}
              />
              <text
                x={tx1} y={ty1}
                textAnchor="middle" dominantBaseline="central"
                fontSize={13}
                fill={outerActive ? '#fff' : '#ccc'}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {pos.major}
              </text>

              {/* Minor sector */}
              <path
                d={sectorPath(R_INNER_IN, R_INNER_OUT, startDeg, endDeg)}
                fill={innerActive ? '#0e639c' : '#252525'}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect({ fifths: pos.fifths, mode: 'minor' })}
              />
              <text
                x={tx2} y={ty2}
                textAnchor="middle" dominantBaseline="central"
                fontSize={10}
                fill={innerActive ? '#fff' : '#999'}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {pos.minor}
              </text>
            </g>
          )
        })}

        {/* Center */}
        <circle cx={CX} cy={CY} r={R_INNER_IN - 2} fill="#1a1a1a" />
        <text x={CX} y={CY - 8} textAnchor="middle" fontSize={10} fill="#666">outer</text>
        <text x={CX} y={CY + 4} textAnchor="middle" fontSize={10} fill="#666">= maj</text>
        <text x={CX} y={CY + 16} textAnchor="middle" fontSize={9}  fill="#555">inner = min</text>
      </svg>
    </div>
  )
}
