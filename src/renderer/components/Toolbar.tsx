import { useState, useRef, useEffect } from 'react'
import { useAppStore, type InputMode } from '../store/appStore'
import type { MidiLearnFunctionId } from '../store/appStore'
import { DURATION_LABELS, KEY_TO_DURATION, resolveTimeSig, resolveKeySig, keyLabel, measureCapacityUnits, usedUnits } from '@shared/musicUtils'
import type { Duration, TimeSignature, KeySignature } from '@shared/score'
import { TimeSignaturePicker } from './TimeSignaturePicker'
import { CircleOfFifths } from './CircleOfFifths'
import { AudioSettingsPanel } from './AudioSettingsPanel'
import { MidiInputPanel } from './MidiInputPanel'

function formatBinding(b: { type: string; channel: number; number: number }) {
  return b.type === 'cc' ? `CC ${b.number} Ch${b.channel + 1}` : `Note ${b.number} Ch${b.channel + 1}`
}

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
    playbackMode, setPlaybackMode,
    midiLearnListening, midiLearnBindings, midiLearnError,
    startMidiLearnListening, stopMidiLearnListening, setMidiLearnBinding, setMidiLearnError,
  } = useAppStore()

  const [timeSigError, setTimeSigError] = useState<string | null>(null)
  const [playDropdownOpen, setPlayDropdownOpen] = useState(false)

  // MIDI learn state
  const [learnPulse, setLearnPulse] = useState(false)
  const isLearnListening = midiLearnListening === 'durationCycle'
  const learnBinding     = midiLearnBindings['durationCycle']
  const isLearnAssigned  = !!learnBinding && !isLearnListening

  useEffect(() => {
    if (!isLearnListening) { setLearnPulse(false); return }
    const t = setInterval(() => setLearnPulse(v => !v), 500)
    return () => clearInterval(t)
  }, [isLearnListening])

  useEffect(() => {
    if (!midiLearnError) return
    const t = setTimeout(() => setMidiLearnError(null), 4000)
    return () => clearTimeout(t)
  }, [midiLearnError, setMidiLearnError])

  const handleLearnClick = () => {
    if (isLearnListening)     stopMidiLearnListening()
    else if (isLearnAssigned) setMidiLearnBinding('durationCycle' as MidiLearnFunctionId, null)
    else                      startMidiLearnListening('durationCycle')
  }
  const playSplitRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!playDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (playSplitRef.current && !playSplitRef.current.contains(e.target as Node)) {
        setPlayDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [playDropdownOpen])

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
    if (isPlaying) return
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
    if (isPlaying) return
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
    if (isPlaying) return
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
          {MODES.map(({ mode, label, key }) => {
            const modeDisabled = isPlaying && mode !== 'select'
            return (
              <button
                key={mode}
                onClick={() => { if (!modeDisabled) setInputMode(mode) }}
                title={`${label} (${key})`}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderRadius: 3,
                  border: 'none',
                  cursor: modeDisabled ? 'not-allowed' : 'pointer',
                  background: inputMode === mode ? '#0e639c' : 'transparent',
                  color: modeDisabled ? '#555' : inputMode === mode ? '#fff' : '#9d9d9d',
                  transition: 'background 0.1s',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div style={{ width: 1, height: 24, background: '#3e3e3e' }} />

        <ToolbarButton onClick={undo} disabled={isPlaying || undoStack.length === 0} title="Undo (⌘Z)"  label="↩ Undo" />
        <ToolbarButton onClick={redo} disabled={isPlaying || redoStack.length === 0} title="Redo (⌘⇧Z)" label="↪ Redo" />

        <div style={{ width: 1, height: 24, background: '#3e3e3e' }} />

        <ToolbarButton
          onClick={insertMeasure}
          disabled={isPlaying || !(selectedMeasureId ?? cursorMeasureId)}
          title="Insert bar after selection (⌘B)"
          label="+ Bar"
        />

        <div style={{ width: 1, height: 24, background: '#3e3e3e' }} />

        {/* Split play button */}
        <div ref={playSplitRef} style={{ position: 'relative', display: 'inline-flex', borderRadius: 3, overflow: 'visible' }}>
          <button
            onClick={() => isPlaying ? stopPlayback() : void startPlayback()}
            title={isPlaying ? 'Stop (Space)' : playbackMode === 'from-cursor' ? 'Play from cursor (Space)' : 'Play from beginning (Space)'}
            style={{
              padding: '4px 10px', fontSize: 12, border: 'none', cursor: 'pointer',
              borderRadius: isPlaying ? 3 : '3px 0 0 3px',
              background: isPlaying ? '#1a8a1a' : 'transparent',
              color: isPlaying ? '#fff' : '#9d9d9d',
            }}
          >
            {isPlaying ? '⏹ Stop' : '▶ Play'}
          </button>
          {!isPlaying && (
            <button
              onClick={() => setPlayDropdownOpen(o => !o)}
              title="Playback options"
              style={{
                padding: '4px 5px', fontSize: 10, border: 'none', cursor: 'pointer',
                borderRadius: '0 3px 3px 0',
                borderLeft: '1px solid #555',
                background: playDropdownOpen ? '#0e639c' : 'transparent',
                color: playDropdownOpen ? '#fff' : '#777',
              }}
            >
              ▾
            </button>
          )}
          {playDropdownOpen && !isPlaying && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0,
              background: '#252526', border: '1px solid #555', borderRadius: 4,
              zIndex: 2000, minWidth: 190,
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}>
              {([
                { mode: 'beginning' as const,   label: '▶ Play from beginning', disabled: false },
                { mode: 'from-cursor' as const, label: '▶ Play from cursor',    disabled: false },
              ] as const).map(({ mode, label, disabled }) => (
                <button
                  key={mode}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return
                    setPlaybackMode(mode)
                    setPlayDropdownOpen(false)
                    void startPlayback()
                  }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '7px 12px', fontSize: 12, border: 'none',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    background: playbackMode === mode ? '#37373d' : 'transparent',
                    color: disabled ? '#555' : '#ccc',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

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

        {/* Drag region — fills empty space so the window is draggable by the toolbar */}
        <div style={{ flex: 1, WebkitAppRegion: 'drag' } as React.CSSProperties} />

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

          <div style={{ width: 1, height: 20, background: '#3e3e3e', margin: '0 4px' }} />

          <button
            onClick={handleLearnClick}
            title={
              isLearnListening  ? 'Listening for MIDI control… (click to cancel)' :
              isLearnAssigned   ? `MIDI learn: ${formatBinding(learnBinding!)} — click to clear` :
                                  'MIDI learn: assign a MIDI control to cycle duration'
            }
            style={{
              padding: '3px 8px',
              fontSize: 11,
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              background: isLearnListening
                ? (learnPulse ? '#1a4a6e' : '#0e4060')
                : isLearnAssigned ? '#1a4a6e'
                : '#1e1e1e',
              color: isLearnListening ? '#7ec8e3'
                   : isLearnAssigned  ? '#7ec8e3'
                   : '#9d9d9d',
              transition: isLearnListening ? 'none' : 'background 0.1s',
            }}
          >
            {isLearnListening ? '⊙ Listening…' : isLearnAssigned ? `⊙ ${formatBinding(learnBinding!)}` : '⊙ MIDI'}
          </button>
        </div>
      )}

      {midiLearnError && (
        <div style={{
          position: 'fixed', bottom: 48, left: '50%', transform: 'translateX(-50%)',
          background: '#5a1a1a', border: '1px solid #a04040', borderRadius: 4,
          padding: '6px 14px', color: '#ffbbbb', fontSize: 12, zIndex: 2000,
          pointerEvents: 'none',
        }}>
          {midiLearnError}
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
