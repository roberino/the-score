import { useState, useRef } from 'react'
import { useAppStore, type InputMode } from '../store/appStore'
import { DURATION_LABELS, KEY_TO_DURATION, resolveTimeSig, resolveKeySig, keyLabel, measureCapacityUnits, usedUnits } from '@shared/musicUtils'
import type { Duration, TimeSignature, KeySignature } from '@shared/score'
import { TimeSignaturePicker } from './TimeSignaturePicker'
import { CircleOfFifths } from './CircleOfFifths'
import { AudioSettingsPanel } from './AudioSettingsPanel'
import { MidiInputPanel } from './MidiInputPanel'

const NOTE_CHARS: Record<Duration, string> = {
  whole:   '\u{1D15D}',                            // whole note
  half:    '\u{1D157}\u{1D165}',                   // void notehead + stem
  quarter: '\u{1D158}\u{1D165}',                   // black notehead + stem
  eighth:  '\u{1D158}\u{1D165}\u{1D16E}',          // black notehead + stem + 1 flag
  '16th':  '\u{1D158}\u{1D165}\u{1D16F}',          // + 2 flags
  '32nd':  '\u{1D158}\u{1D165}\u{1D170}',          // + 3 flags
  '64th':  '\u{1D158}\u{1D165}\u{1D171}',          // + 4 flags
}

const REST_CHARS: Record<Duration, string> = {
  whole:   '\u{1D13B}', // 𝄻
  half:    '\u{1D13C}', // 𝄼
  quarter: '\u{1D13D}', // 𝄽
  eighth:  '\u{1D13E}', // 𝄾
  '16th':  '\u{1D13F}', // 𝄿
  '32nd':  '\u{1D140}', // 𝅀
  '64th':  '\u{1D141}', // 𝅁
}

function DurationIcon({ duration, isRest }: { duration: Duration; isRest: boolean }): JSX.Element {
  const char = isRest ? REST_CHARS[duration] : NOTE_CHARS[duration]
  return (
    <span style={{ fontSize: 18, lineHeight: 1, fontFamily: "'NotoMusic', serif" }}>
      {char}
    </span>
  )
}

const MODES: { mode: InputMode; label: string; key: string }[] = [
  { mode: 'select', label: 'Select', key: 'S' },
  { mode: 'note',   label: 'Note',   key: 'N' },
  { mode: 'rest',   label: 'Rest',   key: 'R' },
  { mode: 'text',   label: 'Marks',  key: 'T' },
  { mode: 'lyric',  label: 'Lyric',  key: 'L' },
  { mode: 'midi',   label: 'MIDI',   key: 'M' },
]

const DURATION_BUTTONS: { duration: Duration; key: string }[] = Object.entries(KEY_TO_DURATION)
  .map(([key, duration]) => ({ key, duration }))
  .sort((a, b) => Number(a.key) - Number(b.key))


interface ToolbarProps {
  onTogglePartsPanel: () => void
  partsPanelOpen: boolean
}

export function Toolbar({ onTogglePartsPanel, partsPanelOpen }: ToolbarProps): JSX.Element {
  const {
    inputMode, setInputMode,
    undo, redo, isPlaying, startPlayback, stopPlayback,
    undoStack, redoStack,
    selectedDuration,
    isDotted, toggleDot, resizeNote,
    activeVoice, setActiveVoice,
    score, cursorMeasureId, dispatch,
    keyboardVisible, toggleKeyboard,
    soundOnInput, toggleSoundOnInput,
    audioMode,
    midiInputDeviceId, midiInputDeviceName,
    selectedMeasureId,
    insertMeasure,
  } = useAppStore()

  const [timeSigError, setTimeSigError] = useState<string | null>(null)

  const [audioSettingsPos, setAudioSettingsPos] = useState<{ x: number; y: number } | null>(null)
  const audioSettingsBtnRef = useRef<HTMLButtonElement>(null)

  const [midiInputPos, setMidiInputPos] = useState<{ x: number; y: number } | null>(null)
  const midiInputBtnRef = useRef<HTMLButtonElement>(null)

  const [timeSigPickerPos, setTimeSigPickerPos] = useState<{ x: number; y: number } | null>(null)
  const timeSigBtnRef = useRef<HTMLButtonElement>(null)
  const [keySigPickerPos, setKeySigPickerPos] = useState<{ x: number; y: number } | null>(null)
  const keySigBtnRef = useRef<HTMLButtonElement>(null)

  // Selected measure context — resolved once, used for display + sig routing
  const refMeasureId = selectedMeasureId ?? cursorMeasureId

  interface SelMeasureCtx {
    partId: string; staffId: string
    measure: import('@shared/score').Measure
    mIdx: number
    staff: import('@shared/score').Staff
  }
  const selMeasureCtx: SelMeasureCtx | null = (() => {
    if (!refMeasureId) return null
    for (const part of score.parts) {
      for (const staff of part.staves) {
        const mIdx = staff.measures.findIndex(m => m.id === refMeasureId)
        if (mIdx !== -1) return { partId: part.id, staffId: staff.id, measure: staff.measures[mIdx], mIdx, staff }
      }
    }
    return null
  })()

  const displayTimeSig: TimeSignature = selMeasureCtx
    ? resolveTimeSig(selMeasureCtx.staff.measures, selMeasureCtx.mIdx, score.timeSignature)
    : score.timeSignature

  const displayKeySig: KeySignature = selMeasureCtx
    ? resolveKeySig(selMeasureCtx.staff.measures, selMeasureCtx.mIdx, score.keySignature)
    : score.keySignature

  // Only show Reset when a specific measure is selected and it has an explicit override
  const hasTimeSigOverride = selectedMeasureId !== null && selMeasureCtx?.measure.timeSignature !== undefined
  const hasKeySigOverride  = selectedMeasureId !== null && selMeasureCtx?.measure.keySignature  !== undefined

  const handleAudioClick = () => {
    const btn = audioSettingsBtnRef.current
    if (!btn) return
    if (audioSettingsPos) { setAudioSettingsPos(null); return }
    const rect = btn.getBoundingClientRect()
    setAudioSettingsPos({ x: rect.left, y: rect.bottom + 4 })
  }

  const handleMidiInputClick = () => {
    const btn = midiInputBtnRef.current
    if (!btn) return
    if (midiInputPos) { setMidiInputPos(null); return }
    const rect = btn.getBoundingClientRect()
    setMidiInputPos({ x: rect.left, y: rect.bottom + 4 })
  }

  const handleKeySigClick = () => {
    const btn = keySigBtnRef.current
    if (!btn) return
    if (keySigPickerPos) { setKeySigPickerPos(null); return }
    const rect = btn.getBoundingClientRect()
    setKeySigPickerPos({ x: rect.left, y: rect.bottom + 4 })
  }

  const handleKeySigSelect = (key: KeySignature) => {
    if (selectedMeasureId && selMeasureCtx) {
      dispatch({ type: 'SET_KEY', partId: selMeasureCtx.partId, staffId: selMeasureCtx.staffId, measureId: selectedMeasureId, key })
    } else {
      dispatch({ type: 'SET_SCORE_KEY', key })
    }
    setKeySigPickerPos(null)
  }

  const handleKeySigReset = () => {
    if (!selectedMeasureId || !selMeasureCtx) return
    dispatch({ type: 'CLEAR_KEY', partId: selMeasureCtx.partId, staffId: selMeasureCtx.staffId, measureId: selectedMeasureId })
    setKeySigPickerPos(null)
  }

  const handleTimeSigClick = () => {
    const btn = timeSigBtnRef.current
    if (!btn) return
    if (timeSigPickerPos) { setTimeSigPickerPos(null); return }
    const rect = btn.getBoundingClientRect()
    setTimeSigPickerPos({ x: rect.left, y: rect.bottom + 4 })
  }

  const handleTimeSigSelect = (sig: TimeSignature) => {
    if (selectedMeasureId && selMeasureCtx) {
      // Guard: refuse if new time sig would make the measure over-full
      const used    = usedUnits(selMeasureCtx.measure.voices[0]?.events ?? [])
      const newCap  = measureCapacityUnits(sig)
      if (used > newCap) {
        setTimeSigError('Measure is too full for this time signature — delete some notes first')
        setTimeSigPickerPos(null)
        setTimeout(() => setTimeSigError(null), 4000)
        return
      }
      dispatch({ type: 'SET_TIME', partId: selMeasureCtx.partId, staffId: selMeasureCtx.staffId, measureId: selectedMeasureId, time: sig })
    } else {
      dispatch({ type: 'SET_SCORE_TIME', time: sig })
    }
    setTimeSigPickerPos(null)
  }

  const handleTimeSigReset = () => {
    if (!selectedMeasureId || !selMeasureCtx) return
    dispatch({ type: 'CLEAR_TIME', partId: selMeasureCtx.partId, staffId: selMeasureCtx.staffId, measureId: selectedMeasureId })
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
          onClick={insertMeasure}
          disabled={!(selectedMeasureId ?? cursorMeasureId)}
          title="Insert bar after selection (⌘B)"
          label="+ Bar"
        />

        <div style={{ width: 1, height: 24, background: '#3e3e3e' }} />

        <ToolbarButton
          onClick={() => isPlaying ? stopPlayback() : startPlayback()}
          title={isPlaying ? 'Stop (Space)' : 'Play (Space)'}
          label={isPlaying ? '⏹ Stop' : '▶ Play'}
          accent={isPlaying}
        />

        <div style={{ width: 1, height: 24, background: '#3e3e3e' }} />

        <ToolbarButton
          onClick={onTogglePartsPanel}
          title="Parts panel"
          label="Parts"
          accent={partsPanelOpen}
        />

        <ToolbarButton
          onClick={toggleKeyboard}
          title="Virtual keyboard (K)"
          label="Keys"
          accent={keyboardVisible}
        />

        <ToolbarButton
          onClick={toggleSoundOnInput}
          title="Sound on input"
          label="Sound"
          accent={soundOnInput}
        />

        <button
          ref={audioSettingsBtnRef}
          onClick={handleAudioClick}
          title="Audio settings"
          style={{
            padding: '4px 10px', fontSize: 12, borderRadius: 3, border: 'none',
            cursor: 'pointer',
            background: audioSettingsPos ? '#0e639c' : audioMode === 'midi-out' ? '#1a4a6e' : 'transparent',
            color: audioSettingsPos ? '#fff' : audioMode === 'midi-out' ? '#7ec8e3' : '#9d9d9d',
          }}
        >
          Audio {audioMode === 'midi-out' ? '⇝' : ''}
        </button>

        <button
          ref={midiInputBtnRef}
          onClick={handleMidiInputClick}
          title="MIDI input device"
          style={{
            padding: '4px 10px', fontSize: 12, borderRadius: 3, border: 'none',
            cursor: 'pointer',
            background: midiInputPos ? '#0e639c' : midiInputDeviceId ? '#1a4a6e' : 'transparent',
            color: midiInputPos ? '#fff' : midiInputDeviceId ? '#7ec8e3' : '#9d9d9d',
          }}
        >
          {midiInputDeviceName ? `MIDI In: ${midiInputDeviceName}` : 'MIDI In'}
        </button>

        <div style={{ width: 1, height: 24, background: '#3e3e3e' }} />

        <button
          ref={timeSigBtnRef}
          onClick={handleTimeSigClick}
          title={selectedMeasureId ? 'Time signature for selected measure' : 'Time signature'}
          style={{
            padding: '4px 10px', fontSize: 12, borderRadius: 3, border: 'none',
            cursor: 'pointer',
            background: timeSigPickerPos ? '#0e639c' : hasTimeSigOverride ? '#1a4a6e' : 'transparent',
            color: timeSigPickerPos ? '#fff' : hasTimeSigOverride ? '#7ec8e3' : '#9d9d9d',
          }}
        >
          {displayTimeSig.numerator}/{displayTimeSig.denominator}
        </button>

        <button
          ref={keySigBtnRef}
          onClick={handleKeySigClick}
          title={selectedMeasureId ? 'Key signature for selected measure' : 'Key signature'}
          style={{
            padding: '4px 10px', fontSize: 12, borderRadius: 3, border: 'none',
            cursor: 'pointer',
            background: keySigPickerPos ? '#0e639c' : hasKeySigOverride ? '#1a4a6e' : 'transparent',
            color: keySigPickerPos ? '#fff' : hasKeySigOverride ? '#7ec8e3' : '#9d9d9d',
          }}
        >
          {keyLabel(displayKeySig)}
        </button>
      </div>

      {timeSigError && (
        <div style={{
          position: 'fixed', bottom: 48, left: '50%', transform: 'translateX(-50%)',
          background: '#5a1a1a', border: '1px solid #a04040', borderRadius: 4,
          padding: '6px 14px', color: '#ffbbbb', fontSize: 12, zIndex: 2000,
          pointerEvents: 'none',
        }}>
          {timeSigError}
        </div>
      )}

      {timeSigPickerPos && (
        <TimeSignaturePicker
          current={displayTimeSig}
          screenX={timeSigPickerPos.x}
          screenY={timeSigPickerPos.y}
          onClose={() => setTimeSigPickerPos(null)}
          onSelect={handleTimeSigSelect}
          {...(hasTimeSigOverride ? { onReset: handleTimeSigReset } : {})}
        />
      )}
      {audioSettingsPos && (
        <AudioSettingsPanel
          screenX={audioSettingsPos.x}
          screenY={audioSettingsPos.y}
          onClose={() => setAudioSettingsPos(null)}
        />
      )}
      {midiInputPos && (
        <MidiInputPanel
          screenX={midiInputPos.x}
          screenY={midiInputPos.y}
          onClose={() => setMidiInputPos(null)}
        />
      )}
      {keySigPickerPos && (
        <CircleOfFifths
          current={displayKeySig}
          screenX={keySigPickerPos.x}
          screenY={keySigPickerPos.y}
          onClose={() => setKeySigPickerPos(null)}
          onSelect={handleKeySigSelect}
          {...(hasKeySigOverride ? { onReset: handleKeySigReset } : {})}
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
          {/* Voice selector */}
          <div style={{ display: 'flex', gap: 2, background: '#1e1e1e', borderRadius: 4, padding: 2, marginRight: 4 }}>
            {([0, 1] as const).map(v => (
              <button
                key={v}
                onClick={() => setActiveVoice(v)}
                title={`Voice ${v + 1}`}
                style={{
                  padding: '2px 8px',
                  fontSize: 11,
                  borderRadius: 3,
                  border: 'none',
                  cursor: 'pointer',
                  background: activeVoice === v ? '#0e639c' : 'transparent',
                  color: activeVoice === v ? '#fff' : '#9d9d9d',
                  transition: 'background 0.1s',
                }}
              >
                V{v + 1}
              </button>
            ))}
          </div>

          <div style={{ width: 1, height: 20, background: '#3e3e3e', marginRight: 4 }} />

          <span style={{ fontSize: 11, color: '#777', marginRight: 4 }}>Duration:</span>
          {DURATION_BUTTONS.map(({ duration, key }) => (
            <button
              key={duration}
              onClick={() => resizeNote(duration, 0)}
              title={`${DURATION_LABELS[duration]} (${key})`}
              style={{
                padding: '3px 6px',
                borderRadius: 3,
                border: 'none',
                cursor: 'pointer',
                background: selectedDuration === duration ? '#0e639c' : '#1e1e1e',
                color: selectedDuration === duration ? '#fff' : '#9d9d9d',
                transition: 'background 0.1s',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <DurationIcon duration={duration} isRest={inputMode === 'rest'} />
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
