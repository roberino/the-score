import { useState, useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import type {
  Staff, NoteEvent, Articulation,
  TimeSignature, DynamicLevel,
} from '@shared/score'
import {
  resolveTimeSig, resolveKeySig, resolveClef, resolveDirectiveTempo,
  eventDurationUnits, keyLabel, DURATION_LABELS,
} from '@shared/musicUtils'

// ── Types ─────────────────────────────────────────────────────────────────────

type EditorTab = 'notes' | 'expressions' | 'directives' | 'midi' | 'structure'

// ── Shared styles ─────────────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  background: '#252526', color: '#888', fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.5px',
  padding: '6px 10px', textAlign: 'left', fontWeight: 600,
  borderBottom: '1px solid #3e3e3e', whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  fontSize: 12, padding: '5px 10px', borderBottom: '1px solid #2a2a2a',
  color: '#d4d4d4', whiteSpace: 'nowrap',
}
const DIM = '#555'
const rowBg = (i: number) => i % 2 === 0 ? '#1e1e1e' : '#232323'
const nil = (s: string | number | undefined | null) =>
  s == null || s === '' ? <span style={{ color: DIM }}>—</span> : <>{s}</>

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatBeat(beatPosition: number, timeSig: TimeSignature): string {
  const unitsPerBeat = 64 / timeSig.denominator
  const beat = beatPosition / unitsPerBeat + 1
  return Number.isInteger(beat) ? String(beat) : beat.toFixed(1)
}

function formatAccidental(acc: string | null | undefined): string {
  if (!acc) return '—'
  if (acc === 'sharp')   return '♯'
  if (acc === 'flat')    return '♭'
  if (acc === 'natural') return '♮'
  return acc
}

function formatArticulations(arts: Articulation[]): string {
  return arts.length === 0 ? '—' : arts.join(', ')
}

function formatTimeSig(ts: TimeSignature | undefined): string {
  return ts ? `${ts.numerator}/${ts.denominator}` : '—'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Data builders ─────────────────────────────────────────────────────────────

interface NoteRow {
  key: string
  measureNumber: number
  beatPosition: number
  timeSig: TimeSignature
  voiceIndex: number
  event: NoteEvent
}

function buildNoteRows(staff: Staff, scoreTimeSig: TimeSignature): NoteRow[] {
  const rows: NoteRow[] = []
  for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
    const m = staff.measures[mIdx]
    const timeSig = resolveTimeSig(staff.measures, mIdx, scoreTimeSig)
    for (let vi = 0; vi < m.voices.length; vi++) {
      let beat = 0
      for (const event of m.voices[vi].events) {
        rows.push({ key: `${m.id}-${vi}-${event.id}`, measureNumber: m.number, beatPosition: beat, timeSig, voiceIndex: vi, event })
        beat += eventDurationUnits(event)
      }
    }
  }
  return rows
}

interface PositionedEntry {
  measureNumber: number
  beatPosition: number
  timeSig: TimeSignature
}

function findNoteInStaff(staff: Staff, noteId: string, scoreTimeSig: TimeSignature): PositionedEntry | null {
  for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
    const m = staff.measures[mIdx]
    const timeSig = resolveTimeSig(staff.measures, mIdx, scoreTimeSig)
    for (const voice of m.voices) {
      let beat = 0
      for (const event of voice.events) {
        if (event.id === noteId) return { measureNumber: m.number, beatPosition: beat, timeSig }
        beat += eventDurationUnits(event)
      }
    }
  }
  return null
}

interface DynamicRow {
  key: string
  measureNumber: number
  beatPosition: number
  timeSig: TimeSignature
  voiceIndex: number
  noteId: string
  dynamic: DynamicLevel
}

function buildDynamicRows(staff: Staff, scoreTimeSig: TimeSignature): DynamicRow[] {
  const rows: DynamicRow[] = []
  for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
    const m = staff.measures[mIdx]
    const timeSig = resolveTimeSig(staff.measures, mIdx, scoreTimeSig)
    for (let vi = 0; vi < m.voices.length; vi++) {
      let beat = 0
      for (const event of m.voices[vi].events) {
        const dyn = (event as any).dynamic as DynamicLevel | undefined
        if (dyn) rows.push({ key: `dyn-${event.id}`, measureNumber: m.number, beatPosition: beat, timeSig, voiceIndex: vi, noteId: event.id, dynamic: dyn })
        beat += eventDurationUnits(event)
      }
    }
  }
  return rows
}

// ── Notes tab ─────────────────────────────────────────────────────────────────

interface NotesTabProps {
  staff: Staff
  scoreTimeSig: TimeSignature
  filterBarFrom: string
  filterBarTo: string
  filterVoice: string
  filterType: string
  setFilterBarFrom: (v: string) => void
  setFilterBarTo: (v: string) => void
  setFilterVoice: (v: string) => void
  setFilterType: (v: string) => void
  expandedChordIds: Set<string>
  toggleChord: (id: string) => void
}

function NotesTab({ staff, scoreTimeSig, filterBarFrom, filterBarTo, filterVoice, filterType, setFilterBarFrom, setFilterBarTo, setFilterVoice, setFilterType, expandedChordIds, toggleChord }: NotesTabProps) {
  const allRows = useMemo(() => buildNoteRows(staff, scoreTimeSig), [staff, scoreTimeSig])

  const rows = useMemo(() => {
    const fromBar = filterBarFrom ? parseInt(filterBarFrom, 10) : null
    const toBar   = filterBarTo   ? parseInt(filterBarTo,   10) : null
    return allRows.filter(r => {
      if (fromBar !== null && r.measureNumber < fromBar) return false
      if (toBar   !== null && r.measureNumber > toBar)   return false
      if (filterVoice !== 'all' && r.voiceIndex !== parseInt(filterVoice, 10) - 1) return false
      if (filterType !== 'all' && r.event.type !== filterType) return false
      return true
    })
  }, [allRows, filterBarFrom, filterBarTo, filterVoice, filterType])

  const sel: React.CSSProperties = { padding: '3px 6px', background: '#2d2d2d', border: '1px solid #555', color: '#ccc', fontSize: 11, borderRadius: 3 }
  const inp: React.CSSProperties = { ...sel, width: 48 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#252526', borderBottom: '1px solid #3e3e3e', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#888' }}>Filter:</span>
        <span style={{ fontSize: 11, color: '#999' }}>Bars</span>
        <input type="number" min={1} value={filterBarFrom} onChange={e => setFilterBarFrom(e.target.value)} placeholder="from" style={inp} />
        <span style={{ fontSize: 11, color: '#666' }}>–</span>
        <input type="number" min={1} value={filterBarTo}   onChange={e => setFilterBarTo(e.target.value)}   placeholder="to"   style={inp} />
        <select value={filterVoice} onChange={e => setFilterVoice(e.target.value)} style={sel}>
          <option value="all">All voices</option>
          <option value="1">Voice 1</option>
          <option value="2">Voice 2</option>
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={sel}>
          <option value="all">All types</option>
          <option value="note">Note</option>
          <option value="rest">Rest</option>
          <option value="chord">Chord</option>
        </select>
        {(filterBarFrom || filterBarTo || filterVoice !== 'all' || filterType !== 'all') && (
          <button onClick={() => { setFilterBarFrom(''); setFilterBarTo(''); setFilterVoice('all'); setFilterType('all') }}
            style={{ padding: '2px 8px', background: 'none', border: '1px solid #555', color: '#888', fontSize: 11, borderRadius: 3, cursor: 'pointer' }}>
            Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#555' }}>{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div style={{ overflow: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
            <tr>
              {['Bar', 'Beat', 'Voice', 'Type', 'Note', 'Oct', 'Acc', 'Duration', 'Dots', 'Tie→', '←Tie', 'Dynamic', 'Lyric', 'Articulations', 'Tuplet'].map(h => (
                <th key={h} style={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={15} style={{ ...TD, color: DIM, textAlign: 'center', padding: '24px' }}>No events match the current filter.</td></tr>
            )}
            {rows.map((r, i) => {
              const ev = r.event
              const isChord = ev.type === 'chord'
              const isExpanded = isChord && expandedChordIds.has(ev.id)
              const rowStyle = { ...TD, background: rowBg(i) }
              const beat = formatBeat(r.beatPosition, r.timeSig)
              const voice = String(r.voiceIndex + 1)
              const durLabel = DURATION_LABELS[ev.duration]
              const dots = String(ev.dots)
              const tieStart = ev.type === 'note' ? (ev.tieStart ? '✓' : '') : ''
              const tieEnd   = ev.type === 'note' ? (ev.tieEnd   ? '✓' : '') : ''
              const dynamic  = (ev as any).dynamic as DynamicLevel | undefined
              const lyric    = (ev as any).lyric as string | undefined
              const arts     = ev.type === 'note' || ev.type === 'chord' ? ev.articulations : []
              const tuplet   = (ev as any).tuplet as { actual: number; normal: number } | undefined
              const tupLabel = tuplet ? `${tuplet.actual}:${tuplet.normal}` : undefined

              let noteCell: React.ReactNode
              let octCell: React.ReactNode
              let accCell: React.ReactNode

              if (ev.type === 'rest') {
                noteCell = <span style={{ color: DIM }}>—</span>
                octCell  = <span style={{ color: DIM }}>—</span>
                accCell  = <span style={{ color: DIM }}>—</span>
              } else if (ev.type === 'note') {
                noteCell = ev.pitch.noteName
                octCell  = String(ev.pitch.octave)
                accCell  = formatAccidental(ev.pitch.accidental)
              } else {
                // chord
                const lowest = ev.pitches[0]
                const count  = ev.pitches.length
                noteCell = (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button onClick={() => toggleChord(ev.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 10, padding: 0, lineHeight: 1 }}>
                      {isExpanded ? '▼' : '▶'}
                    </button>
                    {lowest?.noteName ?? '—'}{count > 1 ? ` +${count - 1}` : ''}
                  </span>
                )
                octCell = lowest ? String(lowest.octave) : <span style={{ color: DIM }}>—</span>
                accCell = lowest ? formatAccidental(lowest.accidental) : <span style={{ color: DIM }}>—</span>
              }

              return [
                <tr key={r.key} style={{ background: rowBg(i) }}>
                  <td style={rowStyle}>{r.measureNumber}</td>
                  <td style={rowStyle}>{beat}</td>
                  <td style={rowStyle}>{voice}</td>
                  <td style={rowStyle}>{capitalize(ev.type)}</td>
                  <td style={rowStyle}>{noteCell}</td>
                  <td style={rowStyle}>{octCell}</td>
                  <td style={rowStyle}>{accCell}</td>
                  <td style={rowStyle}>{durLabel}</td>
                  <td style={rowStyle}>{dots}</td>
                  <td style={rowStyle}>{tieStart || <span style={{ color: DIM }}>—</span>}</td>
                  <td style={rowStyle}>{tieEnd   || <span style={{ color: DIM }}>—</span>}</td>
                  <td style={rowStyle}>{nil(dynamic)}</td>
                  <td style={rowStyle}>{nil(lyric)}</td>
                  <td style={rowStyle}>{arts.length > 0 ? formatArticulations(arts) : <span style={{ color: DIM }}>—</span>}</td>
                  <td style={rowStyle}>{nil(tupLabel)}</td>
                </tr>,
                // chord sub-rows
                ...(isExpanded && ev.type === 'chord'
                  ? ev.pitches.map((p, pi) => (
                    <tr key={`${r.key}-p${pi}`} style={{ background: '#1a2a3a' }}>
                      <td style={{ ...TD, color: DIM }} />
                      <td style={{ ...TD, color: DIM }} />
                      <td style={{ ...TD, color: DIM }} />
                      <td style={{ ...TD, color: '#4a9eff', paddingLeft: 24 }}>pitch {pi + 1}</td>
                      <td style={{ ...TD }}>{p.noteName}</td>
                      <td style={{ ...TD }}>{p.octave}</td>
                      <td style={{ ...TD }}>{formatAccidental(p.accidental)}</td>
                      <td colSpan={8} style={{ ...TD, color: DIM }} />
                    </tr>
                  ))
                  : []
                ),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Expressions tab ───────────────────────────────────────────────────────────

interface ExpressionsTabProps {
  staff: Staff
  scoreTimeSig: TimeSignature
  onNavigateToDynamic: (barNumber: number) => void
}

function ExpressionsTab({ staff, scoreTimeSig, onNavigateToDynamic }: ExpressionsTabProps) {
  const hairpins = staff.hairpins ?? []
  const slurs    = staff.slurs    ?? []
  const dynRows  = useMemo(() => buildDynamicRows(staff, scoreTimeSig), [staff, scoreTimeSig])

  const resolvedHairpins = useMemo(() =>
    hairpins.map(h => ({
      h,
      from: findNoteInStaff(staff, h.fromNoteId, scoreTimeSig),
      to:   findNoteInStaff(staff, h.toNoteId,   scoreTimeSig),
    })), [hairpins, staff, scoreTimeSig])

  const resolvedSlurs = useMemo(() =>
    slurs.map(s => ({
      s,
      from: findNoteInStaff(staff, s.fromNoteId, scoreTimeSig),
      to:   findNoteInStaff(staff, s.toNoteId,   scoreTimeSig),
    })), [slurs, staff, scoreTimeSig])

  const sectionHeader = (title: string, count: number) => (
    <div style={{ padding: '8px 12px', background: '#252526', borderBottom: '1px solid #3e3e3e', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
      {title}
      <span style={{ background: '#333', borderRadius: 9, padding: '1px 7px', fontSize: 10, color: '#666' }}>{count}</span>
    </div>
  )

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      {/* Hairpins */}
      {sectionHeader('Hairpins', hairpins.length)}
      {hairpins.length === 0
        ? <div style={{ padding: '12px', fontSize: 12, color: DIM }}>No hairpins on this staff.</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['Type', 'From bar', 'From beat', 'To bar', 'To beat'].map(h => <th key={h} style={TH}>{h}</th>)}
            </tr></thead>
            <tbody>
              {resolvedHairpins.map(({ h, from, to }, i) => (
                <tr key={h.id} style={{ background: rowBg(i) }}>
                  <td style={TD}>{capitalize(h.type)}</td>
                  <td style={TD}>{from ? from.measureNumber : <span style={{ color: DIM }}>?</span>}</td>
                  <td style={TD}>{from ? formatBeat(from.beatPosition, from.timeSig) : <span style={{ color: DIM }}>?</span>}</td>
                  <td style={TD}>{to   ? to.measureNumber   : <span style={{ color: DIM }}>?</span>}</td>
                  <td style={TD}>{to   ? formatBeat(to.beatPosition, to.timeSig)   : <span style={{ color: DIM }}>?</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      {/* Slurs */}
      {sectionHeader('Slurs', slurs.length)}
      {slurs.length === 0
        ? <div style={{ padding: '12px', fontSize: 12, color: DIM }}>No slurs on this staff.</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['From bar', 'From beat', 'To bar', 'To beat', 'Placement'].map(h => <th key={h} style={TH}>{h}</th>)}
            </tr></thead>
            <tbody>
              {resolvedSlurs.map(({ s, from, to }, i) => (
                <tr key={s.id} style={{ background: rowBg(i) }}>
                  <td style={TD}>{from ? from.measureNumber : <span style={{ color: DIM }}>?</span>}</td>
                  <td style={TD}>{from ? formatBeat(from.beatPosition, from.timeSig) : <span style={{ color: DIM }}>?</span>}</td>
                  <td style={TD}>{to   ? to.measureNumber   : <span style={{ color: DIM }}>?</span>}</td>
                  <td style={TD}>{to   ? formatBeat(to.beatPosition, to.timeSig)   : <span style={{ color: DIM }}>?</span>}</td>
                  <td style={TD}>{s.placement ? capitalize(s.placement) : <span style={{ color: DIM }}>Auto</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      {/* Note dynamics summary */}
      {sectionHeader('Note dynamics', dynRows.length)}
      {dynRows.length === 0
        ? <div style={{ padding: '12px', fontSize: 12, color: DIM }}>No note-attached dynamics on this staff.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {dynRows.map((r, i) => (
              <button
                key={r.key}
                onClick={() => onNavigateToDynamic(r.measureNumber)}
                style={{
                  background: rowBg(i), border: 'none', borderBottom: '1px solid #2a2a2a',
                  color: '#d4d4d4', fontSize: 12, padding: '6px 12px', textAlign: 'left',
                  cursor: 'pointer', display: 'flex', gap: 12,
                }}
              >
                <span style={{ color: '#888' }}>Bar {r.measureNumber}, Beat {formatBeat(r.beatPosition, r.timeSig)}, Voice {r.voiceIndex + 1}</span>
                <span style={{ fontStyle: 'italic', fontWeight: 600 }}>{r.dynamic}</span>
                <span style={{ color: '#555', fontSize: 11 }}>→ show in Notes</span>
              </button>
            ))}
          </div>
        )
      }
    </div>
  )
}

// ── Directives tab ────────────────────────────────────────────────────────────

function DirectivesTab({ staff }: { staff: Staff }) {
  const rows = useMemo(() => {
    const out: { key: string; measureNumber: number; category: string; text: string; bpm: number | undefined; midiProgram: number | undefined }[] = []
    for (const m of staff.measures) {
      for (const d of m.directives ?? []) {
        out.push({ key: d.id, measureNumber: m.number, category: d.category, text: d.text, bpm: d.bpm, midiProgram: d.midiProgram })
      }
    }
    return out
  }, [staff])

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          {['Bar', 'Category', 'Text', 'BPM', 'MIDI program'].map(h => <th key={h} style={TH}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} style={{ ...TD, color: DIM, textAlign: 'center', padding: '24px' }}>No directives on this staff.</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.key} style={{ background: rowBg(i) }}>
              <td style={TD}>{r.measureNumber}</td>
              <td style={TD}>{capitalize(r.category)}</td>
              <td style={TD}>{r.text || <span style={{ color: DIM }}>—</span>}</td>
              <td style={TD}>{nil(r.bpm)}</td>
              <td style={TD}>{r.midiProgram != null ? r.midiProgram : <span style={{ color: DIM }}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── MIDI tab ──────────────────────────────────────────────────────────────────

function MidiTab({ staff, scoreTimeSig }: { staff: Staff; scoreTimeSig: TimeSignature }) {
  const midiRows = useMemo(() => {
    const out: { key: string; measureNumber: number; beatPosition: number; timeSig: TimeSignature; event: NonNullable<typeof staff.measures[0]['midiEvents']>[0] }[] = []
    for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
      const m = staff.measures[mIdx]
      const timeSig = resolveTimeSig(staff.measures, mIdx, scoreTimeSig)
      for (const ev of m.midiEvents ?? []) {
        out.push({ key: ev.id, measureNumber: m.number, beatPosition: ev.beatPosition, timeSig, event: ev })
      }
    }
    return out
  }, [staff, scoreTimeSig])

  const pedalRows = useMemo(() => {
    const out: { key: string; measureNumber: number; beatPosition: number; timeSig: TimeSignature; mark: NonNullable<typeof staff.measures[0]['pedalMarks']>[0] }[] = []
    for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
      const m = staff.measures[mIdx]
      const timeSig = resolveTimeSig(staff.measures, mIdx, scoreTimeSig)
      for (const mark of m.pedalMarks ?? []) {
        out.push({ key: mark.id, measureNumber: m.number, beatPosition: mark.beatPosition, timeSig, mark })
      }
    }
    return out
  }, [staff, scoreTimeSig])

  const sectionHeader = (title: string, count: number) => (
    <div style={{ padding: '8px 12px', background: '#252526', borderBottom: '1px solid #3e3e3e', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
      {title}
      <span style={{ background: '#333', borderRadius: 9, padding: '1px 7px', fontSize: 10, color: '#666' }}>{count}</span>
    </div>
  )

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      {sectionHeader('MIDI events', midiRows.length)}
      {midiRows.length === 0
        ? <div style={{ padding: '12px', fontSize: 12, color: DIM }}>No MIDI score events on this staff.</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['Bar', 'Beat', 'Type', 'CC#', 'CC value', 'Program', 'PB value', 'SysEx'].map(h => <th key={h} style={TH}>{h}</th>)}
            </tr></thead>
            <tbody>
              {midiRows.map(({ key, measureNumber, beatPosition, timeSig, event: ev }, i) => (
                <tr key={key} style={{ background: rowBg(i) }}>
                  <td style={TD}>{measureNumber}</td>
                  <td style={TD}>{formatBeat(beatPosition, timeSig)}</td>
                  <td style={TD}>{ev.type.toUpperCase()}</td>
                  <td style={{ ...TD, color: ev.cc   ? '#d4d4d4' : DIM }}>{ev.cc   ? ev.cc.controller : '—'}</td>
                  <td style={{ ...TD, color: ev.cc   ? '#d4d4d4' : DIM }}>{ev.cc   ? ev.cc.value      : '—'}</td>
                  <td style={{ ...TD, color: ev.pc   ? '#d4d4d4' : DIM }}>{ev.pc   ? ev.pc.program    : '—'}</td>
                  <td style={{ ...TD, color: ev.pb   ? '#d4d4d4' : DIM }}>{ev.pb   ? ev.pb.value      : '—'}</td>
                  <td style={{ ...TD, color: ev.sysex ? '#d4d4d4' : DIM, fontFamily: 'monospace', fontSize: 11 }}>{ev.sysex ? ev.sysex.hex : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      {sectionHeader('Pedal marks', pedalRows.length)}
      {pedalRows.length === 0
        ? <div style={{ padding: '12px', fontSize: 12, color: DIM }}>No pedal marks on this staff.</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['Bar', 'Beat', 'Type'].map(h => <th key={h} style={TH}>{h}</th>)}
            </tr></thead>
            <tbody>
              {pedalRows.map(({ key, measureNumber, beatPosition, timeSig, mark }, i) => (
                <tr key={key} style={{ background: rowBg(i) }}>
                  <td style={TD}>{measureNumber}</td>
                  <td style={TD}>{formatBeat(beatPosition, timeSig)}</td>
                  <td style={TD}>{capitalize(mark.type)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  )
}

// ── Structure tab ─────────────────────────────────────────────────────────────

function StructureTab({ staff, score }: { staff: Staff; score: import('@shared/score').Score }) {
  const rows = useMemo(() => staff.measures.map((m, mIdx) => ({
    key: m.id,
    number: m.number,
    barline: m.barline ?? '—',
    timeSig:  resolveTimeSig(staff.measures,  mIdx, score.timeSignature),
    ownTimeSig: m.timeSignature,
    keySig:  resolveKeySig(staff.measures,   mIdx, score.keySignature),
    ownKeySig: m.keySignature,
    clef:    resolveClef(staff.measures,     mIdx, staff.clef),
    ownClef: m.clef?.type,
    tempo:   resolveDirectiveTempo(staff.measures, mIdx, score.tempo),
    ownTempo: m.tempo,
  })), [staff, score])

  const inherited = (own: unknown) => !own

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          {['Bar', 'Barline', 'Time sig', 'Key sig', 'Clef', 'Tempo (♩=)'].map(h => <th key={h} style={TH}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} style={{ background: rowBg(i) }}>
              <td style={TD}>{r.number}</td>
              <td style={TD}>{r.barline}</td>
              <td style={{ ...TD, color: inherited(r.ownTimeSig) ? DIM : '#d4d4d4' }}>
                {formatTimeSig(r.timeSig)}
                {inherited(r.ownTimeSig) && <span style={{ fontSize: 10, marginLeft: 4 }}>(inh.)</span>}
              </td>
              <td style={{ ...TD, color: inherited(r.ownKeySig) ? DIM : '#d4d4d4' }}>
                {keyLabel(r.keySig)}
                {inherited(r.ownKeySig) && <span style={{ fontSize: 10, marginLeft: 4 }}>(inh.)</span>}
              </td>
              <td style={{ ...TD, color: inherited(r.ownClef) ? DIM : '#d4d4d4' }}>
                {capitalize(r.clef)}
                {inherited(r.ownClef) && <span style={{ fontSize: 10, marginLeft: 4 }}>(inh.)</span>}
              </td>
              <td style={{ ...TD, color: inherited(r.ownTempo) ? DIM : '#d4d4d4' }}>
                {r.tempo}
                {inherited(r.ownTempo) && <span style={{ fontSize: 10, marginLeft: 4 }}>(inh.)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const TABS: { id: EditorTab; label: string }[] = [
  { id: 'notes',       label: 'Notes'       },
  { id: 'expressions', label: 'Expressions' },
  { id: 'directives',  label: 'Directives'  },
  { id: 'midi',        label: 'MIDI'        },
  { id: 'structure',   label: 'Structure'   },
]

export function EventEditorView(): JSX.Element {
  const { score } = useAppStore()

  const [selectedPartId,   setSelectedPartId]   = useState(score.parts[0]?.id ?? '')
  const [selectedStaveIdx, setSelectedStaveIdx] = useState(0)
  const [activeTab,        setActiveTab]        = useState<EditorTab>('notes')

  // Notes filter state (lifted so Expressions tab can navigate here)
  const [filterBarFrom, setFilterBarFrom] = useState('')
  const [filterBarTo,   setFilterBarTo]   = useState('')
  const [filterVoice,   setFilterVoice]   = useState('all')
  const [filterType,    setFilterType]    = useState('all')

  // Chord expansion state
  const [expandedChordIds, setExpandedChordIds] = useState<Set<string>>(new Set())
  const toggleChord = (id: string) => setExpandedChordIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const part  = score.parts.find(p => p.id === selectedPartId) ?? score.parts[0]
  const staff = part?.staves[selectedStaveIdx] ?? part?.staves[0]

  // Reset stave index when part changes
  const handlePartChange = (partId: string) => {
    setSelectedPartId(partId)
    setSelectedStaveIdx(0)
    setFilterBarFrom('')
    setFilterBarTo('')
    setFilterVoice('all')
    setFilterType('all')
    setExpandedChordIds(new Set())
  }

  const navigateToDynamic = (barNumber: number) => {
    setActiveTab('notes')
    setFilterBarFrom(String(barNumber))
    setFilterBarTo(String(barNumber))
  }

  const selStyle: React.CSSProperties = {
    padding: '4px 8px', background: '#2d2d2d', border: '1px solid #555',
    color: '#ccc', fontSize: 12, borderRadius: 3, cursor: 'pointer',
  }

  if (!part || !staff) {
    return <div style={{ padding: 24, color: DIM, fontSize: 13 }}>No score loaded.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e', color: '#d4d4d4' }}>
      {/* Part / stave selectors */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: '#252526', borderBottom: '1px solid #3e3e3e', flexShrink: 0 }}>
        <label style={{ fontSize: 11, color: '#888' }}>Part</label>
        <select value={selectedPartId} onChange={e => handlePartChange(e.target.value)} style={selStyle}>
          {score.parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {part.staves.length > 1 && (
          <>
            <label style={{ fontSize: 11, color: '#888' }}>Stave</label>
            <select value={selectedStaveIdx} onChange={e => setSelectedStaveIdx(Number(e.target.value))} style={selStyle}>
              {part.staves.map((s, i) => (
                <option key={s.id} value={i}>{capitalize(s.clef)}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Category tabs */}
      <div style={{ display: 'flex', background: '#252526', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '6px 16px', background: 'none', border: 'none',
              borderBottom: activeTab === t.id ? '2px solid #0e639c' : '2px solid transparent',
              color: activeTab === t.id ? '#d4d4d4' : '#666',
              fontSize: 12, cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'notes' && (
          <NotesTab
            staff={staff}
            scoreTimeSig={score.timeSignature}
            filterBarFrom={filterBarFrom}
            filterBarTo={filterBarTo}
            filterVoice={filterVoice}
            filterType={filterType}
            setFilterBarFrom={setFilterBarFrom}
            setFilterBarTo={setFilterBarTo}
            setFilterVoice={setFilterVoice}
            setFilterType={setFilterType}
            expandedChordIds={expandedChordIds}
            toggleChord={toggleChord}
          />
        )}
        {activeTab === 'expressions' && (
          <ExpressionsTab staff={staff} scoreTimeSig={score.timeSignature} onNavigateToDynamic={navigateToDynamic} />
        )}
        {activeTab === 'directives' && (
          <DirectivesTab staff={staff} />
        )}
        {activeTab === 'midi' && (
          <MidiTab staff={staff} scoreTimeSig={score.timeSignature} />
        )}
        {activeTab === 'structure' && (
          <StructureTab staff={staff} score={score} />
        )}
      </div>
    </div>
  )
}
