import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { INSTRUMENTS, INSTRUMENT_FAMILIES, FAMILY_LABELS, type InstrumentDef } from '@shared/instruments'
import type { ClefType } from '@shared/score'

// ── Instrument picker flyout ──────────────────────────────────────────────────

interface InstrumentPickerProps {
  onSelect: (inst: InstrumentDef) => void
  onClose: () => void
}

function InstrumentPicker({ onSelect, onClose }: InstrumentPickerProps): JSX.Element {
  const [search, setSearch] = useState('')
  const q = search.toLowerCase()

  const filtered = q
    ? INSTRUMENTS.filter(i => i.name.toLowerCase().includes(q))
    : null

  return (
    <div style={{
      position: 'absolute', left: '100%', top: 0, marginLeft: 4,
      background: '#1e1e1e', border: '1px solid #444', borderRadius: 4,
      width: 220, maxHeight: 380, overflowY: 'auto',
      boxShadow: '2px 2px 12px rgba(0,0,0,0.5)', zIndex: 200,
    }}>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid #333' }}>
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && onClose()}
          placeholder="Search instruments…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#2d2d2d', border: '1px solid #555', borderRadius: 3,
            color: '#d4d4d4', padding: '3px 6px', fontSize: 12,
          }}
        />
      </div>

      {filtered ? (
        filtered.length === 0
          ? <div style={{ padding: '8px 10px', fontSize: 12, color: '#777' }}>No results</div>
          : filtered.map(inst => (
            <InstrumentRow key={inst.id} inst={inst} onSelect={onSelect} />
          ))
      ) : (
        INSTRUMENT_FAMILIES.map(family => {
          const items = INSTRUMENTS.filter(i => i.family === family)
          return (
            <div key={family}>
              <div style={{ padding: '4px 8px 2px', fontSize: 10, color: '#777', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {FAMILY_LABELS[family]}
              </div>
              {items.map(inst => <InstrumentRow key={inst.id} inst={inst} onSelect={onSelect} />)}
            </div>
          )
        })
      )}
    </div>
  )
}

function InstrumentRow({ inst, onSelect }: { inst: InstrumentDef; onSelect: (i: InstrumentDef) => void }): JSX.Element {
  return (
    <button
      onClick={() => onSelect(inst)}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        width: '100%', padding: '4px 10px', background: 'none',
        border: 'none', color: '#d4d4d4', fontSize: 12, cursor: 'pointer',
        textAlign: 'left',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#2d2d2d')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      <span>{inst.name}</span>
      {inst.transposeSemitones !== 0 && (
        <span style={{ fontSize: 10, color: '#888' }}>
          {inst.transposeSemitones > 0 ? `+${inst.transposeSemitones}` : inst.transposeSemitones}st
        </span>
      )}
    </button>
  )
}

// ── Part row ──────────────────────────────────────────────────────────────────

interface PartRowProps {
  partId: string
  name: string
  shortName: string
  labelVisible: boolean
  isFirst: boolean
  isLast: boolean
  canDelete: boolean
}

function PartRow({ partId, name, shortName, labelVisible, isFirst, isLast, canDelete }: PartRowProps): JSX.Element {
  const { dispatch } = useAppStore()
  const [expanded, setExpanded]           = useState(false)
  const [editName, setEditName]           = useState(name)
  const [editShort, setEditShort]         = useState(shortName)
  const [showInstPicker, setShowInstPicker] = useState(false)

  const commitName = () => {
    if (editName !== name || editShort !== shortName) {
      dispatch({ type: 'SET_PART_METADATA', partId, name: editName, shortName: editShort })
    }
  }

  const handleInstrumentSelect = (inst: InstrumentDef) => {
    setShowInstPicker(false)
    setEditName(inst.name)
    setEditShort(inst.shortName)
    // Change clef on the part's first staff (measure 0)
    const { score } = useAppStore.getState()
    const part  = score.parts.find(p => p.id === partId)
    const staff = part?.staves[0]
    const meas  = staff?.measures[0]
    if (meas && staff) {
      dispatch({ type: 'SET_CLEF', partId, staffId: staff.id, measureId: meas.id, clef: inst.defaultClef as ClefType })
    }
    dispatch({
      type: 'SET_PART_METADATA', partId,
      name:               inst.name,
      shortName:          inst.shortName,
      midiProgram:        inst.midiProgram,
      transposeSemitones: inst.transposeSemitones,
    })
  }

  return (
    <div style={{ borderBottom: '1px solid #333' }}>
      {/* collapsed row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '5px 8px', cursor: 'pointer',
      }}>
        <button
          onClick={() => setExpanded(x => !x)}
          style={{
            flex: 1, background: 'none', border: 'none', color: '#d4d4d4',
            fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: 0,
          }}
        >
          {expanded ? '▾' : '▸'} {name}
        </button>
        <button
          title="Move up"
          disabled={isFirst}
          onClick={() => dispatch({ type: 'MOVE_PART', partId, direction: 'up' })}
          style={iconBtn(isFirst)}
        >↑</button>
        <button
          title="Move down"
          disabled={isLast}
          onClick={() => dispatch({ type: 'MOVE_PART', partId, direction: 'down' })}
          style={iconBtn(isLast)}
        >↓</button>
        <button
          title="Delete part"
          disabled={!canDelete}
          onClick={() => { if (canDelete) dispatch({ type: 'DELETE_PART', partId }) }}
          style={iconBtn(!canDelete)}
        >✕</button>
      </div>

      {/* expanded controls */}
      {expanded && (
        <div style={{ padding: '4px 12px 10px', display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>

          {/* Instrument picker trigger */}
          <div>
            <label style={labelStyle}>Instrument</label>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowInstPicker(x => !x)}
                style={{
                  width: '100%', textAlign: 'left', padding: '3px 6px',
                  background: '#2d2d2d', border: '1px solid #555', borderRadius: 3,
                  color: '#d4d4d4', fontSize: 12, cursor: 'pointer',
                }}
              >
                {editName} ▾
              </button>
              {showInstPicker && (
                <InstrumentPicker
                  onSelect={handleInstrumentSelect}
                  onClose={() => setShowInstPicker(false)}
                />
              )}
            </div>
          </div>

          {/* Name */}
          <div>
            <label style={labelStyle}>Name</label>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => e.key === 'Enter' && commitName()}
              style={inputStyle}
            />
          </div>

          {/* Short name */}
          <div>
            <label style={labelStyle}>Short name</label>
            <input
              value={editShort}
              onChange={e => setEditShort(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => e.key === 'Enter' && commitName()}
              style={inputStyle}
            />
          </div>

          {/* Label visibility */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#bbb', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={labelVisible}
              onChange={e => dispatch({ type: 'SET_PART_METADATA', partId, labelVisible: e.target.checked })}
            />
            Show label on score
          </label>
        </div>
      )}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface PartsPanelProps {
  onClose: () => void
}

export function PartsPanel({ onClose }: PartsPanelProps): JSX.Element {
  const { score, dispatch } = useAppStore()
  const [showInstPicker, setShowInstPicker] = useState(false)

  const handleAddInstrument = (inst: InstrumentDef) => {
    setShowInstPicker(false)
    dispatch({
      type:               'ADD_PART',
      name:               inst.name,
      shortName:          inst.shortName,
      clef:               inst.defaultClef as ClefType,
      midiProgram:        inst.midiProgram,
      transposeSemitones: inst.transposeSemitones,
    })
  }

  return (
    <div style={{
      width: 200, flexShrink: 0,
      background: '#252526', borderRight: '1px solid #333',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', borderBottom: '1px solid #333',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#ccc' }}>Parts</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <label title="Show all labels" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#999', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={score.showPartLabels}
              onChange={e => dispatch({ type: 'SET_SCORE_SHOW_LABELS', visible: e.target.checked })}
            />
            Labels
          </label>
          <button onClick={onClose} style={{ ...iconBtn(false), fontSize: 14 }}>×</button>
        </div>
      </div>

      {/* Part list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {score.parts.map((part, idx) => (
          <PartRow
            key={part.id}
            partId={part.id}
            name={part.name}
            shortName={part.shortName}
            labelVisible={part.labelVisible}
            isFirst={idx === 0}
            isLast={idx === score.parts.length - 1}
            canDelete={score.parts.length > 1}
          />
        ))}
      </div>

      {/* Add part */}
      <div style={{ padding: 8, borderTop: '1px solid #333', position: 'relative' }}>
        <button
          onClick={() => setShowInstPicker(x => !x)}
          style={{
            width: '100%', padding: '5px 8px', fontSize: 12,
            background: '#0e639c', border: 'none', borderRadius: 3,
            color: '#fff', cursor: 'pointer',
          }}
        >
          + Add part
        </button>
        {showInstPicker && (
          <div style={{ position: 'absolute', bottom: '100%', left: 8, right: 8, marginBottom: 4 }}>
            <InstrumentPicker
              onSelect={handleAddInstrument}
              onClose={() => setShowInstPicker(false)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Micro styles ──────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, color: '#777',
  textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2,
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: '#2d2d2d', border: '1px solid #555', borderRadius: 3,
  color: '#d4d4d4', padding: '3px 6px', fontSize: 12,
}

function iconBtn(disabled: boolean): React.CSSProperties {
  return {
    background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    color: disabled ? '#444' : '#999', fontSize: 12, padding: '0 2px', lineHeight: 1,
  }
}
