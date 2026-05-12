import { useState, useRef } from 'react'
import { useAppStore, type InputMode } from '../store/appStore'
import { DURATION_LABELS, KEY_TO_DURATION, resolveTimeSig } from '@shared/musicUtils'
import type { Duration, TimeSignature } from '@shared/score'
import { TimeSignaturePicker } from './TimeSignaturePicker'

const MODES: { mode: InputMode; label: string; key: string }[] = [
  { mode: 'select', label: 'Select', key: 'S' },
  { mode: 'note',   label: 'Note',   key: 'N' },
  { mode: 'rest',   label: 'Rest',   key: 'R' },
  { mode: 'eraser', label: 'Eraser', key: 'E' }
]

const DURATION_BUTTONS: { duration: Duration; key: string }[] = Object.entries(KEY_TO_DURATION)
  .map(([key, duration]) => ({ key, duration }))
  .sort((a, b) => Number(a.key) - Number(b.key))

export function Toolbar(): JSX.Element {
  const {
    inputMode, setInputMode,
    undo, redo, isPlaying, setPlaying,
    undoStack, redoStack,
    selectedDuration, setSelectedDuration,
    isDotted, toggleDot,
    score, cursorMeasureId, dispatch,
  } = useAppStore()

  const [timeSigPickerPos, setTimeSigPickerPos] = useState<{ x: number; y: number } | null>(null)
  const timeSigBtnRef = useRef<HTMLButtonElement>(null)

  // Resolve the display time sig: cursor measure's effective sig, else score default
  const displayTimeSig: TimeSignature = (() => {
    if (!cursorMeasureId) return score.timeSignature
    for (const part of score.parts) {
      for (const staff of part.staves) {
        const idx = staff.measures.findIndex(m => m.id === cursorMeasureId)
        if (idx !== -1) return resolveTimeSig(staff.measures, idx, score.timeSignature)
      }
    }
    return score.timeSignature
  })()

  const handleTimeSigClick = () => {
    const btn = timeSigBtnRef.current
    if (!btn) return
    if (timeSigPickerPos) { setTimeSigPickerPos(null); return }
    const rect = btn.getBoundingClientRect()
    setTimeSigPickerPos({ x: rect.left, y: rect.bottom + 4 })
  }

  const handleTimeSigSelect = (sig: TimeSignature) => {
    dispatch({ type: 'SET_SCORE_TIME', time: sig })
    setTimeSigPickerPos(null)
  }

  const showDurationRow = inputMode === 'note' || inputMode === 'rest' || inputMode === 'select'

  return (
    <div style={{
      background: '#2d2d2d',
      borderBottom: '1px solid #3e3e3e',
      paddingLeft: window.electronAPI.platform === 'darwin' ? 80 : 12,
    }}>

      {/* ── Top row: mode + undo/redo + playback ── */}
      <div style={{
        height: 44,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        paddingLeft: 0,
        gap: 8,
      }}>

        {/* Input modes */}
        <div style={{ display: 'flex', gap: 2, background: '#1e1e1e', borderRadius: 4, padding: 2 }}>
          {MODES.map(({ mode, label, key }) => (
            <button
              key={mode}
              onClick={() => setInputMode(mode)}
              title={`${label} (${key})`}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                borderRadius: 3,
                border: 'none',
                cursor: 'pointer',
                background: inputMode === mode ? '#0e639c' : 'transparent',
                color: inputMode === mode ? '#fff' : '#9d9d9d',
                transition: 'background 0.1s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: '#3e3e3e' }} />

        <ToolbarButton onClick={undo} disabled={undoStack.length === 0} title="Undo (⌘Z)"  label="↩ Undo" />
        <ToolbarButton onClick={redo} disabled={redoStack.length === 0} title="Redo (⌘⇧Z)" label="↪ Redo" />

        <div style={{ width: 1, height: 24, background: '#3e3e3e' }} />

        <ToolbarButton
          onClick={() => setPlaying(!isPlaying)}
          title={isPlaying ? 'Stop (Space)' : 'Play (Space)'}
          label={isPlaying ? '⏹ Stop' : '▶ Play'}
          accent={isPlaying}
        />

        <div style={{ width: 1, height: 24, background: '#3e3e3e' }} />

        <button
          ref={timeSigBtnRef}
          onClick={handleTimeSigClick}
          title="Time signature"
          style={{
            padding: '4px 10px', fontSize: 12, borderRadius: 3, border: 'none',
            cursor: 'pointer', background: timeSigPickerPos ? '#0e639c' : 'transparent',
            color: timeSigPickerPos ? '#fff' : '#9d9d9d',
          }}
        >
          {displayTimeSig.numerator}/{displayTimeSig.denominator}
        </button>
      </div>

      {timeSigPickerPos && (
        <TimeSignaturePicker
          current={displayTimeSig}
          screenX={timeSigPickerPos.x}
          screenY={timeSigPickerPos.y}
          onClose={() => setTimeSigPickerPos(null)}
          onSelect={handleTimeSigSelect}
        />
      )}

      {/* ── Duration row ── */}
      {showDurationRow && (
        <div style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          paddingLeft: 0,
          gap: 4,
          borderTop: '1px solid #3e3e3e',
        }}>
          <span style={{ fontSize: 11, color: '#777', marginRight: 4 }}>Duration:</span>
          {DURATION_BUTTONS.map(({ duration, key }) => (
            <button
              key={duration}
              onClick={() => setSelectedDuration(duration)}
              title={`${DURATION_LABELS[duration]} (${key})`}
              style={{
                padding: '3px 8px',
                fontSize: 11,
                borderRadius: 3,
                border: 'none',
                cursor: 'pointer',
                background: selectedDuration === duration ? '#0e639c' : '#1e1e1e',
                color: selectedDuration === duration ? '#fff' : '#9d9d9d',
                transition: 'background 0.1s',
              }}
            >
              {DURATION_LABELS[duration]}
            </button>
          ))}

          <div style={{ width: 1, height: 20, background: '#3e3e3e', margin: '0 4px' }} />

          <button
            onClick={toggleDot}
            title="Dotted (·)"
            style={{
              padding: '3px 8px',
              fontSize: 11,
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              background: isDotted ? '#0e639c' : '#1e1e1e',
              color: isDotted ? '#fff' : '#9d9d9d',
              transition: 'background 0.1s',
            }}
          >
            · Dot
          </button>
        </div>
      )}
    </div>
  )
}

function ToolbarButton({
  onClick,
  disabled = false,
  title,
  label,
  accent = false,
}: {
  onClick: () => void
  disabled?: boolean
  title: string
  label: string
  accent?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: '4px 10px',
        fontSize: 12,
        borderRadius: 3,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: accent ? '#1a8a1a' : 'transparent',
        color: disabled ? '#555' : accent ? '#fff' : '#9d9d9d',
        transition: 'background 0.1s',
      }}
    >
      {label}
    </button>
  )
}
