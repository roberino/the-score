import { useState, useRef, useCallback, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { v4 as uuid } from 'uuid'
import type { SequencePattern, SequenceRegion } from '@shared/score'
import { previewNote } from '../engine/notePreview'
import { midiOutputEngine } from '../engine/midiOutputEngine'

// ── GM Percussion labels (MIDI notes 35–81) ───────────────────────────────────

const GM_DRUM_LABELS: Record<number, string> = {
  35: 'Bass Drum 2',    36: 'Bass Drum 1',    37: 'Side Stick',
  38: 'Snare 1',        39: 'Hand Clap',       40: 'Snare 2',
  41: 'Low Floor Tom',  42: 'Closed Hi-Hat',   43: 'High Floor Tom',
  44: 'Pedal Hi-Hat',   45: 'Low Tom',         46: 'Open Hi-Hat',
  47: 'Low-Mid Tom',    48: 'High-Mid Tom',    49: 'Crash Cymbal 1',
  50: 'High Tom',       51: 'Ride Cymbal 1',   52: 'Chinese Cymbal',
  53: 'Ride Bell',      54: 'Tambourine',      55: 'Splash Cymbal',
  56: 'Cowbell',        57: 'Crash Cymbal 2',  58: 'Vibraslap',
  59: 'Ride Cymbal 2',  60: 'High Bongo',      61: 'Low Bongo',
  62: 'Mute High Conga',63: 'Open High Conga', 64: 'Low Conga',
  65: 'High Timbale',   66: 'Low Timbale',     67: 'High Agogo',
  68: 'Low Agogo',      69: 'Cabasa',          70: 'Maracas',
  71: 'Short Whistle',  72: 'Long Whistle',    73: 'Short Guiro',
  74: 'Long Guiro',     75: 'Claves',          76: 'High Wood Block',
  77: 'Low Wood Block', 78: 'Mute Cuica',      79: 'Open Cuica',
  80: 'Mute Triangle',  81: 'Open Triangle',
}

const DRUM_NOTES = Object.keys(GM_DRUM_LABELS).map(Number).reverse()  // high → low

// ── Piano keyboard helpers ────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const IS_BLACK   = [false, true, false, true, false, false, true, false, true, false, true, false]

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1
  return NOTE_NAMES[midi % 12] + octave
}

function buildPianoRows(loMidi: number, hiMidi: number): number[] {
  const rows: number[] = []
  for (let m = hiMidi; m >= loMidi; m--) rows.push(m)
  return rows
}

const PIANO_LO = 36   // C2
const PIANO_HI = 83   // B5

// ── Styles ────────────────────────────────────────────────────────────────────

const CELL_W = 28
const CELL_H = 18
const LABEL_W = 110
const HEADER_H = 26

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SequenceEditorProps {
  partId: string
  onBack: () => void
}

export function SequenceEditor({ partId, onBack }: SequenceEditorProps): JSX.Element {
  const { score, dispatch, dispatchSilent, pushUndoSnapshot, soundOnInput, audioMode } = useAppStore()
  const part = score.parts.find(p => p.id === partId)

  const previewCell = useCallback((midiPitch: number) => {
    if (!soundOnInput || !part) return
    const volDb = 20 * Math.log10(Math.max(0.001, part.volume))
    if (audioMode === 'midi-out') {
      const channel = (part.midiChannel ?? 1) - 1
      midiOutputEngine.previewNote(midiPitch, 100, channel, part.midiProgram)
    } else {
      const hz = 440 * Math.pow(2, (midiPitch - 69) / 12)
      void previewNote(hz, volDb, false)
    }
  }, [soundOnInput, audioMode, part])

  // Determine if drum part (channel 10 or midiProgram 0 on ch 10)
  const isDrum = part ? (part.midiChannel === 10) : false

  const regions  = (part?.sequenceRegions ?? []).slice().sort((a, b) => a.startMeasureIndex - b.startMeasureIndex)
  const patterns = part?.sequencePatterns ?? []

  // Current region index (which sequence region we're editing)
  const [regionIdx, setRegionIdx] = useState<number>(() => {
    // Start on first region, or -1 if none (will create one)
    return regions.length > 0 ? 0 : -1
  })

  // Current region and pattern (may be null if no regions yet)
  const currentRegion  = regionIdx >= 0 ? regions[regionIdx] : null
  const currentPattern = currentRegion ? patterns.find(p => p.id === currentRegion.patternId) ?? null : null

  // Compute stepsPerBar from score time signature
  const timeSig     = score.timeSignature
  const stepsPerBar = Math.round((timeSig.numerator / timeSig.denominator) * 16)

  // Editable label
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft]     = useState('')

  // Create first region+pattern if no regions exist
  useEffect(() => {
    if (!part || regions.length > 0) return
    createNewRegion(0)
  }, [partId])

  // Sync regionIdx when regions change (e.g. after initial creation)
  useEffect(() => {
    const updatedRegions = (score.parts.find(p => p.id === partId)?.sequenceRegions ?? [])
      .slice().sort((a, b) => a.startMeasureIndex - b.startMeasureIndex)
    if (updatedRegions.length > 0 && regionIdx === -1) setRegionIdx(0)
  }, [score, partId])

  function createNewRegion(startMeasureIndex: number): void {
    if (!part) return
    const patternId = uuid()
    const steps: { pitch: number; velocity: number }[][] = Array.from({ length: stepsPerBar }, () => [])
    const pattern: SequencePattern = { id: patternId, steps, stepsPerBar }
    const region: SequenceRegion   = { id: uuid(), patternId, startMeasureIndex, repetitions: null }
    dispatch({ type: 'UPSERT_SEQUENCE_PATTERN', partId, pattern })
    dispatch({ type: 'UPSERT_SEQUENCE_REGION',  partId, region })
  }

  // Drag-to-fill: apply changes silently (no undo snapshot per cell), flush on mouseup
  const dragRef = useRef<{ on: boolean } | null>(null)

  const handleCellMouseDown = useCallback((step: number, pitch: number, currentlyOn: boolean) => {
    if (!currentPattern) return
    pushUndoSnapshot()
    const turningOn = !currentlyOn
    dragRef.current = { on: turningOn }
    dispatchSilent({ type: 'SET_SEQUENCE_CELL', partId, patternId: currentPattern.id, step, pitch, on: turningOn })
    if (turningOn) previewCell(pitch)
  }, [currentPattern, partId, dispatchSilent, pushUndoSnapshot, previewCell])

  const handleCellMouseEnter = useCallback((step: number, pitch: number) => {
    if (!dragRef.current || !currentPattern) return
    dispatchSilent({ type: 'SET_SEQUENCE_CELL', partId, patternId: currentPattern.id, step, pitch, on: dragRef.current.on })
    if (dragRef.current.on) previewCell(pitch)
  }, [currentPattern, partId, dispatchSilent, previewCell])

  useEffect(() => {
    const up = () => { dragRef.current = null }
    document.addEventListener('mouseup', up)
    return () => document.removeEventListener('mouseup', up)
  }, [])

  // Reps control
  const handleSetReps = useCallback((reps: number | null) => {
    if (!currentRegion) return
    dispatch({ type: 'UPSERT_SEQUENCE_REGION', partId, region: { ...currentRegion, repetitions: reps } })
  }, [currentRegion, partId, dispatch])

  if (!part) return <div style={{ color: '#d4d4d4', padding: 20 }}>Part not found.</div>

  const rows = isDrum ? DRUM_NOTES : buildPianoRows(PIANO_LO, PIANO_HI)

  const effectiveRegion  = currentRegion
  const effectivePattern = currentPattern

  function isCellOn(step: number, pitch: number): boolean {
    if (!effectivePattern?.steps[step]) return false
    return effectivePattern.steps[step].some(c => c.pitch === pitch)
  }

  const isFirstRegion = regionIdx <= 0
  const isLastRegion  = regionIdx >= regions.length - 1

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        background: '#1e1e1e', color: '#d4d4d4', overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 14px', borderBottom: '1px solid #333', flexShrink: 0,
        background: '#252526',
      }}>
        <button
          onClick={onBack}
          style={{ ...btnStyle, paddingLeft: 0 }}
        >
          ← Back to Score
        </button>

        <span style={{ fontSize: 13, fontWeight: 600, color: '#ccc' }}>{part.name}</span>

        <span style={{ color: '#555' }}>|</span>

        {/* Sequence label (editable) */}
        {editingLabel ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={e => setLabelDraft(e.target.value)}
            onBlur={() => {
              setEditingLabel(false)
              if (effectiveRegion) {
                const trimmed = labelDraft.trim()
                const updated = { ...effectiveRegion }
                if (trimmed) updated.label = trimmed
                else delete (updated as any).label
                dispatch({ type: 'UPSERT_SEQUENCE_REGION', partId, region: updated })
              }
            }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { setEditingLabel(false) } }}
            style={{
              background: '#2d2d2d', border: '1px solid #555', borderRadius: 3,
              color: '#d4d4d4', padding: '2px 6px', fontSize: 12,
            }}
          />
        ) : (
          <span
            onClick={() => { setEditingLabel(true); setLabelDraft(effectiveRegion?.label ?? '') }}
            style={{ fontSize: 12, color: '#aaa', cursor: 'pointer', borderBottom: '1px dashed #555', paddingBottom: 1 }}
            title="Click to rename"
          >
            {effectiveRegion?.label || `Sequence ${regionIdx + 1}`}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {/* Region navigation */}
        <button
          disabled={isFirstRegion}
          onClick={() => setRegionIdx(i => i - 1)}
          style={isFirstRegion ? disabledBtnStyle : btnStyle}
        >‹ Prev</button>

        <button
          disabled={isLastRegion}
          onClick={() => setRegionIdx(i => i + 1)}
          style={isLastRegion ? disabledBtnStyle : btnStyle}
        >Next ›</button>

        <button
          onClick={() => {
            const nextStart = (regions[regions.length - 1]?.startMeasureIndex ?? -1) + 1
            createNewRegion(nextStart)
            setRegionIdx(regions.length)
          }}
          style={btnStyle}
        >+ New Sequence</button>

        {/* Reps */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
          <span style={{ fontSize: 11, color: '#888' }}>Reps:</span>
          {[null, 1, 2, 4, 8].map(r => (
            <button
              key={r ?? 'inf'}
              onClick={() => handleSetReps(r)}
              style={{
                ...btnStyle,
                padding: '2px 7px',
                background: (effectiveRegion?.repetitions ?? null) === r ? '#0e639c' : '#2d2d2d',
                borderRadius: 3,
                border: '1px solid #555',
              }}
            >
              {r === null ? '∞' : r}
            </button>
          ))}
        </div>
      </div>

      {/* Grid area */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex' }}>
        {/* Left: label column */}
        <div style={{ flexShrink: 0, borderRight: '1px solid #333', background: '#1a1a1a' }}>
          {/* Corner spacer above column headers */}
          <div style={{ height: HEADER_H, width: LABEL_W, borderBottom: '1px solid #333' }} />

          {/* Row labels */}
          {rows.map(pitch => {
            const label = isDrum ? GM_DRUM_LABELS[pitch] : midiToNoteName(pitch)
            const isBlack = !isDrum && IS_BLACK[pitch % 12]
            const isC     = !isDrum && pitch % 12 === 0
            return (
              <div
                key={pitch}
                style={{
                  height: CELL_H,
                  width: LABEL_W,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingRight: 8,
                  fontSize: 10,
                  color: isC ? '#fff' : isBlack ? '#aaa' : '#888',
                  background: isC ? '#2a2a2a' : isBlack ? '#222' : '#1a1a1a',
                  borderBottom: '1px solid #2a2a2a',
                  boxSizing: 'border-box',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {label}
              </div>
            )
          })}
        </div>

        {/* Right: grid */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {effectivePattern ? (
            <div style={{ display: 'inline-block', minWidth: '100%' }}>
              {/* Column headers */}
              <div style={{ display: 'flex', height: HEADER_H, borderBottom: '1px solid #333', background: '#1a1a1a', position: 'sticky', top: 0, zIndex: 2 }}>
                {Array.from({ length: stepsPerBar }, (_, step) => {
                  const beat = Math.floor(step / 4) + 1
                  const sub  = step % 4
                  const isDownbeat = sub === 0
                  return (
                    <div
                      key={step}
                      style={{
                        width: CELL_W,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        color: isDownbeat ? '#ccc' : '#555',
                        borderRight: `1px solid ${isDownbeat ? '#444' : '#2a2a2a'}`,
                        boxSizing: 'border-box',
                        fontWeight: isDownbeat ? 600 : 400,
                      }}
                    >
                      {isDownbeat ? beat : sub === 2 ? '+' : ''}
                    </div>
                  )
                })}
              </div>

              {/* Cell rows */}
              {rows.map(pitch => (
                <div key={pitch} style={{ display: 'flex', height: CELL_H }}>
                  {Array.from({ length: stepsPerBar }, (_, step) => {
                    const on = isCellOn(step, pitch)
                    const beat = step % 4
                    const isDownbeat = beat === 0
                    return (
                      <div
                        key={step}
                        onMouseDown={() => handleCellMouseDown(step, pitch, on)}
                        onMouseEnter={() => handleCellMouseEnter(step, pitch)}
                        style={{
                          width: CELL_W,
                          flexShrink: 0,
                          boxSizing: 'border-box',
                          background: on ? '#3b9ddd' : 'rgba(255,255,255,0.03)',
                          borderRight: `1px solid ${isDownbeat ? '#3a3a3a' : '#2a2a2a'}`,
                          borderBottom: '1px solid #2a2a2a',
                          cursor: 'pointer',
                          transition: on ? undefined : 'background 0.05s',
                        }}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 40, color: '#555', fontSize: 13 }}>
              No sequence pattern. Click "+ New Sequence" to create one.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Micro styles ──────────────────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#aaa', fontSize: 12,
  cursor: 'pointer', padding: '3px 8px',
}

const disabledBtnStyle: React.CSSProperties = {
  ...btnStyle, color: '#444', cursor: 'not-allowed',
}
