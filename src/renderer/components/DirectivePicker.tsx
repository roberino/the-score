import { useEffect, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'
import { TEMPO_WORDS } from '@shared/musicUtils'
import type { Directive, DirectiveCategory } from '@shared/score'

// ── Expression presets ────────────────────────────────────────────────────────

const EXPRESSION_PRESETS: { text: string; midiProgram?: number }[] = [
  { text: 'pizz.',       midiProgram: 45  },
  { text: 'arco',        midiProgram: -1  },
  { text: 'con sord.'                     },
  { text: 'senza sord.'                   },
  { text: 'rit.'                          },
  { text: 'accel.'                        },
  { text: 'meno mosso'                    },
  { text: 'più mosso'                     },
]


// ── Shared micro-styles ───────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  fontSize: 10, color: '#888', textTransform: 'uppercase',
  letterSpacing: 0.5, marginBottom: 4,
}

const chip = (active?: boolean): React.CSSProperties => ({
  padding: '3px 7px', fontSize: 11, borderRadius: 3, border: '1px solid #555',
  cursor: 'pointer', background: active ? '#0e639c' : '#2d2d2d',
  color: active ? '#fff' : '#ccc',
})

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#888', cursor: 'pointer',
  fontSize: 13, lineHeight: 1, padding: '0 2px',
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DirectivePickerProps {
  /** Directives already on this measure (for all categories) */
  existing: readonly Directive[]
  /** Whether to show the tempo section (first part only) */
  showTempo: boolean
  screenX: number
  screenY: number
  onAdd:    (directive: Directive) => void
  onRemove: (directiveId: string) => void
  onClose:  () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DirectivePicker({
  existing, showTempo, screenX, screenY, onAdd, onRemove, onClose,
}: DirectivePickerProps): JSX.Element {
  const [tab, setTab] = useState<DirectiveCategory>(showTempo ? 'tempo' : 'expression')

  // Tempo state
  const [tempoText, setTempoText] = useState('')
  const [tempoBpm, setTempoBpm]   = useState<string>('')

  // Expression state
  const [exprText, setExprText] = useState('')

  const ref = useRef<HTMLDivElement>(null)

  // Close on Escape or outside click
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

  const addDirective = (partial: Omit<Directive, 'id'>) => {
    onAdd({ id: uuid(), ...partial })
  }

  // Clamp picker to viewport
  const pickerW = 280
  const pickerH = 340
  const left = Math.min(screenX, window.innerWidth  - pickerW - 8)
  const top  = Math.min(screenY, window.innerHeight - pickerH - 8)

  const tabs: { id: DirectiveCategory; label: string }[] = [
    ...(showTempo ? [{ id: 'tempo' as DirectiveCategory, label: 'Tempo' }] : []),
    { id: 'expression', label: 'Expression' },
  ]

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
      {/* ── Existing directives ───────────────────────────────────────────── */}
      {existing.length > 0 && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #333' }}>
          <div style={sectionLabel}>Current</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {existing.map(d => (
              <span key={d.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                background: '#2d2d2d', border: '1px solid #555', borderRadius: 3,
                padding: '2px 6px', fontSize: 11,
              }}>
                <span style={{ fontStyle: d.category === 'expression' ? 'italic' : 'normal',
                               fontWeight: d.category !== 'expression' ? 'bold' : 'normal' }}>
                  {d.text}{d.bpm ? ` ♩=${d.bpm}` : ''}
                </span>
                <button style={iconBtn} onClick={() => onRemove(d.id)} title="Remove">×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Category tabs ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: '6px 0', fontSize: 11, border: 'none', cursor: 'pointer',
              background: tab === t.id ? '#252526' : 'transparent',
              color: tab === t.id ? '#fff' : '#888',
              borderBottom: tab === t.id ? '2px solid #0e639c' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────── */}
      <div style={{ padding: '10px 10px 12px', overflowY: 'auto', maxHeight: 240 }}>

        {/* Tempo */}
        {tab === 'tempo' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={sectionLabel}>Tempo word</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {TEMPO_WORDS.map(w => (
                <button
                  key={w.text}
                  style={chip(tempoText === w.text)}
                  onClick={() => { setTempoText(w.text); setTempoBpm(String(w.bpm)) }}
                >
                  {w.text}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
              <input
                placeholder="Custom text…"
                value={tempoText}
                onChange={e => setTempoText(e.target.value)}
                style={inputStyle}
              />
              <span style={{ color: '#777', fontSize: 13 }}>♩=</span>
              <input
                type="number"
                min={20} max={300}
                placeholder="BPM"
                value={tempoBpm}
                onChange={e => setTempoBpm(e.target.value)}
                style={{ ...inputStyle, width: 56 }}
              />
            </div>

            <button
              disabled={!tempoText.trim()}
              onClick={() => {
                if (!tempoText.trim()) return
                const parsed = tempoBpm ? Number(tempoBpm) : NaN
                addDirective({
                  category: 'tempo',
                  text: tempoText.trim(),
                  ...(Number.isFinite(parsed) ? { bpm: parsed } : {}),
                })
                setTempoText(''); setTempoBpm('')
              }}
              style={addBtn(!tempoText.trim())}
            >
              Add tempo
            </button>
          </div>
        )}

        {/* Expression */}
        {tab === 'expression' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={sectionLabel}>Presets</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {EXPRESSION_PRESETS.map(p => (
                <button
                  key={p.text}
                  style={{ ...chip(), fontStyle: 'italic' }}
                  onClick={() => addDirective({
                    category: 'expression',
                    text: p.text,
                    ...(p.midiProgram != null ? { midiProgram: p.midiProgram } : {}),
                  })}
                >
                  {p.text}
                </button>
              ))}
            </div>

            <div style={sectionLabel}>Custom</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                placeholder="e.g. sul ponticello"
                value={exprText}
                onChange={e => setExprText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && exprText.trim()) {
                    addDirective({ category: 'expression', text: exprText.trim() })
                    setExprText('')
                  }
                }}
                style={inputStyle}
              />
              <button
                disabled={!exprText.trim()}
                onClick={() => {
                  if (!exprText.trim()) return
                  addDirective({ category: 'expression', text: exprText.trim() })
                  setExprText('')
                }}
                style={addBtn(!exprText.trim())}
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Micro-styles ──────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  flex: 1, background: '#2d2d2d', border: '1px solid #555', borderRadius: 3,
  color: '#d4d4d4', padding: '3px 6px', fontSize: 11, outline: 'none',
}

const addBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '4px 10px', fontSize: 11, borderRadius: 3, border: 'none',
  cursor: disabled ? 'not-allowed' : 'pointer',
  background: disabled ? '#333' : '#0e639c',
  color: disabled ? '#666' : '#fff',
})
