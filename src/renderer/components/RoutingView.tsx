import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { midiOutputEngine, type MidiOutputInfo } from '../engine/midiOutputEngine'
import { INSTRUMENTS, type InstrumentFamily } from '@shared/instruments'
import { VolumeSlider } from './VolumeSlider'

// ── Instrument icons ──────────────────────────────────────────────────────────
// SVG assets sourced from Wikimedia Commons, stored in assets/instruments/.
// Instruments without a matching SVG file fall back to family emoji.

const svgAssets = import.meta.glob('../assets/instruments/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

const FAMILY_EMOJI: Record<InstrumentFamily, string> = {
  strings:    '🎻',
  woodwinds:  '🎷',
  brass:      '🎺',
  keyboards:  '🎹',
  percussion: '🥁',
  voices:     '🎤',
  synths:     '🎛️',
}

/** Returns { type: 'svg', url } or { type: 'emoji', char }. */
function resolveIcon(partName: string, midiProgram: number): { type: 'svg'; url: string } | { type: 'emoji'; char: string } {
  const lower = partName.toLowerCase()
  const inst  = INSTRUMENTS.find(i =>
    lower.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(lower)
  )
  if (inst) {
    const key = `../assets/instruments/${inst.icon}`
    const url = svgAssets[key]
    if (url) return { type: 'svg', url }
    return { type: 'emoji', char: FAMILY_EMOJI[inst.family] }
  }
  // MIDI program fallback when instrument not in catalogue
  const emoji =
    midiProgram <=  7 ? '🎹' :
    midiProgram <= 15 ? '🎹' :
    midiProgram <= 31 ? '🎸' :
    midiProgram <= 47 ? '🎻' :
    midiProgram <= 63 ? '🎺' :
    midiProgram <= 79 ? '🎷' : '🎵'
  return { type: 'emoji', char: emoji }
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

  // Expandable instrument context menu
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null)

  // Manually added (empty) channels — ephemeral local state
  const [addedChannels, setAddedChannels] = useState<Set<number>>(new Set())
  const [addPickerOpen, setAddPickerOpen] = useState(false)

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
  const channelsInUse = [...new Set([...partsWithCh.map(p => p.effectiveChannel), ...addedChannels])].sort((a, b) => a - b)
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
    partsWithCh.map(p => `${p.part.id}:${p.effectiveChannel}`).join('|') + '|' +
    [...addedChannels].sort().join(',') + '|' + (selectedPartId ?? '')

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
        // Channel now has a part assigned — remove from manually-added set
        setAddedChannels(prev => { const next = new Set(prev); next.delete(channel); return next })
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

  const SEL_COLOUR = '#e0944a'   // amber — complementary to the blue connector accent

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
            const isExpanded = selectedPartId === part.id
            const programOption = INSTRUMENTS.find(i => i.midiProgram === part.midiProgram)
            const icon = resolveIcon(part.name, part.midiProgram)
            return (
              <div key={part.id}>
                {/* Main instrument row */}
                <div
                  ref={el => { if (el) partRowRefs.current.set(part.id, el); else partRowRefs.current.delete(part.id) }}
                  onClick={() => setSelectedPartId(isExpanded ? null : part.id)}
                  style={{
                    height: 52, display: 'flex', alignItems: 'center', padding: '0 14px 0 14px', gap: 10, cursor: 'pointer',
                    background: isExpanded ? `rgba(224,148,74,0.10)` : 'transparent',
                    borderLeft: `2px solid ${isExpanded ? SEL_COLOUR : 'transparent'}`,
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                >
                  {icon.type === 'svg'
                    ? <img src={icon.url} alt={part.name} style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0, filter: isExpanded ? 'invert(0.85) sepia(0.4) saturate(2) hue-rotate(-20deg)' : 'invert(0.85)' }} />
                    : <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{icon.char}</span>
                  }
                  <span style={{ fontSize: 13, color: isExpanded ? '#e8c89a' : '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', transition: 'color 0.15s' }}>
                    {part.name}
                  </span>
                  {/* Expand chevron */}
                  <span style={{ fontSize: 9, color: isExpanded ? SEL_COLOUR : '#444', flexShrink: 0, marginRight: 4, transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s, color 0.15s' }}>▶</span>
                  {/* Output connector — drag handle */}
                  <div
                    title="Drag to reassign channel"
                    onMouseDown={e => { e.stopPropagation(); startDrag(e, part.id) }}
                    style={{
                      width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                      background: isDragging ? '#6ab8e8' : isExpanded ? SEL_COLOUR : '#1a6fa0',
                      border: `2px solid ${isDragging ? '#6ab8e8' : isExpanded ? SEL_COLOUR : '#0e639c'}`,
                      cursor: 'grab', boxSizing: 'border-box', transition: 'background 0.15s, border-color 0.15s',
                    }}
                  />
                </div>

                {/* Expandable context panel */}
                {isExpanded && (
                  <div style={{ padding: '8px 16px 12px', background: '#252526', borderTop: '1px solid #2d2d2d', borderBottom: '1px solid #2d2d2d', display: 'flex', flexDirection: 'column', gap: 10 }}>

                    {/* Mute */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#666', width: 60 }}>Mute</span>
                      <button
                        onClick={() => dispatch({ type: 'SET_PART_METADATA', partId: part.id, muted: !part.muted })}
                        style={{
                          padding: '2px 10px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
                          border: '1px solid',
                          borderColor: part.muted ? '#c06060' : '#3a3a3a',
                          background:  part.muted ? 'rgba(192,96,96,0.15)' : 'none',
                          color:       part.muted ? '#e07070' : '#666',
                        }}
                      >
                        {part.muted ? 'Muted' : 'Mute'}
                      </button>
                    </div>

                    {/* Volume */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#666', width: 60 }}>Volume</span>
                      <VolumeSlider
                        value={part.volume}
                        onChange={v => dispatch({ type: 'SET_PART_METADATA', partId: part.id, volume: v })}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: 11, color: '#555', width: 28, textAlign: 'right' }}>{Math.round(part.volume * 100)}</span>
                    </div>

                    {/* Program */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#666', width: 60 }}>Program</span>
                      <select
                        value={part.midiProgram}
                        onChange={e => dispatch({ type: 'SET_PART_METADATA', partId: part.id, midiProgram: Number(e.target.value) })}
                        style={{ flex: 1, background: '#1e1e1e', color: '#ccc', border: '1px solid #3a3a3a', borderRadius: 3, fontSize: 11, padding: '2px 4px', cursor: 'pointer' }}
                      >
                        {!programOption && <option value={part.midiProgram}>Program {part.midiProgram}</option>}
                        {INSTRUMENTS.map(i => (
                          <option key={i.id} value={i.midiProgram}>{i.name}</option>
                        ))}
                      </select>
                    </div>

                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* SVG connector overlay */}
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
        >
          {deviceConnected && Array.from(connectors.entries()).map(([partId, pos]) => {
            const faded      = dragLine?.partId === partId
            const isSelected = selectedPartId === partId
            const colour     = isSelected ? SEL_COLOUR : '#0e639c'
            return (
              <g key={partId}>
                <path
                  d={bezier(pos)}
                  fill="none"
                  stroke={colour}
                  strokeWidth={isSelected ? 3 : 2.5}
                  strokeLinecap="round"
                  opacity={faded ? 0.25 : 0.85}
                />
                <circle cx={pos.x1} cy={pos.y1} r={4} fill={colour} opacity={faded ? 0.25 : 0.9} />
                <circle cx={pos.x2} cy={pos.y2} r={4} fill={colour} opacity={faded ? 0.25 : 0.9} />
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
              {/* Header row: label + add button */}
              <div style={{ padding: '0 16px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: '#4a4a4a', textTransform: 'uppercase', letterSpacing: 0.8, flex: 1 }}>
                  Channels
                </span>
                <div style={{ position: 'relative' }}>
                  <button
                    title={channelsInUse.length >= 16 ? 'All 16 channels in use' : 'Add channel'}
                    disabled={channelsInUse.length >= 16}
                    onClick={() => setAddPickerOpen(o => !o)}
                    style={{
                      padding: '1px 6px', borderRadius: 3, fontSize: 14, lineHeight: 1, cursor: channelsInUse.length >= 16 ? 'default' : 'pointer',
                      border: '1px solid #3a3a3a', background: 'none',
                      color: channelsInUse.length >= 16 ? '#333' : '#666',
                    }}
                  >
                    +
                  </button>
                  {addPickerOpen && (
                    <select
                      size={1}
                      autoFocus
                      onBlur={() => setAddPickerOpen(false)}
                      onChange={e => {
                        const ch = Number(e.target.value)
                        if (ch) {
                          setAddedChannels(prev => new Set([...prev, ch]))
                          setAddPickerOpen(false)
                        }
                      }}
                      style={{
                        position: 'absolute', right: 0, top: '100%', marginTop: 2, zIndex: 10,
                        background: '#252526', color: '#ccc', border: '1px solid #444',
                        borderRadius: 3, fontSize: 12, padding: '2px 0', minWidth: 80,
                      }}
                      defaultValue=""
                    >
                      <option value="" disabled>Ch…</option>
                      {Array.from({ length: 16 }, (_, i) => i + 1)
                        .filter(n => !channelsInUse.includes(n))
                        .map(n => (
                          <option key={n} value={n}>Ch {n}</option>
                        ))}
                    </select>
                  )}
                </div>
              </div>
              {channelsInUse.map(ch => {
                const isTarget   = hoveredChannel === ch && !!dragLine
                const isSelected = selectedPartId !== null && partsWithCh.some(p => p.part.id === selectedPartId && p.effectiveChannel === ch)
                const hasPartsAssigned = partsWithCh.some(p => p.effectiveChannel === ch)
                const dimmed = !hasPartsAssigned
                const dotColour = isTarget ? '#6ab8e8' : isSelected ? SEL_COLOUR : '#1a6fa0'
                const borderColour = isTarget ? '#6ab8e8' : isSelected ? SEL_COLOUR : '#0e639c'
                return (
                  <div
                    key={ch}
                    ref={el => { if (el) channelRowRefs.current.set(ch, el); else channelRowRefs.current.delete(ch) }}
                    onMouseEnter={() => onChannelEnter(ch)}
                    onMouseLeave={onChannelLeave}
                    style={{
                      height: 52, display: 'flex', alignItems: 'center', padding: '0 14px 0 16px', gap: 10,
                      background: isTarget ? 'rgba(106,184,232,0.1)' : isSelected ? 'rgba(224,148,74,0.10)' : 'transparent',
                      borderRight: `2px solid ${isSelected ? SEL_COLOUR : 'transparent'}`,
                      transition: 'background 0.15s, border-color 0.15s',
                      opacity: dimmed && !isTarget && !isSelected ? 0.35 : 1,
                    }}
                  >
                    {/* Input connector dot */}
                    <div style={{
                      width: 12, height: 12, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
                      background: dotColour,
                      border: `2px solid ${borderColour}`,
                      boxShadow: isTarget ? '0 0 8px rgba(106,184,232,0.6)' : isSelected ? `0 0 8px rgba(224,148,74,0.5)` : 'none',
                      transition: 'background 0.15s, box-shadow 0.15s',
                    }} />
                    <span style={{ fontSize: 13, color: isTarget ? '#d4d4d4' : isSelected ? '#e8c89a' : '#888', transition: 'color 0.15s' }}>Ch {ch}</span>
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
