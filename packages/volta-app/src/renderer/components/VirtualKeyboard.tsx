import { useState } from 'react'
import type { NoteInput } from '../services/midiService'
import type { NoteName } from '@shared/score'

// ── Key layout ────────────────────────────────────────────────────────────────

interface WhiteKeyDef { noteName: NoteName; whiteIdx: number }
interface BlackKeyDef { noteName: NoteName; accidental: 'sharp'; whiteIdx: number }

const WHITE_KEYS: WhiteKeyDef[] = [
  { noteName: 'C', whiteIdx: 0 },
  { noteName: 'D', whiteIdx: 1 },
  { noteName: 'E', whiteIdx: 2 },
  { noteName: 'F', whiteIdx: 3 },
  { noteName: 'G', whiteIdx: 4 },
  { noteName: 'A', whiteIdx: 5 },
  { noteName: 'B', whiteIdx: 6 },
]

// Black keys: placed between white keys at fractional positions
// whiteIdx is the white key to the LEFT of the black key
const BLACK_KEYS: BlackKeyDef[] = [
  { noteName: 'C', accidental: 'sharp', whiteIdx: 0 },  // C# between C(0) and D(1)
  { noteName: 'D', accidental: 'sharp', whiteIdx: 1 },  // D# between D(1) and E(2)
  { noteName: 'F', accidental: 'sharp', whiteIdx: 3 },  // F# between F(3) and G(4)
  { noteName: 'G', accidental: 'sharp', whiteIdx: 4 },  // G# between G(4) and A(5)
  { noteName: 'A', accidental: 'sharp', whiteIdx: 5 },  // A# between A(5) and B(6)
]

const WHITE_W  = 28   // px
const WHITE_H  = 80
const BLACK_W  = 18
const BLACK_H  = 50
const OCTAVES  = 2    // number of octaves shown

// ── Props ─────────────────────────────────────────────────────────────────────

interface VirtualKeyboardProps {
  onNotePress: (input: NoteInput) => void
  onClose: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VirtualKeyboard({ onNotePress, onClose }: VirtualKeyboardProps): JSX.Element {
  const [baseOctave, setBaseOctave] = useState(4)
  const [activeKey,  setActiveKey]  = useState<string | null>(null)

  const totalWhiteKeys = WHITE_KEYS.length * OCTAVES   // 14
  const keyboardWidth  = totalWhiteKeys * WHITE_W + 2  // +2 for border

  const fireNote = (noteName: NoteName, octave: number, accidental?: 'sharp') => {
    const key = `${noteName}${accidental ?? ''}${octave}`
    setActiveKey(key)
    onNotePress({ noteName, octave, ...(accidental ? { accidental } : {}), velocity: 100 })
  }

  const releaseKey = () => setActiveKey(null)

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#252526',
        border: '1px solid #444',
        borderBottom: 'none',
        borderRadius: '6px 6px 0 0',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
        zIndex: 500,
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 10px', borderBottom: '1px solid #333',
      }}>
        <span style={{ fontSize: 11, color: '#888', fontWeight: 600, letterSpacing: 0.5 }}>
          VIRTUAL KEYBOARD
        </span>

        {/* Octave navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setBaseOctave(o => Math.max(0, o - 1))}
            style={navBtn}
            title="Shift down one octave"
          >◄</button>
          <span style={{ fontSize: 11, color: '#ccc', minWidth: 60, textAlign: 'center' }}>
            C{baseOctave} – B{baseOctave + OCTAVES - 1}
          </span>
          <button
            onClick={() => setBaseOctave(o => Math.min(8, o + 1))}
            style={navBtn}
            title="Shift up one octave"
          >►</button>
        </div>

        <button onClick={onClose} style={{ ...navBtn, fontSize: 14 }} title="Close keyboard">×</button>
      </div>

      {/* Keys */}
      <div style={{ padding: '8px 10px 0', paddingBottom: 10 }}>
        <div style={{ position: 'relative', width: keyboardWidth, height: WHITE_H }}>
          {/* White keys */}
          {Array.from({ length: OCTAVES }, (_, octaveOffset) => {
            const octave = baseOctave + octaveOffset
            return WHITE_KEYS.map(({ noteName, whiteIdx }) => {
              const x   = (octaveOffset * 7 + whiteIdx) * WHITE_W
              const key = `${noteName}${octave}`
              const isActive = activeKey === key
              return (
                <div
                  key={key}
                  onMouseDown={() => fireNote(noteName, octave)}
                  onMouseUp={releaseKey}
                  onMouseLeave={releaseKey}
                  style={{
                    position: 'absolute',
                    left: x,
                    top: 0,
                    width: WHITE_W - 1,
                    height: WHITE_H,
                    background: isActive ? '#aad4f5' : '#f8f8f8',
                    border: '1px solid #999',
                    borderTop: 'none',
                    borderRadius: '0 0 3px 3px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    paddingBottom: 4,
                    fontSize: 10,
                    color: '#555',
                    transition: 'background 0.05s',
                    zIndex: 1,
                  }}
                >
                  {noteName === 'C' ? `C${octave}` : ''}
                </div>
              )
            })
          })}

          {/* Black keys (rendered on top) */}
          {Array.from({ length: OCTAVES }, (_, octaveOffset) => {
            const octave = baseOctave + octaveOffset
            return BLACK_KEYS.map(({ noteName, accidental, whiteIdx }) => {
              const x   = (octaveOffset * 7 + whiteIdx) * WHITE_W + WHITE_W - Math.floor(BLACK_W / 2)
              const key = `${noteName}${accidental}${octave}`
              const isActive = activeKey === key
              return (
                <div
                  key={key}
                  onMouseDown={(e) => { e.stopPropagation(); fireNote(noteName, octave, accidental) }}
                  onMouseUp={releaseKey}
                  onMouseLeave={releaseKey}
                  style={{
                    position: 'absolute',
                    left: x,
                    top: 0,
                    width: BLACK_W,
                    height: BLACK_H,
                    background: isActive ? '#3b9ddd' : '#222',
                    borderRadius: '0 0 3px 3px',
                    cursor: 'pointer',
                    zIndex: 2,
                    transition: 'background 0.05s',
                  }}
                />
              )
            })
          })}
        </div>
      </div>
    </div>
  )
}

// ── Micro-styles ──────────────────────────────────────────────────────────────

const navBtn: React.CSSProperties = {
  background: 'none', border: '1px solid #444', borderRadius: 3,
  color: '#aaa', cursor: 'pointer', fontSize: 11, padding: '2px 7px',
}
