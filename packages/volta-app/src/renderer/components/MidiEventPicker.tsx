import { useEffect, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'
import type { MidiScoreEvent, MidiScoreEventType } from '@shared/score'

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

const inputStyle: React.CSSProperties = {
  background: '#3c3c3c', border: '1px solid #555', borderRadius: 3,
  color: '#d4d4d4', fontSize: 11, padding: '3px 6px', width: '100%',
}

const addBtn = (disabled: boolean): React.CSSProperties => ({
  marginTop: 6, padding: '4px 10px', fontSize: 11, borderRadius: 3,
  border: 'none', cursor: disabled ? 'default' : 'pointer',
  background: disabled ? '#333' : '#0e639c', color: disabled ? '#666' : '#fff',
})

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MidiEventPickerProps {
  existing: readonly MidiScoreEvent[]
  capacity: number       // measure capacity in 64th-note units
  initialBeat: number    // initial beat position from click
  screenX: number
  screenY: number
  onAdd:    (event: MidiScoreEvent) => void
  onRemove: (eventId: string) => void
  onClose:  () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function midiEventLabel(e: MidiScoreEvent): string {
  switch (e.type) {
    case 'cc':    return `CC${e.cc!.controller}:${e.cc!.value}`
    case 'pc':    return `PC${e.pc!.program}`
    case 'pb':    return `PB${e.pb!.value >= 0 ? '+' : ''}${e.pb!.value}`
    case 'sysex': return 'SysEx'
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MidiEventPicker({
  existing, capacity, initialBeat, screenX, screenY, onAdd, onRemove, onClose,
}: MidiEventPickerProps): JSX.Element {
  const [tab, setTab] = useState<MidiScoreEventType>('cc')
  const [beat, setBeat] = useState(String(initialBeat))

  // CC state
  const [ccController, setCcController] = useState('7')
  const [ccValue,      setCcValue]      = useState('64')

  // PC state
  const [pcProgram, setPcProgram] = useState('0')

  // PB state
  const [pbValue, setPbValue] = useState('0')

  // SysEx state
  const [sysexHex, setSysexHex] = useState('F0 F7')

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
    return Number.isFinite(v) ? Math.max(0, Math.min(capacity, v)) : 0
  }

  const handleAdd = () => {
    const beatPos = parsedBeat()
    let partial: Omit<MidiScoreEvent, 'id'>

    switch (tab) {
      case 'cc': {
        const controller = Math.max(0, Math.min(127, parseInt(ccController, 10) || 0))
        const value      = Math.max(0, Math.min(127, parseInt(ccValue, 10) || 0))
        partial = { type: 'cc', beatPosition: beatPos, cc: { controller, value } }
        break
      }
      case 'pc': {
        const program = Math.max(0, Math.min(127, parseInt(pcProgram, 10) || 0))
        partial = { type: 'pc', beatPosition: beatPos, pc: { program } }
        break
      }
      case 'pb': {
        const value = Math.max(-8192, Math.min(8191, parseInt(pbValue, 10) || 0))
        partial = { type: 'pb', beatPosition: beatPos, pb: { value } }
        break
      }
      case 'sysex': {
        partial = { type: 'sysex', beatPosition: beatPos, sysex: { hex: sysexHex.trim() } }
        break
      }
    }

    onAdd({ id: uuid(), ...partial })
  }

  const pickerW = 260
  const pickerH = 320
  const left = Math.min(screenX, window.innerWidth  - pickerW - 8)
  const top  = Math.min(screenY, window.innerHeight - pickerH - 8)

  const tabs: { id: MidiScoreEventType; label: string }[] = [
    { id: 'cc',    label: 'CC' },
    { id: 'pc',    label: 'PC' },
    { id: 'pb',    label: 'PB' },
    { id: 'sysex', label: 'SysEx' },
  ]

  const canAdd = tab !== 'sysex' || sysexHex.trim().length > 0

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
      {/* ── Existing events ───────────────────────────────────────────────── */}
      {existing.length > 0 && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #333' }}>
          <div style={sectionLabel}>Current</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {existing.map(e => (
              <span key={e.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                background: '#2d2d2d', border: '1px solid #4EC9B0', borderRadius: 3,
                padding: '2px 6px', fontSize: 11,
              }}>
                <span style={{ color: '#4EC9B0', fontFamily: 'monospace' }}>
                  {midiEventLabel(e)}
                </span>
                <span style={{ color: '#888', fontSize: 10 }}>@{e.beatPosition}</span>
                <button style={iconBtn} onClick={() => onRemove(e.id)} title="Remove">×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Beat position ─────────────────────────────────────────────────── */}
      <div style={{ padding: '8px 10px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>Beat (64th units)</span>
        <input
          type="number"
          min={0}
          max={capacity}
          value={beat}
          onChange={e => setBeat(e.target.value)}
          style={{ ...inputStyle, width: 60 }}
        />
      </div>

      {/* ── Category tabs ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #333', marginTop: 8 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: '6px 0', fontSize: 11, border: 'none', cursor: 'pointer',
              background: tab === t.id ? '#252526' : 'transparent',
              color: tab === t.id ? '#fff' : '#888',
              borderBottom: tab === t.id ? '2px solid #4EC9B0' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────── */}
      <div style={{ padding: '10px 10px 12px' }}>

        {tab === 'cc' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={sectionLabel}>Controller (0–127)</div>
                <input type="number" min={0} max={127} value={ccController}
                  onChange={e => setCcController(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={sectionLabel}>Value (0–127)</div>
                <input type="number" min={0} max={127} value={ccValue}
                  onChange={e => setCcValue(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
              {[
                { n: 0,   label: 'Bank' },
                { n: 1,   label: 'Mod' },
                { n: 7,   label: 'Vol' },
                { n: 10,  label: 'Pan' },
                { n: 11,  label: 'Expr' },
                { n: 64,  label: 'Sus' },
                { n: 121, label: 'Reset' },
                { n: 123, label: 'All Off' },
              ].map(p => (
                <button key={p.n} style={chip(ccController === String(p.n))}
                  onClick={() => setCcController(String(p.n))}>
                  {p.n} {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'pc' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={sectionLabel}>Program (0–127)</div>
            <input type="number" min={0} max={127} value={pcProgram}
              onChange={e => setPcProgram(e.target.value)} style={inputStyle} />
          </div>
        )}

        {tab === 'pb' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={sectionLabel}>Pitch bend value (−8192 to +8191)</div>
            <input type="number" min={-8192} max={8191} value={pbValue}
              onChange={e => setPbValue(e.target.value)} style={inputStyle} />
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {[
                { v: 0,    label: 'Centre' },
                { v: 4096, label: '+4096' },
                { v: 8191, label: '+8191 (max)' },
                { v: -4096, label: '−4096' },
                { v: -8192, label: '−8192 (min)' },
              ].map(p => (
                <button key={p.v} style={chip(pbValue === String(p.v))}
                  onClick={() => setPbValue(String(p.v))}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'sysex' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={sectionLabel}>Hex bytes (space-separated)</div>
            <input
              value={sysexHex}
              onChange={e => setSysexHex(e.target.value)}
              placeholder="F0 41 10 42 12 F7"
              style={{ ...inputStyle, fontFamily: 'monospace' }}
            />
            <div style={{ fontSize: 10, color: '#666' }}>
              Include F0 (start) and F7 (end) bytes.
            </div>
          </div>
        )}

        <button disabled={!canAdd} onClick={handleAdd} style={addBtn(!canAdd)}>
          Add {tab.toUpperCase()}
        </button>
      </div>
    </div>
  )
}
