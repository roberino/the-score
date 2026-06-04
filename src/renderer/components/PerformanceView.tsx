import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { VolumeSlider } from './VolumeSlider'
import * as Tone from 'tone'
import { useAppStore } from '../store/appStore'
import { INSTRUMENTS, type InstrumentFamily } from '@shared/instruments'
import { pitchToMidi } from '../engine/midiOutputEngine'
import {
  measureCapacityUnits, resolveTimeSig, eventDurationUnits,
  buildPlaybackSequence, buildMeasureTimeline, activeAssignmentAt,
} from '@shared/musicUtils'
import type { Score, Part, Staff, NoteEvent, Note, Chord } from '@shared/score'
import type { MeasureTimeEntry } from '@shared/musicUtils'
import { measureIndexFromClickX } from '@shared/performanceViewUtils'

// ── Layout constants ──────────────────────────────────────────────────────────

const HEADER_W  = 188   // left column width (px)
const RULER_H   = 24    // ruler strip height (px)
const TRACK_H   = 64    // height per staff row (px)
const MEASURE_W = 88    // width per measure (px)

// ── Colours ───────────────────────────────────────────────────────────────────

const C_NOTE_V0     = '#3b9ddd'
const C_NOTE_V1     = '#2d8f4e'
const C_SEQ_CELL    = 'rgba(59,157,221,0.75)'
const C_BARLINE     = 'rgba(255,255,255,0.09)'
const C_RULER_BG    = '#1a1a1a'
const C_RULER_TEXT  = '#666'
const C_TRACK_BG_A  = '#252526'
const C_TRACK_BG_B  = '#1e1e1e'
const C_HEADER_BG   = '#2a2a2a'
const C_CURSOR       = '#e8a020'   // playback cursor (moving)
const C_SCORE_CURSOR = '#4fc3f7'   // score cursor / play-from position (static)

// ── Instrument icon helpers (shared with RoutingView) ─────────────────────────

const svgAssets = import.meta.glob('../assets/instruments/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

const FAMILY_EMOJI: Record<InstrumentFamily, string> = {
  strings: '🎻', woodwinds: '🎷', brass: '🎺', keyboards: '🎹',
  percussion: '🥁', voices: '🎤', synths: '🎛️',
}

function resolveIcon(partName: string, midiProgram: number): { type: 'svg'; url: string } | { type: 'emoji'; char: string } {
  const lower = partName.toLowerCase()
  const inst = INSTRUMENTS.find(i => lower.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(lower))
  if (inst) {
    const url = svgAssets[`../assets/instruments/${inst.icon}`]
    if (url) return { type: 'svg', url }
    return { type: 'emoji', char: FAMILY_EMOJI[inst.family] }
  }
  const char = midiProgram <= 15 ? '🎹' : midiProgram <= 31 ? '🎸' : midiProgram <= 47 ? '🎻' : midiProgram <= 63 ? '🎺' : midiProgram <= 79 ? '🎷' : '🎵'
  return { type: 'emoji', char }
}

// ── Pitch range ───────────────────────────────────────────────────────────────

const DEFAULT_MIN = 40  // E2
const DEFAULT_MAX = 84  // C6

function computePitchRange(score: Score): { min: number; max: number } {
  let lo = DEFAULT_MIN, hi = DEFAULT_MAX
  for (const part of score.parts) {
    const ts = part.transposeSemitones ?? 0
    for (const staff of part.staves) {
      for (const measure of staff.measures) {
        for (const voice of measure.voices) {
          for (const ev of voice.events) {
            const midis = midiListFromEvent(ev, ts)
            for (const m of midis) { if (m < lo) lo = m; if (m > hi) hi = m }
          }
        }
      }
    }
  }
  return { min: Math.max(0, lo - 2), max: Math.min(127, hi + 2) }
}

function midiListFromEvent(ev: NoteEvent, transposeSemitones: number): number[] {
  if (ev.type === 'note') {
    const n = ev as Note
    return [pitchToMidi(n.pitch.noteName, n.pitch.octave, n.pitch.accidental, transposeSemitones)]
  }
  if (ev.type === 'chord') {
    return (ev as Chord).pitches.map(p => pitchToMidi(p.noteName, p.octave, p.accidental, transposeSemitones))
  }
  return []
}

// ── Canvas drawing ────────────────────────────────────────────────────────────

function drawRuler(
  ctx: CanvasRenderingContext2D,
  totalMeasures: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = C_RULER_BG
  ctx.fillRect(0, 0, w, h)

  ctx.fillStyle = C_RULER_TEXT
  ctx.font = '10px sans-serif'
  ctx.textBaseline = 'middle'

  for (let i = 0; i < totalMeasures; i++) {
    const x = i * MEASURE_W
    // barline
    ctx.fillStyle = C_BARLINE
    ctx.fillRect(x, 0, 1, h)
    // measure number
    ctx.fillStyle = C_RULER_TEXT
    ctx.fillText(String(i + 1), x + 4, h / 2)
  }
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  staff: Staff,
  part: Part,
  score: Score,
  totalMeasures: number,
  pitchRange: { min: number; max: number },
  rowIndex: number,
) {
  const w = totalMeasures * MEASURE_W
  const h = TRACK_H

  // Background
  ctx.fillStyle = rowIndex % 2 === 0 ? C_TRACK_BG_A : C_TRACK_BG_B
  ctx.fillRect(0, 0, w, h)

  const isSequencer = (part as any).inputMode === 'sequencer'

  if (isSequencer) {
    drawSequencerTrack(ctx, staff, part, totalMeasures, h)
  } else {
    drawPianoRollTrack(ctx, staff, part, score, totalMeasures, pitchRange, h)
  }

  // Barlines on top
  ctx.fillStyle = C_BARLINE
  for (let i = 0; i <= totalMeasures; i++) {
    ctx.fillRect(i * MEASURE_W, 0, 1, h)
  }
}

function drawPianoRollTrack(
  ctx: CanvasRenderingContext2D,
  staff: Staff,
  part: Part,
  score: Score,
  totalMeasures: number,
  pitchRange: { min: number; max: number },
  h: number,
) {
  const pitchSpan = Math.max(1, pitchRange.max - pitchRange.min + 1)
  const noteH = Math.max(2, h / pitchSpan)

  staff.measures.forEach((measure, mIdx) => {
    if (mIdx >= totalMeasures) return
    const timeSig = resolveTimeSig(staff.measures, mIdx, score.timeSignature)
    const capacity = measureCapacityUnits(timeSig)
    const measureX = mIdx * MEASURE_W

    measure.voices.forEach((voice, vIdx) => {
      const color = vIdx === 0 ? C_NOTE_V0 : C_NOTE_V1
      let beat = 0
      for (const ev of voice.events) {
        const dur = eventDurationUnits(ev)
        if (ev.type !== 'rest') {
          const midis = midiListFromEvent(ev, part.transposeSemitones ?? 0)
          const noteW = Math.max(1, (dur / capacity) * MEASURE_W - 0.5)
          const noteX = measureX + (beat / capacity) * MEASURE_W
          for (const midi of midis) {
            const clamped = Math.max(pitchRange.min, Math.min(pitchRange.max, midi))
            const y = ((pitchRange.max - clamped) / pitchSpan) * (h - noteH)
            ctx.fillStyle = color
            ctx.fillRect(noteX, y, noteW, noteH)
          }
        }
        beat += dur
      }
    })
  })
}

function drawSequencerTrack(
  ctx: CanvasRenderingContext2D,
  staff: Staff,
  part: Part,
  totalMeasures: number,
  h: number,
) {
  const assignments: any[] = (part as any).sequenceAssignments ?? []
  const patterns: any[]    = (part as any).sequencePatterns    ?? []

  for (let mIdx = 0; mIdx < Math.min(staff.measures.length, totalMeasures); mIdx++) {
    const assignment = activeAssignmentAt(assignments, mIdx)
    if (!assignment?.patternId) continue
    const pattern = patterns.find((p: any) => p.id === assignment.patternId)
    if (!pattern || pattern.stepsPerBar === 0) continue

    const measureX  = mIdx * MEASURE_W
    const stepsPerBar = pattern.stepsPerBar as number
    const stepW = MEASURE_W / stepsPerBar

    ;(pattern.steps as any[][]).forEach((cells, step) => {
      if (!cells.length) return
      cells.forEach((cell: any) => {
        const y = ((127 - (cell.pitch ?? 64)) / 128) * h
        const cellH = Math.max(2, h / 128)
        ctx.fillStyle = C_SEQ_CELL
        ctx.fillRect(measureX + step * stepW, y, stepW - 0.5, cellH)
      })
    })
  }
}

// ── Track header ──────────────────────────────────────────────────────────────

interface TrackHeaderProps {
  part: Part
  staffCount: number
  isMuted: boolean
  isSoloed: boolean
  soloActive: boolean
  onMuteToggle: () => void
  onSoloToggle: () => void
  onVolumeChange: (v: number) => void
}

function TrackHeader({ part, staffCount, isMuted, isSoloed, soloActive, onMuteToggle, onSoloToggle, onVolumeChange }: TrackHeaderProps) {
  const icon = resolveIcon(part.name, part.midiProgram)
  const dimmed = soloActive && !isSoloed

  const btnBase: React.CSSProperties = {
    padding: '1px 6px', fontSize: 10, borderRadius: 3, border: '1px solid #3a3a3a',
    cursor: 'pointer', background: 'none', color: '#666', lineHeight: '16px',
  }

  return (
    <div style={{
      width: HEADER_W, height: TRACK_H * staffCount,
      background: C_HEADER_BG, borderRight: '1px solid #1a1a1a',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '0 8px', gap: 4, opacity: dimmed ? 0.4 : 1, boxSizing: 'border-box',
    }}>
      {/* Name + icon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>
          {icon.type === 'svg'
            ? <img src={icon.url} style={{ width: 16, height: 16, opacity: 0.7 }} />
            : icon.char}
        </span>
        <span style={{ fontSize: 11, color: '#ccc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {part.name}
        </span>
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {/* Mute */}
        <button
          onClick={onMuteToggle}
          title="Mute"
          style={{
            ...btnBase,
            borderColor: isMuted ? '#c06060' : '#3a3a3a',
            background:  isMuted ? 'rgba(192,96,96,0.18)' : 'none',
            color:       isMuted ? '#e07070' : '#666',
          }}
        >M</button>

        {/* Solo */}
        <button
          onClick={onSoloToggle}
          title="Solo"
          style={{
            ...btnBase,
            borderColor: isSoloed ? '#c09020' : '#3a3a3a',
            background:  isSoloed ? 'rgba(192,144,32,0.18)' : 'none',
            color:       isSoloed ? '#e0c060' : '#666',
          }}
        >S</button>

        {/* Volume slider */}
        <VolumeSlider
          value={part.volume}
          onChange={onVolumeChange}
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
    </div>
  )
}

// ── Piano roll canvas row ─────────────────────────────────────────────────────

interface PianoRollRowProps {
  staff: Staff
  part: Part
  score: Score
  totalMeasures: number
  pitchRange: { min: number; max: number }
  rowIndex: number
}

function PianoRollRow({ staff, part, score, totalMeasures, pitchRange, rowIndex }: PianoRollRowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawTrack(ctx, staff, part, score, totalMeasures, pitchRange, rowIndex)
  }, [staff, part, score, totalMeasures, pitchRange, rowIndex])

  return (
    <canvas
      ref={canvasRef}
      width={totalMeasures * MEASURE_W}
      height={TRACK_H}
      style={{ display: 'block', flexShrink: 0 }}
    />
  )
}

// ── Ruler canvas ──────────────────────────────────────────────────────────────

function RulerCanvas({ totalMeasures }: { totalMeasures: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const w = totalMeasures * MEASURE_W

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawRuler(ctx, totalMeasures, w, RULER_H)
  }, [totalMeasures, w])

  return (
    <canvas
      ref={canvasRef}
      width={w}
      height={RULER_H}
      style={{ display: 'block', flexShrink: 0 }}
    />
  )
}

// ── PerformanceView ───────────────────────────────────────────────────────────

export function PerformanceView(): JSX.Element {
  const { score, dispatch, isPlaying, setCursor, requestScrollToCursor, cursorMeasureId } = useAppStore()

  // Solo state: track which part is soloed, and save pre-solo mute states for restore
  const [soloPartId, setSoloPartId]     = useState<string | null>(null)
  const [preSoloMutes, setPreSoloMutes] = useState<Map<string, boolean> | null>(null)

  // Playback cursor X position within the track canvas (null = not playing / hidden)
  const [cursorX, setCursorX] = useState<number | null>(null)
  const rafRef      = useRef<number | null>(null)
  const timelineRef = useRef<MeasureTimeEntry[]>([])
  const gridRef     = useRef<HTMLDivElement>(null)   // single scrollable grid

  // All (part, staff) track rows in order
  const tracks = useMemo(() => {
    const rows: { part: Part; staff: Staff; staffIndex: number; partStaffCount: number }[] = []
    for (const part of score.parts) {
      for (let si = 0; si < part.staves.length; si++) {
        rows.push({ part, staff: part.staves[si], staffIndex: si, partStaffCount: part.staves.length })
      }
    }
    return rows
  }, [score.parts])

  const firstStaff   = score.parts[0]?.staves[0]
  const totalMeasures = firstStaff?.measures.length ?? 0
  const pitchRange   = useMemo(() => computePitchRange(score), [score])
  const canvasWidth  = totalMeasures * MEASURE_W
  const totalTrackH  = tracks.length * TRACK_H

  // Build measure timeline whenever score or playback state changes
  useEffect(() => {
    if (!firstStaff) return
    const bpm      = score.tempo ?? 120
    const sequence = buildPlaybackSequence(firstStaff.measures, score.voltas ?? [])
    timelineRef.current = buildMeasureTimeline(
      firstStaff, sequence, firstStaff, bpm, score.timeSignature,
    )
  }, [score, firstStaff])

  // RAF loop for playback cursor
  useEffect(() => {
    if (!isPlaying) {
      setCursorX(null)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      return
    }

    const tick = () => {
      const t = Tone.Transport.seconds
      const timeline = timelineRef.current
      if (!timeline.length) { rafRef.current = requestAnimationFrame(tick); return }

      let entry = timeline[timeline.length - 1]
      for (const e of timeline) {
        if (t < e.startSec + e.durationSec) { entry = e; break }
      }
      const fraction = Math.max(0, Math.min(1, (t - entry.startSec) / Math.max(0.001, entry.durationSec)))
      const x = entry.mIdx * MEASURE_W + fraction * MEASURE_W
      setCursorX(x)

      // Auto-scroll: keep cursor ~1/3 from left of visible area
      const area = gridRef.current
      if (area) {
        const visibleW = area.clientWidth - HEADER_W
        const relX     = x - area.scrollLeft
        if (relX < 20 || relX > visibleW - 40) {
          area.scrollLeft = Math.max(0, x - visibleW / 3)
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [isPlaying])

  // Clean up solo when score changes (part removed, etc.)
  useEffect(() => {
    if (soloPartId && !score.parts.find(p => p.id === soloPartId)) {
      setSoloPartId(null)
      setPreSoloMutes(null)
    }
  }, [score.parts, soloPartId])

  const handleSoloToggle = useCallback((partId: string) => {
    if (soloPartId === partId) {
      // Turn off solo — restore saved mute states
      if (preSoloMutes) {
        for (const part of score.parts) {
          dispatch({ type: 'SET_PART_METADATA', partId: part.id, muted: preSoloMutes.get(part.id) ?? false })
        }
      }
      setSoloPartId(null)
      setPreSoloMutes(null)
    } else {
      // Save current mute states, then mute all except this part
      const saved = new Map(score.parts.map(p => [p.id, p.muted]))
      setPreSoloMutes(saved)
      setSoloPartId(partId)
      for (const part of score.parts) {
        dispatch({ type: 'SET_PART_METADATA', partId: part.id, muted: part.id !== partId })
      }
    }
  }, [soloPartId, preSoloMutes, score.parts, dispatch])

  // Score cursor x position in the canvas (null = no cursor set)
  const scoreCursorX = useMemo(() => {
    if (!cursorMeasureId) return null
    const mIdx = score.parts[0]?.staves[0]?.measures.findIndex(m => m.id === cursorMeasureId) ?? -1
    return mIdx >= 0 ? mIdx * MEASURE_W : null
  }, [cursorMeasureId, score.parts])

  // Click on a track bar → set the score cursor (for Play from cursor); stay in this view
  const handleBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isPlaying) return
    const mIdx = measureIndexFromClickX(e.nativeEvent.offsetX, MEASURE_W, totalMeasures)
    const measure = score.parts[0]?.staves[0]?.measures[mIdx]
    if (!measure) return
    setCursor(measure.id, 0)
    requestScrollToCursor()
  }, [isPlaying, score.parts, totalMeasures, setCursor, requestScrollToCursor])

  // Grid template rows: ruler row + one row per track
  const gridTemplateRows = `${RULER_H}px ${tracks.map(() => `${TRACK_H}px`).join(' ')}`

  return (
    <div
      ref={gridRef}
      style={{
        flex: 1, overflow: 'auto',
        display: 'grid',
        gridTemplateColumns: `${HEADER_W}px ${canvasWidth}px`,
        gridTemplateRows,
        alignItems: 'stretch',
        position: 'relative',
        background: '#1e1e1e',
      }}
    >
      {/* ── Ruler row (grid row 1) ─────────────────────────────────────────── */}

      {/* Corner: sticky top-left */}
      <div style={{
        position: 'sticky', top: 0, left: 0, zIndex: 3,
        background: C_RULER_BG,
        borderRight: '1px solid #1a1a1a', borderBottom: '1px solid #1a1a1a',
      }} />

      {/* Ruler canvas: sticky top, same column as all track canvases */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 2,
        overflow: 'hidden',
        borderBottom: '1px solid #1a1a1a',
        background: C_RULER_BG,
      }}>
        <RulerCanvas totalMeasures={totalMeasures} />
      </div>

      {/* ── Track rows (grid rows 2+) ──────────────────────────────────────── */}
      {tracks.map(({ part, staff, staffIndex, partStaffCount }, rowIndex) => {
        const isFirst = staffIndex === 0
        return [
          // Header cell: sticky left
          <div
            key={`h-${part.id}-${staff.id}`}
            style={{
              position: 'sticky', left: 0, zIndex: 1,
              background: C_HEADER_BG,
              borderRight: '1px solid #1a1a1a', borderBottom: '1px solid #1a1a1a',
            }}
          >
            {isFirst && (
              <TrackHeader
                part={part}
                staffCount={partStaffCount}
                isMuted={part.muted}
                isSoloed={soloPartId === part.id}
                soloActive={soloPartId !== null}
                onMuteToggle={() => dispatch({ type: 'SET_PART_METADATA', partId: part.id, muted: !part.muted })}
                onSoloToggle={() => handleSoloToggle(part.id)}
                onVolumeChange={v => dispatch({ type: 'SET_PART_METADATA', partId: part.id, volume: v })}
              />
            )}
          </div>,

          // Canvas cell — click navigates to that measure in Score view
          <div
            key={`r-${part.id}-${staff.id}`}
            style={{
              borderBottom: '1px solid #1a1a1a', overflow: 'hidden', position: 'relative',
              cursor: isPlaying ? 'default' : 'pointer',
            }}
            onClick={handleBarClick}
          >
            <PianoRollRow
              staff={staff}
              part={part}
              score={score}
              totalMeasures={totalMeasures}
              pitchRange={pitchRange}
              rowIndex={rowIndex}
            />
          </div>,
        ]
      })}

      {/* Score cursor marker — shows play-from-cursor position */}
      {scoreCursorX !== null && (
        <div style={{
          position: 'absolute',
          left: HEADER_W + scoreCursorX,
          top: RULER_H,
          width: 2,
          height: totalTrackH,
          background: C_SCORE_CURSOR,
          pointerEvents: 'none',
          zIndex: 4,
          opacity: 0.85,
        }} />
      )}

      {/* Playback cursor — moves in real time during playback */}
      {cursorX !== null && (
        <div style={{
          position: 'absolute',
          left: HEADER_W + cursorX,
          top: RULER_H,
          width: 1,
          height: totalTrackH,
          background: C_CURSOR,
          pointerEvents: 'none',
          zIndex: 5,
        }} />
      )}
    </div>
  )
}
