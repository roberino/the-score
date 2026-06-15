import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import { v4 as uuid } from 'uuid'
import type { SequencePattern } from '@shared/score'
import { previewNote } from '../engine/notePreview'
import { midiOutputEngine } from '../engine/midiOutputEngine'
import { previewDrumHit } from '../engine/drumSamplerEngine'
import drumRhythmsRaw from '../../../resources/drumRhythms.json'

// ── Stock drum rhythms ────────────────────────────────────────────────────────

interface DrumRhythmCell { pitch: number; steps: number[] }
interface DrumRhythm {
  id: string
  name: string
  timeSig: { numerator: number; denominator: number }
  stepsPerBar: number
  cells: DrumRhythmCell[]
}

const ALL_DRUM_RHYTHMS = drumRhythmsRaw as DrumRhythm[]

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
  initialPatternId?: string | undefined
  onBack: () => void
}

export function SequenceEditor({ partId, initialPatternId, onBack }: SequenceEditorProps): JSX.Element {
  const { score, dispatch, dispatchSilent, pushUndoSnapshot, soundOnInput, audioMode } = useAppStore()
  const part = score.parts.find(p => p.id === partId)

  const previewCell = useCallback((midiPitch: number) => {
    if (!soundOnInput || !part) return
    const volDb    = 20 * Math.log10(Math.max(0.001, part.volume))
    const isDrum   = (part.midiChannel ?? 1) === 10
    if (audioMode === 'midi-out') {
      const channel = (part.midiChannel ?? 1) - 1
      midiOutputEngine.previewNote(midiPitch, 100, channel, part.midiProgram)
    } else if (isDrum) {
      previewDrumHit(midiPitch, volDb)
    } else {
      const hz = 440 * Math.pow(2, (midiPitch - 69) / 12)
      void previewNote(hz, volDb, false)
    }
  }, [soundOnInput, audioMode, part])

  const isDrum  = part ? (part.midiChannel === 10) : false
  const patterns = part?.sequencePatterns ?? []

  const timeSig     = score.timeSignature
  const stepsPerBar = Math.round((timeSig.numerator / timeSig.denominator) * 16)

  // Current pattern index
  const [patternIdx, setPatternIdx] = useState<number>(() => {
    if (initialPatternId) {
      const idx = patterns.findIndex(p => p.id === initialPatternId)
      return idx >= 0 ? idx : 0
    }
    return patterns.length > 0 ? 0 : -1
  })

  // Sync patternIdx after initial pattern creation
  useEffect(() => {
    const pts = score.parts.find(p => p.id === partId)?.sequencePatterns ?? []
    if (pts.length > 0 && patternIdx === -1) setPatternIdx(0)
  }, [score, partId])

  // Create first pattern if none exist
  useEffect(() => {
    const currentPatterns = useAppStore.getState().score.parts.find(p => p.id === partId)?.sequencePatterns ?? []
    if (currentPatterns.length > 0) return
    createNewPattern()
  }, [partId])

  function createNewPattern(): void {
    if (!part) return
    const patternId = uuid()
    const steps: { pitch: number; velocity: number }[][] = Array.from({ length: stepsPerBar }, () => [])
    const pattern: SequencePattern = { id: patternId, steps, stepsPerBar }
    dispatch({ type: 'UPSERT_SEQUENCE_PATTERN', partId, pattern })
  }

  // Editable label
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft]     = useState('')

  // Drag-to-fill
  const dragRef = useRef<{ on: boolean } | null>(null)

  // Stock rhythm picker
  const [rhythmPickerOpen, setRhythmPickerOpen] = useState(false)
  const [pendingRhythm, setPendingRhythm] = useState<DrumRhythm | null>(null)

  const compatibleRhythms = ALL_DRUM_RHYTHMS.filter(
    r => r.timeSig.numerator === timeSig.numerator && r.timeSig.denominator === timeSig.denominator
  )

  const currentPattern = patternIdx >= 0 ? patterns[patternIdx] ?? null : null

  const patternHasCells = currentPattern?.steps.some(col => col.length > 0) ?? false

  // Pre-computed O(1) cell lookup — avoids .some() scan on every cell render.
  const committedCellSet = useMemo(() => {
    const s = new Set<string>()
    if (!currentPattern) return s
    currentPattern.steps.forEach((col, step) => col.forEach(c => s.add(`${step}_${c.pitch}`)))
    return s
  }, [currentPattern])

  // Local pending cells during drag — written to the store only on mouseup.
  // This prevents store updates (and re-renders of ScoreCanvas) on every cell hover.
  const pendingCellsRef = useRef<Map<string, boolean>>(new Map())
  const [, setDragTick] = useState(0)

  function applyRhythm(rhythm: DrumRhythm): void {
    if (!currentPattern) return
    pushUndoSnapshot()
    const cleared: SequencePattern = {
      ...currentPattern,
      label: rhythm.name,
      steps: Array.from({ length: currentPattern.stepsPerBar }, () => []),
    }
    dispatch({ type: 'UPSERT_SEQUENCE_PATTERN', partId, pattern: cleared })
    for (const cell of rhythm.cells) {
      for (const step of cell.steps) {
        dispatchSilent({ type: 'SET_SEQUENCE_CELL', partId, patternId: currentPattern.id, step, pitch: cell.pitch, on: true })
      }
    }
    setPendingRhythm(null)
    setRhythmPickerOpen(false)
  }

  const handleCellMouseDown = useCallback((step: number, pitch: number, currentlyOn: boolean) => {
    if (!currentPattern) return
    pushUndoSnapshot()
    const turningOn = !currentlyOn
    dragRef.current = { on: turningOn }
    pendingCellsRef.current = new Map([[`${step}_${pitch}`, turningOn]])
    setDragTick(t => t + 1)
    if (turningOn) previewCell(pitch)
  }, [currentPattern, pushUndoSnapshot, previewCell])

  const handleCellMouseEnter = useCallback((step: number, pitch: number) => {
    if (!dragRef.current || !currentPattern) return
    const key = `${step}_${pitch}`
    const already = pendingCellsRef.current.get(key)
    if (already === dragRef.current.on) return
    pendingCellsRef.current.set(key, dragRef.current.on)
    setDragTick(t => t + 1)
    if (dragRef.current.on) previewCell(pitch)
  }, [currentPattern, previewCell])

  useEffect(() => {
    const up = () => {
      if (!dragRef.current) return
      dragRef.current = null
      if (pendingCellsRef.current.size === 0) return
      const pending = pendingCellsRef.current
      pendingCellsRef.current = new Map()
      const patId = currentPattern?.id
      if (!patId) return
      // Flush all pending cells to the store in one synchronous burst on mouseup.
      for (const [key, on] of pending) {
        const [step, pitch] = key.split('_').map(Number)
        dispatchSilent({ type: 'SET_SEQUENCE_CELL', partId, patternId: patId, step, pitch, on })
      }
    }
    document.addEventListener('mouseup', up)
    return () => document.removeEventListener('mouseup', up)
  }, [currentPattern, partId, dispatchSilent])

  useEffect(() => {
    if (!rhythmPickerOpen) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-rhythm-picker]')) setRhythmPickerOpen(false)
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', close), 0)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', close) }
  }, [rhythmPickerOpen])

  if (!part) return <div style={{ color: '#d4d4d4', padding: 20 }}>Part not found.</div>

  const rows = isDrum ? DRUM_NOTES : buildPianoRows(PIANO_LO, PIANO_HI)

  function isCellOn(step: number, pitch: number): boolean {
    const key = `${step}_${pitch}`
    const pending = pendingCellsRef.current.get(key)
    if (pending !== undefined) return pending
    return committedCellSet.has(key)
  }

  const isFirstPattern = patternIdx <= 0
  const isLastPattern  = patternIdx >= patterns.length - 1
  const defaultLabel   = `Sequence ${patternIdx + 1}`

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        background: '#1e1e1e', color: '#d4d4d4', overflow: 'hidden',
        userSelect: 'none', position: 'relative',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 14px', borderBottom: '1px solid #333', flexShrink: 0,
        background: '#252526',
      }}>
        <button onClick={onBack} style={{ ...btnStyle, paddingLeft: 0 }}>
          ← Back to Score
        </button>

        <span style={{ fontSize: 13, fontWeight: 600, color: '#ccc' }}>{part.name}</span>

        <span style={{ color: '#555' }}>|</span>

        {/* Pattern label (editable) */}
        {editingLabel ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={e => setLabelDraft(e.target.value)}
            onBlur={() => {
              setEditingLabel(false)
              if (currentPattern) {
                const trimmed = labelDraft.trim()
                const updated = { ...currentPattern }
                if (trimmed) updated.label = trimmed
                else delete (updated as any).label
                dispatch({ type: 'UPSERT_SEQUENCE_PATTERN', partId, pattern: updated })
              }
            }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingLabel(false) }}
            style={{
              background: '#2d2d2d', border: '1px solid #555', borderRadius: 3,
              color: '#d4d4d4', padding: '2px 6px', fontSize: 12,
            }}
          />
        ) : (
          <span
            onClick={() => { setEditingLabel(true); setLabelDraft(currentPattern?.label ?? '') }}
            style={{ fontSize: 12, color: '#aaa', cursor: 'pointer', borderBottom: '1px dashed #555', paddingBottom: 1 }}
            title="Click to rename"
          >
            {currentPattern?.label || defaultLabel}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {/* Pattern navigation */}
        <button
          disabled={isFirstPattern}
          onClick={() => setPatternIdx(i => i - 1)}
          style={isFirstPattern ? disabledBtnStyle : btnStyle}
        >‹ Prev</button>

        <button
          disabled={isLastPattern}
          onClick={() => setPatternIdx(i => i + 1)}
          style={isLastPattern ? disabledBtnStyle : btnStyle}
        >Next ›</button>

        <button
          onClick={() => {
            createNewPattern()
            setPatternIdx(patterns.length)
          }}
          style={btnStyle}
        >+ New Sequence</button>

        {/* Load rhythm button — drum parts only, when compatible rhythms exist */}
        {isDrum && compatibleRhythms.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setRhythmPickerOpen(o => !o)}
              style={btnStyle}
            >Load rhythm…</button>
            {rhythmPickerOpen && (
              <div
                data-rhythm-picker=""
                style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 4,
                  background: '#252526', border: '1px solid #444', borderRadius: 6,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)', zIndex: 100,
                  minWidth: 160, fontSize: 12, color: '#ccc', overflow: 'hidden',
                }}
              >
                {compatibleRhythms.map(r => (
                  <div
                    key={r.id}
                    onClick={() => {
                      setRhythmPickerOpen(false)
                      if (patternHasCells) { setPendingRhythm(r) } else { applyRhythm(r) }
                    }}
                    style={{ padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {r.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmation overlay — replace non-empty pattern */}
      {pendingRhythm && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.55)',
        }}>
          <div style={{
            background: '#252526', border: '1px solid #444', borderRadius: 8,
            padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', fontSize: 13, color: '#d4d4d4',
          }}>
            <span>Replace current pattern with <strong>{pendingRhythm.name}</strong>?</span>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setPendingRhythm(null)} style={cancelBtnStyle}>Cancel</button>
              <button onClick={() => applyRhythm(pendingRhythm)} style={confirmBtnStyle}>Replace</button>
            </div>
          </div>
        </div>
      )}

      {/* Grid area — single scroll container so labels and cells scroll together */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {currentPattern ? (
          <div style={{ display: 'inline-block', minWidth: '100%' }}>
            {/* Header row: corner + beat numbers */}
            <div style={{ display: 'flex', height: HEADER_H, position: 'sticky', top: 0, zIndex: 3, background: '#1a1a1a', borderBottom: '1px solid #333' }}>
              {/* Corner — sticks to both top and left */}
              <div style={{ width: LABEL_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 4, background: '#1a1a1a', borderRight: '1px solid #333' }} />
              {Array.from({ length: stepsPerBar }, (_, step) => {
                const beat       = Math.floor(step / 4) + 1
                const sub        = step % 4
                const isDownbeat = sub === 0
                return (
                  <div
                    key={step}
                    style={{
                      width: CELL_W, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: isDownbeat ? '#ccc' : '#555',
                      borderRight: `1px solid ${isDownbeat ? '#444' : '#2a2a2a'}`,
                      boxSizing: 'border-box', fontWeight: isDownbeat ? 600 : 400,
                    }}
                  >
                    {isDownbeat ? beat : sub === 2 ? '+' : ''}
                  </div>
                )
              })}
            </div>

            {/* Content rows: sticky label + step cells */}
            {rows.map(pitch => {
              const label   = isDrum ? GM_DRUM_LABELS[pitch] : midiToNoteName(pitch)
              const isBlack = !isDrum && IS_BLACK[pitch % 12]
              const isC     = !isDrum && pitch % 12 === 0
              return (
                <div key={pitch} style={{ display: 'flex', height: CELL_H }}>
                  {/* Sticky label */}
                  <div style={{
                    width: LABEL_W, flexShrink: 0,
                    position: 'sticky', left: 0, zIndex: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    paddingRight: 8, fontSize: 10,
                    color: isC ? '#fff' : isBlack ? '#aaa' : '#888',
                    background: isC ? '#2a2a2a' : isBlack ? '#222' : '#1a1a1a',
                    borderBottom: '1px solid #2a2a2a', borderRight: '1px solid #333',
                    boxSizing: 'border-box', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {label}
                  </div>
                  {/* Step cells */}
                  {Array.from({ length: stepsPerBar }, (_, step) => {
                    const on         = isCellOn(step, pitch)
                    const isDownbeat = step % 4 === 0
                    return (
                      <div
                        key={step}
                        onMouseDown={() => handleCellMouseDown(step, pitch, on)}
                        onMouseEnter={() => handleCellMouseEnter(step, pitch)}
                        style={{
                          width: CELL_W, flexShrink: 0, boxSizing: 'border-box',
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
              )
            })}
          </div>
        ) : (
          <div style={{ padding: 40, color: '#555', fontSize: 13 }}>
            No sequences yet. Click "+ New Sequence" to create one.
          </div>
        )}
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

const cancelBtnStyle: React.CSSProperties = {
  padding: '4px 14px', borderRadius: 4, border: '1px solid #555',
  background: '#2d2d2d', color: '#ccc', fontSize: 12, cursor: 'pointer',
}

const confirmBtnStyle: React.CSSProperties = {
  ...cancelBtnStyle, background: '#0e639c', border: '1px solid #0e639c', color: '#fff',
}
