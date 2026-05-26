import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { midiOutputEngine, type MidiOutputInfo } from '../engine/midiOutputEngine'
import { INSTRUMENTS, type InstrumentFamily } from '@shared/instruments'

// ── Instrument icons ──────────────────────────────────────────────────────────
// Emoji placeholders — replace with per-instrument SVGs from
// src/renderer/assets/instruments/ (sourced from Wikimedia Commons)

const FAMILY_ICONS: Record<InstrumentFamily, string> = {
  strings:    '🎻',
  woodwinds:  '🎷',
  brass:      '🎺',
  keyboards:  '🎹',
  percussion: '🥁',
  voices:     '🎤',
}

function instrumentIcon(partName: string, midiProgram: number): string {
  const lower = partName.toLowerCase()
  const inst  = INSTRUMENTS.find(i =>
    lower.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(lower)
  )
  if (inst) return FAMILY_ICONS[inst.family]
  if (midiProgram <=  7) return '🎹'
  if (midiProgram <= 15) return '🎹'
  if (midiProgram <= 31) return '🎸'
  if (midiProgram <= 47) return '🎻'
  if (midiProgram <= 63) return '🎺'
  if (midiProgram <= 79) return '🎷'
  return '🎵'
}

// ── Connector geometry ────────────────────────────────────────────────────────

interface ConnectorPos { x1: number; y1: number; x2: number; y2: number }

function bezier({ x1, y1, x2, y2 }: ConnectorPos): string {
  const cx = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`
}

// ── RoutingView ───────────────────────────────────────────────────────────────

interface DragLine { partId: string; x1: number; y1: number; x2: number; y2: number }

export function RoutingView(): JSX.Element {
  const { score, midiOutputDeviceId, setMidiOutputDevice, audioMode, setAudioMode, dispatch } = useAppStore()
  const [midiOutputs,  setMidiOutputs]  = useState<MidiOutputInfo[]>([])
  const [midiAvailable, setMidiAvailable] = useState(true)

  // DOM refs for position measurement
  const containerRef   = useRef<HTMLDivElement>(null)
  const partRowRefs    = useRef<Map<string, HTMLDivElement>>(new Map())
  const channelRowRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const [connectors, setConnectors] = useState<Map<string, ConnectorPos>>(new Map())

  // Drag state
  const [dragLine, setDragLine]         = useState<DragLine | null>(null)
  const [hoveredChannel, setHoveredCh] = useState<number | null>(null)
  const draggingPartRef  = useRef<string | null>(null)
  const hoveredChRef     = useRef<number | null>(null)

  useEffect(() => {
    midiOutputEngine.init().then(ok => {
      setMidiAvailable(ok)
      setMidiOutputs(midiOutputEngine.outputInfos)
    })
  }, [])

  // Derived data
  const partsWithCh = score.parts.map((part, i) => ({
    part,
    effectiveChannel: part.midiChannel ?? (i + 1),
  }))
  const channelsInUse = [...new Set(partsWithCh.map(p => p.effectiveChannel))].sort((a, b) => a - b)
  const deviceConnected = !!midiOutputDeviceId && audioMode === 'midi-out'

  // ── Position measurement ───────────────────────────────────────────────────

  const measureRef = useRef(() => {})
  measureRef.current = () => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const map  = new Map<string, ConnectorPos>()
    for (const { part, effectiveChannel } of partsWithCh) {
      const partEl = partRowRefs.current.get(part.id)
      const chEl   = channelRowRefs.current.get(effectiveChannel)
      if (!partEl || !chEl) continue
      const pr = partEl.getBoundingClientRect()
      const cr = chEl.getBoundingClientRect()
      map.set(part.id, {
        x1: pr.right - rect.left,
        y1: pr.top   + pr.height / 2 - rect.top,
        x2: cr.left  - rect.left,
        y2: cr.top   + cr.height / 2 - rect.top,
      })
    }
    setConnectors(map)
  }

  const depKey = `${deviceConnected ? midiOutputDeviceId : 'none'}|` +
    partsWithCh.map(p => `${p.part.id}:${p.effectiveChannel}`).join('|')

  useLayoutEffect(() => { measureRef.current() }, [depKey])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(() => measureRef.current())
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // ── Drag ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!dragLine) return

    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      setDragLine(prev => prev ? { ...prev, x2: e.clientX - rect.left, y2: e.clientY - rect.top } : null)
    }

    const onUp = () => {
      const partId  = draggingPartRef.current
      const channel = hoveredChRef.current
      if (partId && channel !== null) {
        dispatch({ type: 'SET_PART_METADATA', partId, midiChannel: channel })
      }
      draggingPartRef.current = null
      setDragLine(null)
      setHoveredCh(null)
      hoveredChRef.current = null
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragLine !== null])

  const startDrag = (e: React.MouseEvent, partId: string) => {
    if (!containerRef.current) return
    e.preventDefault()
    const pos = connectors.get(partId)
    if (!pos) return
    const rect = containerRef.current.getBoundingClientRect()
    draggingPartRef.current = partId
    setDragLine({ partId, x1: pos.x1, y1: pos.y1, x2: e.clientX - rect.left, y2: e.clientY - rect.top })
  }

  const onChannelEnter = (ch: number) => { hoveredChRef.current = ch; setHoveredCh(ch) }
  const onChannelLeave = ()           => { hoveredChRef.current = null; setHoveredCh(null) }

  const handleDeviceSelect = (id: string) => {
    setMidiOutputDevice(id)
    setAudioMode('midi-out')
    void midiOutputEngine.selectOutput(id)
  }

  const handleDisconnect = () => {
    midiOutputEngine.deselect()
    setMidiOutputDevice(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e', color: '#d4d4d4', userSelect: 'none' }}>

      {/* ── Device selector ─────────────────────────────────────────────── */}
      <div style={{ padding: '10px 24px', borderBottom: '1px solid #2d2d2d', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.6 }}>MIDI Output</span>

        {!midiAvailable && <span style={{ fontSize: 12, color: '#e07070' }}>Web MIDI not available</span>}

        {midiAvailable && midiOutputs.length === 0 && (
          <span style={{ fontSize: 12, color: '#555' }}>No output devices found</span>
        )}

        {midiAvailable && midiOutputs.map(o => (
          <button
            key={o.id}
            onClick={() => handleDeviceSelect(o.id)}
            style={{
              padding: '3px 10px', borderRadius: 3, fontSize: 12, cursor: 'pointer',
              border: '1px solid',
              borderColor: o.id === midiOutputDeviceId ? '#0e639c' : '#444',
              background:  o.id === midiOutputDeviceId ? '#0e639c' : '#252526',
              color:       o.id === midiOutputDeviceId ? '#fff'    : '#bbb',
            }}
          >
            {o.name}
          </button>
        ))}

        {midiOutputDeviceId && (
          <button
            onClick={handleDisconnect}
            style={{ padding: '3px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer', border: '1px solid #3a3a3a', background: 'none', color: '#666' }}
          >
            Disconnect
          </button>
        )}
      </div>

      {/* ── Main routing area ───────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ position: 'relative', flex: 1, display: 'flex', overflow: 'hidden' }}
      >

        {/* Left — instruments */}
        <div style={{ width: 240, borderRight: '1px solid #2d2d2d', flexShrink: 0, paddingTop: 20 }}>
          <div style={{ padding: '0 16px 10px', fontSize: 10, color: '#4a4a4a', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Instruments
          </div>
          {partsWithCh.map(({ part }) => {
            const isDragging = dragLine?.partId === part.id
            return (
              <div
                key={part.id}
                ref={el => { if (el) partRowRefs.current.set(part.id, el); else partRowRefs.current.delete(part.id) }}
                style={{ height: 52, display: 'flex', alignItems: 'center', padding: '0 14px 0 16px', gap: 10 }}
              >
                <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>
                  {instrumentIcon(part.name, part.midiProgram)}
                </span>
                <span style={{ fontSize: 13, color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {part.name}
                </span>
                {/* Output connector — drag handle */}
                <div
                  title="Drag to reassign channel"
                  onMouseDown={e => startDrag(e, part.id)}
                  style={{
                    width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                    background: isDragging ? '#6ab8e8' : '#1a6fa0',
                    border: `2px solid ${isDragging ? '#6ab8e8' : '#0e639c'}`,
                    cursor: 'grab', boxSizing: 'border-box',
                  }}
                />
              </div>
            )
          })}
        </div>

        {/* SVG connector overlay */}
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
        >
          {deviceConnected && Array.from(connectors.entries()).map(([partId, pos]) => {
            const faded = dragLine?.partId === partId
            return (
              <g key={partId}>
                <path
                  d={bezier(pos)}
                  fill="none"
                  stroke="#0e639c"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  opacity={faded ? 0.25 : 0.8}
                />
                <circle cx={pos.x1} cy={pos.y1} r={4} fill="#0e639c" opacity={faded ? 0.25 : 0.9} />
                <circle cx={pos.x2} cy={pos.y2} r={4} fill="#0e639c" opacity={faded ? 0.25 : 0.9} />
              </g>
            )
          })}

          {/* Active drag line */}
          {dragLine && (
            <path
              d={bezier(dragLine)}
              fill="none"
              stroke="#6ab8e8"
              strokeWidth={2.5}
              strokeDasharray="7 5"
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* Right — channels or no-device message */}
        <div style={{ width: 180, marginLeft: 'auto', borderLeft: '1px solid #2d2d2d', flexShrink: 0, paddingTop: 20 }}>
          {deviceConnected ? (
            <>
              <div style={{ padding: '0 16px 10px', fontSize: 10, color: '#4a4a4a', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Channels
              </div>
              {channelsInUse.map(ch => {
                const isTarget = hoveredChannel === ch && !!dragLine
                return (
                  <div
                    key={ch}
                    ref={el => { if (el) channelRowRefs.current.set(ch, el); else channelRowRefs.current.delete(ch) }}
                    onMouseEnter={() => onChannelEnter(ch)}
                    onMouseLeave={onChannelLeave}
                    style={{
                      height: 52, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10,
                      background: isTarget ? 'rgba(106,184,232,0.1)' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                  >
                    {/* Input connector dot */}
                    <div style={{
                      width: 12, height: 12, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
                      background: isTarget ? '#6ab8e8' : '#1a6fa0',
                      border: `2px solid ${isTarget ? '#6ab8e8' : '#0e639c'}`,
                      boxShadow: isTarget ? '0 0 8px rgba(106,184,232,0.6)' : 'none',
                      transition: 'background 0.1s, box-shadow 0.1s',
                    }} />
                    <span style={{ fontSize: 13, color: isTarget ? '#d4d4d4' : '#888' }}>Ch {ch}</span>
                  </div>
                )
              })}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80%', gap: 8, padding: '0 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, opacity: 0.2 }}>⚡</div>
              <div style={{ fontSize: 12, color: '#555' }}>No device configured</div>
              <div style={{ fontSize: 11, color: '#3a3a3a' }}>Select a MIDI output above</div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
