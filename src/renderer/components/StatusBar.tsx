import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { DURATION_LABELS } from '@shared/musicUtils'
import { midiService } from '../services/midiService'

const ACCIDENTAL_LABEL: Record<string, string> = {
  sharp: '♯',
  flat:  '♭',
  natural: '♮',
}

const MIDI_EVENT_TTL_MS = 2000

function useMidiEventDisplay(): string | null {
  const [label, setLabel] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = (text: string) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    setLabel(text)
    timerRef.current = setTimeout(() => setLabel(null), MIDI_EVENT_TTL_MS)
  }

  useEffect(() => {
    const unsubNote = midiService.subscribe(input => {
      const acc = input.accidental === 'sharp' ? '♯' : input.accidental === 'flat' ? '♭' : ''
      show(`${input.noteName}${acc}${input.octave}  vel ${input.velocity}`)
    })
    const unsubCC = midiService.subscribeControl(input => {
      show(`CC ${input.number}  val ${input.value}  ch ${input.channel + 1}`)
    })
    return () => { unsubNote(); unsubCC() }
  }, [])

  return label
}

export function StatusBar(): JSX.Element {
  const {
    score, filePath, isDirty, zoom, inputMode,
    selectedDuration, isDotted, primedAccidental,
  } = useAppStore()

  const midiEvent = useMidiEventDisplay()

  const partCount    = score.parts.length
  const measureCount = score.parts[0]?.staves[0]?.measures.length ?? 0
  const zoomPct      = Math.round(zoom * 100)

  const durationLabel = DURATION_LABELS[selectedDuration] + (isDotted ? '.' : '')
  const showNoteInfo  = inputMode === 'note' || inputMode === 'rest'

  return (
    <div style={{
      height: 24,
      background: '#007acc',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 16,
      fontSize: 11,
      color: '#fff',
    }}>
      <span>{filePath ? filePath.split('/').pop() : 'Untitled'}{isDirty ? ' •' : ''}</span>
      <Sep />
      <span>{score.metadata.title}</span>
      <Sep />
      <span>{partCount} part{partCount !== 1 ? 's' : ''}</span>
      <Sep />
      <span>{measureCount} measure{measureCount !== 1 ? 's' : ''}</span>
      <Sep />
      <span>♩= {score.tempo} BPM</span>

      <div style={{ flex: 1 }} />

      {midiEvent && (
        <>
          <span style={{ opacity: 0.75, fontFamily: 'monospace', letterSpacing: '0.03em' }}>
            MIDI {midiEvent}
          </span>
          <Sep />
        </>
      )}

      {showNoteInfo && (
        <>
          <span style={{ opacity: 0.85 }}>{durationLabel}</span>
          {primedAccidental && (
            <>
              <Sep />
              <span style={{ opacity: 0.85 }}>{ACCIDENTAL_LABEL[primedAccidental] ?? primedAccidental}</span>
            </>
          )}
          <Sep />
        </>
      )}

      <span style={{ textTransform: 'capitalize' }}>{inputMode} mode</span>
      <Sep />
      <span>{zoomPct}%</span>
    </div>
  )
}

function Sep(): JSX.Element {
  return <span style={{ opacity: 0.5 }}>|</span>
}
