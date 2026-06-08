import { useState, useMemo } from 'react'
import { v4 as uuid } from 'uuid'
import { useAppStore } from '../store/appStore'
import type {
  Staff, NoteEvent, Articulation, TimeSignature, DynamicLevel, Duration,
  NoteName, BarlineType, ClefType,
} from '@shared/score'
import type { Command } from '@shared/commands'
import {
  resolveTimeSig, resolveKeySig, resolveClef, resolveDirectiveTempo,
  eventDurationUnits, dottedUnits, DURATION_UNITS,
  fillWithRests, keyLabel, DURATION_LABELS,
} from '@shared/musicUtils'

// ── Types ─────────────────────────────────────────────────────────────────────

type EditorTab = 'notes' | 'expressions' | 'directives' | 'midi' | 'structure'

interface NoteRow {
  key: string
  partId: string
  staffId: string
  measureId: string
  voiceId: string
  measureNumber: number
  beatPosition: number
  timeSig: TimeSignature
  voiceIndex: number
  event: NoteEvent
}

// ── Styles ────────────────────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  background: '#252526', color: '#888', fontSize: 11, textTransform: 'uppercase',
  letterSpacing: '0.5px', padding: '6px 10px', textAlign: 'left', fontWeight: 600,
  borderBottom: '1px solid #3e3e3e', whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  fontSize: 12, padding: '5px 10px', borderBottom: '1px solid #2a2a2a',
  color: '#d4d4d4', whiteSpace: 'nowrap',
}
const DIM = '#555'
const rowBg = (i: number) => i % 2 === 0 ? '#1e1e1e' : '#232323'
const nil = (v: string | number | undefined | null) =>
  v == null || v === '' ? <span style={{ color: DIM }}>—</span> : <>{v}</>

const EDIT_INPUT: React.CSSProperties = {
  background: '#0a2a40', border: '1px solid #0e639c', color: '#fff',
  fontSize: 12, padding: '2px 6px', borderRadius: 2, outline: 'none',
}
const EDIT_SELECT: React.CSSProperties = { ...EDIT_INPUT, cursor: 'pointer' }
const DEL_BTN: React.CSSProperties = {
  background: 'none', border: '1px solid #555', color: '#888', fontSize: 10,
  cursor: 'pointer', borderRadius: 2, padding: '1px 5px', lineHeight: 1.4,
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatBeat(pos: number, ts: TimeSignature): string {
  const beat = pos / (64 / ts.denominator) + 1
  return Number.isInteger(beat) ? String(beat) : beat.toFixed(1)
}
const fmtAcc = (a: string | null | undefined) =>
  !a ? '—' : a === 'sharp' ? '♯' : a === 'flat' ? '♭' : a === 'natural' ? '♮' : a
const fmtArts = (arts: Articulation[]) => arts.length ? arts.join(', ') : '—'
const fmtTs   = (ts: TimeSignature | undefined) => ts ? `${ts.numerator}/${ts.denominator}` : '—'
const cap     = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ── Data builders ─────────────────────────────────────────────────────────────

function buildNoteRows(staff: Staff, partId: string, staffId: string, scoreTs: TimeSignature): NoteRow[] {
  const rows: NoteRow[] = []
  for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
    const m = staff.measures[mIdx]
    const ts = resolveTimeSig(staff.measures, mIdx, scoreTs)
    for (let vi = 0; vi < m.voices.length; vi++) {
      let beat = 0
      for (const event of m.voices[vi].events) {
        rows.push({ key: `${m.id}-${vi}-${event.id}`, partId, staffId, measureId: m.id, voiceId: m.voices[vi].id, measureNumber: m.number, beatPosition: beat, timeSig: ts, voiceIndex: vi, event })
        beat += eventDurationUnits(event)
      }
    }
  }
  return rows
}

function findNoteInStaff(staff: Staff, noteId: string, scoreTs: TimeSignature) {
  for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
    const m = staff.measures[mIdx]
    const ts = resolveTimeSig(staff.measures, mIdx, scoreTs)
    for (const voice of m.voices) {
      let beat = 0
      for (const ev of voice.events) {
        if (ev.id === noteId) return { measureNumber: m.number, beatPosition: beat, timeSig: ts }
        beat += eventDurationUnits(ev)
      }
    }
  }
  return null
}

function buildDynRows(staff: Staff, scoreTs: TimeSignature) {
  const rows: { key: string; measureNumber: number; beatPosition: number; timeSig: TimeSignature; voiceIndex: number; dynamic: DynamicLevel }[] = []
  for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
    const m = staff.measures[mIdx]
    const ts = resolveTimeSig(staff.measures, mIdx, scoreTs)
    for (let vi = 0; vi < m.voices.length; vi++) {
      let beat = 0
      for (const ev of m.voices[vi].events) {
        const dyn = (ev as any).dynamic as DynamicLevel | undefined
        if (dyn) rows.push({ key: `dyn-${ev.id}`, measureNumber: m.number, beatPosition: beat, timeSig: ts, voiceIndex: vi, dynamic: dyn })
        beat += eventDurationUnits(ev)
      }
    }
  }
  return rows
}

// ── Duration edit helper ──────────────────────────────────────────────────────

function commitDurationChange(
  row: NoteRow, staff: Staff, _scoreTs: TimeSignature,
  newDur: Duration, newDots: 0 | 1 | 2,
  dispatchBatch: (cmds: Command[]) => void,
  onError: (msg: string) => void,
  onSuccess: () => void,
) {
  const ev = row.event
  const newUnits = dottedUnits(DURATION_UNITS[newDur], newDots)
  const oldUnits = dottedUnits(DURATION_UNITS[ev.duration], ev.dots ?? 0)
  if (newUnits === oldUnits) { onSuccess(); return }

  const mIdx = staff.measures.findIndex(m => m.id === row.measureId)
  if (mIdx === -1) { onError('Measure not found'); return }
  const voice = staff.measures[mIdx].voices.find(v => v.id === row.voiceId)
  if (!voice) { onError('Voice not found'); return }
  const events = voice.events as NoteEvent[]
  const noteIdx = events.findIndex(e => e.id === ev.id)
  if (noteIdx === -1) { onError('Event not found'); return }

  const cmds: Command[] = []
  const loc = { partId: row.partId, staffId: row.staffId, measureId: row.measureId, voiceId: row.voiceId }

  if (newUnits > oldUnits) {
    const needed = newUnits - oldUnits
    let available = 0
    const restIds: string[] = []
    for (let i = noteIdx + 1; i < events.length; i++) {
      if (events[i].type !== 'rest') break
      available += eventDurationUnits(events[i])
      restIds.push(events[i].id)
      if (available >= needed) break
    }
    if (available < needed) {
      onError(`No space: need ${needed} units, only ${available} available after this event`)
      return
    }
    cmds.push({ type: 'REPLACE_NOTE', ...loc, noteId: ev.id, event: { ...ev, duration: newDur, dots: newDots } as NoteEvent })
    restIds.forEach(id => cmds.push({ type: 'DELETE_NOTE', ...loc, noteId: id }))
    const rem = available - needed
    if (rem > 0) fillWithRests(rem).forEach((r, i) => cmds.push({ type: 'ADD_NOTE', ...loc, event: r, index: noteIdx + 1 + i }))
  } else {
    const freed = oldUnits - newUnits
    cmds.push({ type: 'REPLACE_NOTE', ...loc, noteId: ev.id, event: { ...ev, duration: newDur, dots: newDots } as NoteEvent })
    fillWithRests(freed).forEach((r, i) => cmds.push({ type: 'ADD_NOTE', ...loc, event: r, index: noteIdx + 1 + i }))
  }

  dispatchBatch(cmds)
  onSuccess()
}

// ── Shared constants ──────────────────────────────────────────────────────────

const DURATIONS: Duration[] = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th']
const NOTE_NAMES: NoteName[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const DYNAMICS: DynamicLevel[] = ['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff']
const BARLINES: BarlineType[] = ['single', 'double', 'repeat-start', 'repeat-end', 'final']
const CLEFS: ClefType[] = ['treble', 'bass', 'alto', 'tenor', 'percussion']
const ALL_ARTS: Articulation[] = ['staccato', 'accent', 'tenuto', 'marcato', 'fermata', 'trill', 'mordent', 'mordent-upper', 'turn']
const ART_ABBREV: Record<Articulation, string> = { staccato: 'stacc', accent: 'acc', tenuto: 'ten', marcato: 'marc', fermata: 'ferm', trill: 'tr', mordent: 'mord', 'mordent-upper': 'umrd', turn: 'turn' }
const KEY_OPTIONS = [
  ...[0,1,2,3,4,5,6,7,-1,-2,-3,-4,-5,-6,-7].map(f => ({ fifths: f, mode: 'major' as const })),
  ...[0,1,2,3,4,5,6,7,-1,-2,-3,-4,-5,-6,-7].map(f => ({ fifths: f, mode: 'minor' as const })),
].sort((a, b) => a.fifths - b.fifths || a.mode.localeCompare(b.mode))

// ── Notes tab ─────────────────────────────────────────────────────────────────

function NotesTab({ staff, partId, staffId, scoreTs, dispatch, dispatchBatch, filterBarFrom, filterBarTo, filterVoice, filterType, setFilterBarFrom, setFilterBarTo, setFilterVoice, setFilterType, expandedIds, toggleExpand }: {
  staff: Staff; partId: string; staffId: string; scoreTs: TimeSignature
  dispatch: (c: Command) => void; dispatchBatch: (cs: Command[]) => void
  filterBarFrom: string; filterBarTo: string; filterVoice: string; filterType: string
  setFilterBarFrom: (v: string) => void; setFilterBarTo: (v: string) => void
  setFilterVoice: (v: string) => void; setFilterType: (v: string) => void
  expandedIds: Set<string>; toggleExpand: (id: string) => void
}) {
  const [editCell, setEditCell] = useState<{ key: string; col: string } | null>(null)
  const [editVal,  setEditVal]  = useState('')
  const [editErr,  setEditErr]  = useState<string | null>(null)

  const allRows = useMemo(() => buildNoteRows(staff, partId, staffId, scoreTs), [staff, partId, staffId, scoreTs])

  const rows = useMemo(() => {
    const from = filterBarFrom ? parseInt(filterBarFrom) : null
    const to   = filterBarTo   ? parseInt(filterBarTo)   : null
    return allRows.filter(r => {
      if (from !== null && r.measureNumber < from) return false
      if (to   !== null && r.measureNumber > to)   return false
      if (filterVoice !== 'all' && r.voiceIndex !== parseInt(filterVoice) - 1) return false
      if (filterType  !== 'all' && r.event.type !== filterType) return false
      return true
    })
  }, [allRows, filterBarFrom, filterBarTo, filterVoice, filterType])

  function startEdit(key: string, col: string, val: string) {
    setEditCell({ key, col }); setEditVal(val); setEditErr(null)
  }
  function cancelEdit() { setEditCell(null); setEditErr(null) }

  function commitEdit(row: NoteRow, col: string, val: string) {
    const ev = row.event
    const loc = { partId: row.partId, staffId: row.staffId, measureId: row.measureId, voiceId: row.voiceId }

    if (col === 'note') {
      if (ev.type !== 'note' || !NOTE_NAMES.includes(val as NoteName)) { cancelEdit(); return }
      dispatch({ type: 'REPLACE_NOTE', ...loc, noteId: ev.id, event: { ...ev, pitch: { ...ev.pitch, noteName: val as NoteName } } })
    } else if (col === 'octave') {
      if (ev.type !== 'note') { cancelEdit(); return }
      const oct = parseInt(val)
      if (isNaN(oct) || oct < 0 || oct > 9) { setEditErr('Octave must be 0–9'); return }
      dispatch({ type: 'REPLACE_NOTE', ...loc, noteId: ev.id, event: { ...ev, pitch: { ...ev.pitch, octave: oct } } })
    } else if (col === 'acc') {
      if (ev.type !== 'note') { cancelEdit(); return }
      const acc = val === '♯' ? 'sharp' : val === '♭' ? 'flat' : val === '♮' ? 'natural' : null
      dispatch({ type: 'REPLACE_NOTE', ...loc, noteId: ev.id, event: { ...ev, pitch: { ...ev.pitch, accidental: acc } } })
    } else if (col === 'dur') {
      commitDurationChange(row, staff, scoreTs, val as Duration, ev.dots ?? 0 as 0|1|2, dispatchBatch, setEditErr, cancelEdit)
      return
    } else if (col === 'dots') {
      commitDurationChange(row, staff, scoreTs, ev.duration, parseInt(val) as 0|1|2, dispatchBatch, setEditErr, cancelEdit)
      return
    } else if (col === 'dyn') {
      dispatch({ type: 'SET_NOTE_DYNAMIC', noteId: ev.id, dynamic: val === '—' ? undefined : val as DynamicLevel })
    } else if (col === 'vel') {
      if (ev.type === 'rest') { cancelEdit(); return }
      if (val === '—' || val === '') {
        dispatch({ type: 'SET_NOTE_VELOCITY', noteId: ev.id, velocity: undefined })
      } else {
        const v = parseInt(val)
        if (isNaN(v) || v < 0 || v > 127) { setEditErr('Velocity must be 0–127'); return }
        dispatch({ type: 'SET_NOTE_VELOCITY', noteId: ev.id, velocity: v })
      }
    } else if (col === 'lyric') {
      dispatch({ type: 'SET_LYRIC', noteId: ev.id, lyric: val.trim() || undefined })
    } else {
      cancelEdit(); return
    }
    cancelEdit()
  }

  function toggleTie(row: NoteRow, field: 'tieStart' | 'tieEnd') {
    if (row.event.type !== 'note') return
    const ev = row.event
    dispatch({ type: 'REPLACE_NOTE', partId: row.partId, staffId: row.staffId, measureId: row.measureId, voiceId: row.voiceId, noteId: ev.id, event: { ...ev, [field]: !ev[field] } })
  }

  function toggleArt(row: NoteRow, art: Articulation, isOn: boolean) {
    dispatch({ type: 'SET_ARTICULATION', targets: [{ partId: row.partId, staffId: row.staffId, measureId: row.measureId, voiceId: row.voiceId, noteId: row.event.id }], articulation: art, on: !isOn })
  }

  const sel: React.CSSProperties = { padding: '3px 6px', background: '#2d2d2d', border: '1px solid #555', color: '#ccc', fontSize: 11, borderRadius: 3 }
  const inp: React.CSSProperties = { ...sel, width: 48 }

  const isEditing = (key: string, col: string) => editCell?.key === key && editCell?.col === col

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#252526', borderBottom: '1px solid #3e3e3e', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#888' }}>Filter:</span>
        <span style={{ fontSize: 11, color: '#999' }}>Bars</span>
        <input type="number" min={1} value={filterBarFrom} onChange={e => setFilterBarFrom(e.target.value)} placeholder="from" style={inp} />
        <span style={{ fontSize: 11, color: '#666' }}>–</span>
        <input type="number" min={1} value={filterBarTo} onChange={e => setFilterBarTo(e.target.value)} placeholder="to" style={inp} />
        <select value={filterVoice} onChange={e => setFilterVoice(e.target.value)} style={sel}><option value="all">All voices</option><option value="1">Voice 1</option><option value="2">Voice 2</option></select>
        <select value={filterType}  onChange={e => setFilterType(e.target.value)}  style={sel}><option value="all">All types</option><option value="note">Note</option><option value="rest">Rest</option><option value="chord">Chord</option></select>
        {(filterBarFrom || filterBarTo || filterVoice !== 'all' || filterType !== 'all') && (
          <button onClick={() => { setFilterBarFrom(''); setFilterBarTo(''); setFilterVoice('all'); setFilterType('all') }} style={{ padding: '2px 8px', background: 'none', border: '1px solid #555', color: '#888', fontSize: 11, borderRadius: 3, cursor: 'pointer' }}>Clear</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#555' }}>{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
      </div>

      {editErr && <div style={{ padding: '4px 12px', background: '#3a1a1a', color: '#ff9090', fontSize: 11, flexShrink: 0 }}>{editErr}</div>}

      <div style={{ overflow: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Bar','Beat','Voice','Type','Note','Oct','Acc','Duration','Dots','Tie→','←Tie','Dynamic','Velocity','Lyric','Articulations','Tuplet'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={15} style={{ ...TD, color: DIM, textAlign: 'center', padding: 24 }}>No events match the filter.</td></tr>}
            {rows.flatMap((r, i) => {
              const ev = r.event
              const bg = rowBg(i)
              const td = { ...TD, background: bg }
              const beat = formatBeat(r.beatPosition, r.timeSig)
              const arts = ev.type === 'note' || ev.type === 'chord' ? ev.articulations : []
              const tuplet = (ev as any).tuplet as { actual: number; normal: number } | undefined

              // Pitch display
              const pitchEditable = ev.type === 'note'
              const noteVal  = ev.type === 'note' ? ev.pitch.noteName : ''
              const octVal   = ev.type === 'note' ? String(ev.pitch.octave) : ''
              const accVal   = ev.type === 'note' ? fmtAcc(ev.pitch.accidental) : ''

              // Duration
              const durVal  = ev.duration
              const dotsVal = String(ev.dots ?? 0)

              // Ties
              const isNote = ev.type === 'note'

              // Chord expand
              const isChord    = ev.type === 'chord'
              const isExpanded = isChord && expandedIds.has(ev.id)

              // Note cell
              let noteCell: React.ReactNode
              if (ev.type === 'rest') {
                noteCell = <span style={{ color: DIM }}>—</span>
              } else if (ev.type === 'chord') {
                const lowest = ev.pitches[0]
                noteCell = (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button onClick={() => toggleExpand(ev.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 10, padding: 0 }}>{isExpanded ? '▼' : '▶'}</button>
                    {lowest?.noteName ?? '—'}{ev.pitches.length > 1 ? ` +${ev.pitches.length - 1}` : ''}
                  </span>
                )
              } else {
                noteCell = isEditing(r.key, 'note')
                  ? <select style={EDIT_SELECT} value={noteVal} autoFocus
                      onChange={e => commitEdit(r, 'note', e.target.value)}
                      onKeyDown={e => e.key === 'Escape' && cancelEdit()}
                      onBlur={cancelEdit}
                    >{NOTE_NAMES.map(n => <option key={n}>{n}</option>)}</select>
                  : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555' }} onClick={() => startEdit(r.key, 'note', noteVal)}>{noteVal}</span>
              }

              const octCell = pitchEditable
                ? isEditing(r.key, 'octave')
                  ? <input style={{ ...EDIT_INPUT, width: 36 }} type="number" min={0} max={9} value={editVal} autoFocus
                      onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commitEdit(r, 'octave', editVal); if (e.key === 'Escape') cancelEdit() }}
                      onBlur={() => commitEdit(r, 'octave', editVal)} />
                  : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555' }} onClick={() => startEdit(r.key, 'octave', octVal)}>{octVal}</span>
                : <span style={{ color: DIM }}>—</span>

              const accCell = pitchEditable
                ? isEditing(r.key, 'acc')
                  ? <select style={EDIT_SELECT} value={accVal} autoFocus
                      onChange={e => commitEdit(r, 'acc', e.target.value)}
                      onKeyDown={e => e.key === 'Escape' && cancelEdit()}
                      onBlur={cancelEdit}
                    >{['—','♯','♭','♮'].map(a => <option key={a}>{a}</option>)}</select>
                  : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555' }} onClick={() => startEdit(r.key, 'acc', accVal)}>{accVal}</span>
                : <span style={{ color: DIM }}>—</span>

              const durCell = isEditing(r.key, 'dur')
                ? <select style={EDIT_SELECT} value={durVal} autoFocus
                    onChange={e => commitEdit(r, 'dur', e.target.value)}
                    onKeyDown={e => e.key === 'Escape' && cancelEdit()}
                    onBlur={cancelEdit}
                  >{DURATIONS.map(d => <option key={d} value={d}>{DURATION_LABELS[d]}</option>)}</select>
                : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555' }} onClick={() => startEdit(r.key, 'dur', durVal)}>{DURATION_LABELS[durVal]}</span>

              const dotsCell = isEditing(r.key, 'dots')
                ? <select style={{ ...EDIT_SELECT, width: 36 }} value={dotsVal} autoFocus
                    onChange={e => commitEdit(r, 'dots', e.target.value)}
                    onKeyDown={e => e.key === 'Escape' && cancelEdit()}
                    onBlur={cancelEdit}
                  >{['0','1','2'].map(d => <option key={d}>{d}</option>)}</select>
                : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555' }} onClick={() => startEdit(r.key, 'dots', dotsVal)}>{dotsVal}</span>

              const dynamic = (ev as any).dynamic as DynamicLevel | undefined
              const dynCell = isEditing(r.key, 'dyn')
                ? <select style={EDIT_SELECT} value={dynamic ?? '—'} autoFocus
                    onChange={e => commitEdit(r, 'dyn', e.target.value)}
                    onKeyDown={e => e.key === 'Escape' && cancelEdit()}
                    onBlur={cancelEdit}
                  >{['—', ...DYNAMICS].map(d => <option key={d}>{d}</option>)}</select>
                : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555' }} onClick={() => startEdit(r.key, 'dyn', dynamic ?? '—')}>
                    {dynamic ? <em>{dynamic}</em> : <span style={{ color: DIM }}>—</span>}
                  </span>

              const velocity = (ev as any).velocity as number | undefined
              const velEditable = ev.type !== 'rest'
              const velCell = velEditable
                ? isEditing(r.key, 'vel')
                  ? <input style={{ ...EDIT_INPUT, width: 42 }} type="number" min={0} max={127} value={editVal} autoFocus
                      onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commitEdit(r, 'vel', editVal); if (e.key === 'Escape') cancelEdit() }}
                      onBlur={() => commitEdit(r, 'vel', editVal)} />
                  : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555' }} onClick={() => startEdit(r.key, 'vel', velocity !== undefined ? String(velocity) : '')}>
                      {velocity !== undefined ? velocity : <span style={{ color: DIM }}>—</span>}
                    </span>
                : <span style={{ color: DIM }}>—</span>

              const lyric = (ev as any).lyric as string | undefined
              const lyricCell = isEditing(r.key, 'lyric')
                ? <input style={{ ...EDIT_INPUT, width: 80 }} value={editVal} autoFocus
                    onChange={e => setEditVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(r, 'lyric', editVal); if (e.key === 'Escape') cancelEdit() }}
                    onBlur={() => commitEdit(r, 'lyric', editVal)} />
                : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555' }} onClick={() => startEdit(r.key, 'lyric', lyric ?? '')}>
                    {lyric ? lyric : <span style={{ color: DIM }}>—</span>}
                  </span>

              // Articulations — always-visible toggle chips
              const artCell = isEditing(r.key, 'articulations')
                ? <span style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    {ALL_ARTS.map(art => {
                      const on = arts.includes(art)
                      return <button key={art} onClick={() => toggleArt(r, art, on)} title={art}
                        style={{ padding: '1px 4px', fontSize: 9, borderRadius: 2, border: '1px solid #555', cursor: 'pointer', background: on ? '#0e639c' : '#2d2d2d', color: on ? '#fff' : '#888' }}>
                        {ART_ABBREV[art]}
                      </button>
                    })}
                    <button onClick={cancelEdit} style={{ ...DEL_BTN, fontSize: 9 }}>done</button>
                  </span>
                : (ev.type === 'note' || ev.type === 'chord')
                  ? <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555' }} onClick={() => startEdit(r.key, 'articulations', '')}>
                      {arts.length ? fmtArts(arts) : <span style={{ color: DIM }}>—</span>}
                    </span>
                  : <span style={{ color: DIM }}>—</span>

              const mainRow = (
                <tr key={r.key} style={{ background: bg }}>
                  <td style={td}>{r.measureNumber}</td>
                  <td style={td}>{beat}</td>
                  <td style={td}>{r.voiceIndex + 1}</td>
                  <td style={td}>{cap(ev.type)}</td>
                  <td style={td}>{noteCell}</td>
                  <td style={td}>{octCell}</td>
                  <td style={td}>{accCell}</td>
                  <td style={td}>{durCell}</td>
                  <td style={td}>{dotsCell}</td>
                  <td style={td}>
                    {isNote
                      ? <input type="checkbox" checked={(ev as any).tieStart ?? false} onChange={() => toggleTie(r, 'tieStart')} style={{ cursor: 'pointer' }} />
                      : <span style={{ color: DIM }}>—</span>}
                  </td>
                  <td style={td}>
                    {isNote
                      ? <input type="checkbox" checked={(ev as any).tieEnd ?? false} onChange={() => toggleTie(r, 'tieEnd')} style={{ cursor: 'pointer' }} />
                      : <span style={{ color: DIM }}>—</span>}
                  </td>
                  <td style={td}>{dynCell}</td>
                  <td style={td}>{velCell}</td>
                  <td style={td}>{lyricCell}</td>
                  <td style={td}>{artCell}</td>
                  <td style={td}>{tuplet ? `${tuplet.actual}:${tuplet.normal}` : <span style={{ color: DIM }}>—</span>}</td>
                </tr>
              )

              const subRows = isExpanded && ev.type === 'chord'
                ? ev.pitches.map((p, pi) => (
                  <tr key={`${r.key}-p${pi}`} style={{ background: '#1a2838' }}>
                    <td style={{ ...TD, color: DIM }} /><td style={{ ...TD, color: DIM }} /><td style={{ ...TD, color: DIM }} />
                    <td style={{ ...TD, color: '#4a9eff', paddingLeft: 24 }}>pitch {pi + 1}</td>
                    <td style={TD}>{p.noteName}</td><td style={TD}>{p.octave}</td><td style={TD}>{fmtAcc(p.accidental)}</td>
                    <td colSpan={9} style={{ ...TD, color: DIM }} />
                  </tr>
                )) : []

              return [mainRow, ...subRows]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Expressions tab ───────────────────────────────────────────────────────────

function ExpressionsTab({ staff, partId, staffId, scoreTs, dispatch, onNavigate }: {
  staff: Staff; partId: string; staffId: string; scoreTs: TimeSignature
  dispatch: (c: Command) => void; onNavigate: (bar: number) => void
}) {
  const hairpins = staff.hairpins ?? []
  const slurs    = staff.slurs    ?? []
  const dynRows  = useMemo(() => buildDynRows(staff, scoreTs), [staff, scoreTs])

  const rHairpins = useMemo(() => hairpins.map(h => ({
    h, from: findNoteInStaff(staff, h.fromNoteId, scoreTs), to: findNoteInStaff(staff, h.toNoteId, scoreTs),
  })), [hairpins, staff, scoreTs])

  const rSlurs = useMemo(() => slurs.map(s => ({
    s, from: findNoteInStaff(staff, s.fromNoteId, scoreTs), to: findNoteInStaff(staff, s.toNoteId, scoreTs),
  })), [slurs, staff, scoreTs])

  const secHead = (title: string, count: number) => (
    <div style={{ padding: '8px 12px', background: '#252526', borderBottom: '1px solid #3e3e3e', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
      {title}<span style={{ background: '#333', borderRadius: 9, padding: '1px 7px', fontSize: 10, color: '#666' }}>{count}</span>
    </div>
  )

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      {secHead('Hairpins', hairpins.length)}
      {hairpins.length === 0
        ? <div style={{ padding: 12, fontSize: 12, color: DIM }}>No hairpins.</div>
        : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Type','From bar','From beat','To bar','To beat',''].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
            <tbody>{rHairpins.map(({ h, from, to }, i) => (
              <tr key={h.id} style={{ background: rowBg(i) }}>
                <td style={TD}>
                  <select style={EDIT_SELECT} value={h.type}
                    onChange={e => { dispatch({ type: 'REMOVE_HAIRPIN', partId, staffId, hairpinId: h.id }); dispatch({ type: 'ADD_HAIRPIN', partId, staffId, hairpin: { ...h, type: e.target.value as any } }) }}>
                    <option value="crescendo">Crescendo</option>
                    <option value="decrescendo">Decrescendo</option>
                  </select>
                </td>
                <td style={TD}>{from?.measureNumber ?? <span style={{ color: DIM }}>?</span>}</td>
                <td style={TD}>{from ? formatBeat(from.beatPosition, from.timeSig) : <span style={{ color: DIM }}>?</span>}</td>
                <td style={TD}>{to?.measureNumber ?? <span style={{ color: DIM }}>?</span>}</td>
                <td style={TD}>{to ? formatBeat(to.beatPosition, to.timeSig) : <span style={{ color: DIM }}>?</span>}</td>
                <td style={TD}><button style={DEL_BTN} onClick={() => dispatch({ type: 'REMOVE_HAIRPIN', partId, staffId, hairpinId: h.id })}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
      }

      {secHead('Slurs', slurs.length)}
      {slurs.length === 0
        ? <div style={{ padding: 12, fontSize: 12, color: DIM }}>No slurs.</div>
        : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['From bar','From beat','To bar','To beat','Placement',''].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
            <tbody>{rSlurs.map(({ s, from, to }, i) => (
              <tr key={s.id} style={{ background: rowBg(i) }}>
                <td style={TD}>{from?.measureNumber ?? <span style={{ color: DIM }}>?</span>}</td>
                <td style={TD}>{from ? formatBeat(from.beatPosition, from.timeSig) : <span style={{ color: DIM }}>?</span>}</td>
                <td style={TD}>{to?.measureNumber ?? <span style={{ color: DIM }}>?</span>}</td>
                <td style={TD}>{to ? formatBeat(to.beatPosition, to.timeSig) : <span style={{ color: DIM }}>?</span>}</td>
                <td style={TD}>
                  <select style={EDIT_SELECT} value={s.placement ?? 'auto'}
                    onChange={e => { dispatch({ type: 'REMOVE_SLUR', partId, staffId, slurId: s.id }); dispatch({ type: 'ADD_SLUR', partId, staffId, slur: { ...s, placement: e.target.value === 'auto' ? undefined : e.target.value as any } }) }}>
                    <option value="auto">Auto</option><option value="above">Above</option><option value="below">Below</option>
                  </select>
                </td>
                <td style={TD}><button style={DEL_BTN} onClick={() => dispatch({ type: 'REMOVE_SLUR', partId, staffId, slurId: s.id })}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
      }

      {secHead('Note dynamics', dynRows.length)}
      {dynRows.length === 0
        ? <div style={{ padding: 12, fontSize: 12, color: DIM }}>No note-attached dynamics.</div>
        : dynRows.map((r, i) => (
          <button key={r.key} onClick={() => onNavigate(r.measureNumber)}
            style={{ background: rowBg(i), border: 'none', borderBottom: '1px solid #2a2a2a', color: '#d4d4d4', fontSize: 12, padding: '6px 12px', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 12, width: '100%' }}>
            <span style={{ color: '#888' }}>Bar {r.measureNumber}, Beat {formatBeat(r.beatPosition, r.timeSig)}, Voice {r.voiceIndex + 1}</span>
            <em style={{ fontWeight: 600 }}>{r.dynamic}</em>
            <span style={{ color: '#555', fontSize: 11 }}>→ Notes</span>
          </button>
        ))
      }
    </div>
  )
}

// ── Directives tab ────────────────────────────────────────────────────────────

function DirectivesTab({ staff, partId, staffId, dispatch }: { staff: Staff; partId: string; staffId: string; dispatch: (c: Command) => void }) {
  const [adding, setAdding] = useState(false)
  const [addMeasureId, setAddMeasureId] = useState(staff.measures[0]?.id ?? '')
  const [addCat, setAddCat] = useState<'tempo' | 'dynamic' | 'expression'>('tempo')
  const [addText, setAddText] = useState('')
  const [addBpm, setAddBpm] = useState('')
  const [addProg, setAddProg] = useState('')

  const rows = useMemo(() => {
    const out: { key: string; measureNumber: number; measureId: string; category: string; text: string; bpm: number | undefined; midiProgram: number | undefined }[] = []
    for (const m of staff.measures)
      for (const d of m.directives ?? [])
        out.push({ key: d.id, measureNumber: m.number, measureId: m.id, category: d.category, text: d.text, bpm: d.bpm, midiProgram: d.midiProgram })
    return out
  }, [staff])

  function addDirective() {
    const bpm  = addBpm.trim()  ? parseInt(addBpm)  : undefined
    const prog = addProg.trim() ? parseInt(addProg) : undefined
    dispatch({ type: 'ADD_DIRECTIVE', partId, staffId, measureId: addMeasureId, directive: { id: uuid(), category: addCat, text: addText.trim(), ...(bpm ? { bpm } : {}), ...(prog != null ? { midiProgram: prog } : {}) } })
    setAdding(false); setAddText(''); setAddBpm(''); setAddProg('')
  }

  const ss: React.CSSProperties = { ...EDIT_SELECT, fontSize: 12 }
  const si: React.CSSProperties = { ...EDIT_INPUT,  fontSize: 12, width: 80 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ overflow: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Bar','Category','Text','BPM','MIDI program',''].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} style={{ ...TD, color: DIM, textAlign: 'center', padding: 24 }}>No directives.</td></tr>}
            {rows.map((r, i) => (
              <tr key={r.key} style={{ background: rowBg(i) }}>
                <td style={TD}>{r.measureNumber}</td>
                <td style={TD}>{cap(r.category)}</td>
                <td style={TD}>{r.text || <span style={{ color: DIM }}>—</span>}</td>
                <td style={TD}>{nil(r.bpm)}</td>
                <td style={TD}>{r.midiProgram != null ? r.midiProgram : <span style={{ color: DIM }}>—</span>}</td>
                <td style={TD}><button style={DEL_BTN} onClick={() => dispatch({ type: 'REMOVE_DIRECTIVE', partId, staffId, measureId: r.measureId, directiveId: r.key })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ flexShrink: 0, borderTop: '1px solid #3e3e3e', padding: 10, background: '#252526' }}>
        {!adding
          ? <button onClick={() => setAdding(true)} style={{ padding: '4px 12px', background: 'none', border: '1px solid #555', color: '#888', fontSize: 12, borderRadius: 3, cursor: 'pointer' }}>+ Add directive</button>
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <select value={addMeasureId} onChange={e => setAddMeasureId(e.target.value)} style={ss}>
                {staff.measures.map(m => <option key={m.id} value={m.id}>Bar {m.number}</option>)}
              </select>
              <select value={addCat} onChange={e => setAddCat(e.target.value as any)} style={ss}>
                <option value="tempo">Tempo</option><option value="dynamic">Dynamic</option><option value="expression">Expression</option>
              </select>
              <input placeholder="Text" value={addText} onChange={e => setAddText(e.target.value)} style={si} />
              {addCat === 'tempo' && <input placeholder="BPM" value={addBpm} onChange={e => setAddBpm(e.target.value)} style={{ ...si, width: 50 }} />}
              {addCat === 'expression' && <input placeholder="Program 0–127" value={addProg} onChange={e => setAddProg(e.target.value)} style={{ ...si, width: 90 }} />}
              <button onClick={addDirective} style={{ padding: '4px 10px', background: '#0e639c', border: '1px solid #0e639c', color: '#fff', fontSize: 12, borderRadius: 3, cursor: 'pointer' }}>Add</button>
              <button onClick={() => setAdding(false)} style={{ padding: '4px 10px', background: 'none', border: '1px solid #555', color: '#888', fontSize: 12, borderRadius: 3, cursor: 'pointer' }}>Cancel</button>
            </div>
        }
      </div>
    </div>
  )
}

// ── MIDI tab ──────────────────────────────────────────────────────────────────

function MidiTab({ staff, partId, staffId, scoreTs, dispatch }: { staff: Staff; partId: string; staffId: string; scoreTs: TimeSignature; dispatch: (c: Command) => void }) {
  const [addingMidi, setAddingMidi] = useState(false)
  const [addMeasureId, setAddMeasureId] = useState(staff.measures[0]?.id ?? '')
  const [addType, setAddType] = useState<'cc' | 'pc' | 'pb' | 'sysex'>('cc')
  const [addBeat, setAddBeat] = useState('1')
  const [addCcNum, setAddCcNum] = useState('7'); const [addCcVal, setAddCcVal] = useState('100')
  const [addProg, setAddProg] = useState('0'); const [addPb, setAddPb] = useState('0'); const [addSysex, setAddSysex] = useState('')

  const midiRows = useMemo(() => {
    const out: { key: string; measureNumber: number; measureId: string; beatPosition: number; timeSig: TimeSignature; event: NonNullable<typeof staff.measures[0]['midiEvents']>[0] }[] = []
    for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
      const m = staff.measures[mIdx]
      const ts = resolveTimeSig(staff.measures, mIdx, scoreTs)
      for (const ev of m.midiEvents ?? []) out.push({ key: ev.id, measureNumber: m.number, measureId: m.id, beatPosition: ev.beatPosition, timeSig: ts, event: ev })
    }
    return out
  }, [staff, scoreTs])

  const pedalRows = useMemo(() => {
    const out: { key: string; measureNumber: number; measureId: string; beatPosition: number; timeSig: TimeSignature; mark: NonNullable<typeof staff.measures[0]['pedalMarks']>[0] }[] = []
    for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
      const m = staff.measures[mIdx]
      const ts = resolveTimeSig(staff.measures, mIdx, scoreTs)
      for (const mark of m.pedalMarks ?? []) out.push({ key: mark.id, measureNumber: m.number, measureId: m.id, beatPosition: mark.beatPosition, timeSig: ts, mark })
    }
    return out
  }, [staff, scoreTs])

  function beatToUnits(beatStr: string, ts: TimeSignature): number {
    const b = parseFloat(beatStr)
    if (isNaN(b) || b < 1) return 0
    return Math.round((b - 1) * (64 / ts.denominator))
  }

  function addMidiEvent() {
    const mIdx = staff.measures.findIndex(m => m.id === addMeasureId)
    const ts = resolveTimeSig(staff.measures, mIdx, scoreTs)
    const beatPos = beatToUnits(addBeat, ts)
    const ev: any = { id: uuid(), type: addType, beatPosition: beatPos }
    if (addType === 'cc')    ev.cc    = { controller: parseInt(addCcNum), value: parseInt(addCcVal) }
    if (addType === 'pc')    ev.pc    = { program: parseInt(addProg) }
    if (addType === 'pb')    ev.pb    = { value: parseInt(addPb) }
    if (addType === 'sysex') ev.sysex = { hex: addSysex.trim() }
    dispatch({ type: 'ADD_MIDI_EVENT', partId, staffId, measureId: addMeasureId, event: ev })
    setAddingMidi(false)
  }

  const secHead = (title: string, count: number) => (
    <div style={{ padding: '8px 12px', background: '#252526', borderBottom: '1px solid #3e3e3e', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
      {title}<span style={{ background: '#333', borderRadius: 9, padding: '1px 7px', fontSize: 10, color: '#666' }}>{count}</span>
    </div>
  )
  const ss: React.CSSProperties = { ...EDIT_SELECT, fontSize: 12 }
  const si: React.CSSProperties = { ...EDIT_INPUT,  fontSize: 12, width: 60 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ overflow: 'auto', flex: 1 }}>
        {secHead('MIDI events', midiRows.length)}
        {midiRows.length === 0
          ? <div style={{ padding: 12, fontSize: 12, color: DIM }}>No MIDI events.</div>
          : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Bar','Beat','Type','CC#','CC value','Program','PB value','SysEx',''].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
              <tbody>{midiRows.map(({ key, measureNumber, measureId, beatPosition, timeSig, event: ev }, i) => (
                <tr key={key} style={{ background: rowBg(i) }}>
                  <td style={TD}>{measureNumber}</td>
                  <td style={TD}>{formatBeat(beatPosition, timeSig)}</td>
                  <td style={TD}>{ev.type.toUpperCase()}</td>
                  <td style={{ ...TD, color: ev.cc ? '#d4d4d4' : DIM }}>{ev.cc ? ev.cc.controller : '—'}</td>
                  <td style={{ ...TD, color: ev.cc ? '#d4d4d4' : DIM }}>{ev.cc ? ev.cc.value      : '—'}</td>
                  <td style={{ ...TD, color: ev.pc ? '#d4d4d4' : DIM }}>{ev.pc ? ev.pc.program    : '—'}</td>
                  <td style={{ ...TD, color: ev.pb ? '#d4d4d4' : DIM }}>{ev.pb ? ev.pb.value      : '—'}</td>
                  <td style={{ ...TD, color: ev.sysex ? '#d4d4d4' : DIM, fontFamily: 'monospace', fontSize: 11 }}>{ev.sysex ? ev.sysex.hex : '—'}</td>
                  <td style={TD}><button style={DEL_BTN} onClick={() => dispatch({ type: 'REMOVE_MIDI_EVENT', partId, staffId, measureId, eventId: key })}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
        }

        {secHead('Pedal marks', pedalRows.length)}
        {pedalRows.length === 0
          ? <div style={{ padding: 12, fontSize: 12, color: DIM }}>No pedal marks.</div>
          : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Bar','Beat','Type'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
              <tbody>{pedalRows.map(({ key, measureNumber, beatPosition, timeSig, mark }, i) => (
                <tr key={key} style={{ background: rowBg(i) }}>
                  <td style={TD}>{measureNumber}</td>
                  <td style={TD}>{formatBeat(beatPosition, timeSig)}</td>
                  <td style={TD}>{cap(mark.type)}</td>
                </tr>
              ))}</tbody>
            </table>
        }
      </div>

      <div style={{ flexShrink: 0, borderTop: '1px solid #3e3e3e', padding: 10, background: '#252526' }}>
        {!addingMidi
          ? <button onClick={() => setAddingMidi(true)} style={{ padding: '4px 12px', background: 'none', border: '1px solid #555', color: '#888', fontSize: 12, borderRadius: 3, cursor: 'pointer' }}>+ Add MIDI event</button>
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <select value={addMeasureId} onChange={e => setAddMeasureId(e.target.value)} style={ss}>{staff.measures.map(m => <option key={m.id} value={m.id}>Bar {m.number}</option>)}</select>
              <input placeholder="Beat" value={addBeat} onChange={e => setAddBeat(e.target.value)} style={{ ...si, width: 44 }} />
              <select value={addType} onChange={e => setAddType(e.target.value as any)} style={ss}><option value="cc">CC</option><option value="pc">PC</option><option value="pb">PB</option><option value="sysex">SysEx</option></select>
              {addType === 'cc'    && <><input placeholder="CC#" value={addCcNum} onChange={e => setAddCcNum(e.target.value)} style={{ ...si, width: 40 }} /><input placeholder="Value" value={addCcVal} onChange={e => setAddCcVal(e.target.value)} style={{ ...si, width: 50 }} /></>}
              {addType === 'pc'    && <input placeholder="Program" value={addProg} onChange={e => setAddProg(e.target.value)} style={si} />}
              {addType === 'pb'    && <input placeholder="Value" value={addPb} onChange={e => setAddPb(e.target.value)} style={si} />}
              {addType === 'sysex' && <input placeholder="Hex bytes" value={addSysex} onChange={e => setAddSysex(e.target.value)} style={{ ...si, width: 120 }} />}
              <button onClick={addMidiEvent} style={{ padding: '4px 10px', background: '#0e639c', border: '1px solid #0e639c', color: '#fff', fontSize: 12, borderRadius: 3, cursor: 'pointer' }}>Add</button>
              <button onClick={() => setAddingMidi(false)} style={{ padding: '4px 10px', background: 'none', border: '1px solid #555', color: '#888', fontSize: 12, borderRadius: 3, cursor: 'pointer' }}>Cancel</button>
            </div>
        }
      </div>
    </div>
  )
}

// ── Structure tab ─────────────────────────────────────────────────────────────

function StructureTab({ staff, partId, staffId, score, dispatch }: {
  staff: Staff; partId: string; staffId: string
  score: import('@shared/score').Score; dispatch: (c: Command) => void
}) {
  const [editCell, setEditCell] = useState<{ measureId: string; col: string } | null>(null)
  const [editVal,  setEditVal]  = useState('')
  const [editErr,  setEditErr]  = useState<string | null>(null)

  const rows = useMemo(() => staff.measures.map((m, mIdx) => ({
    key: m.id, number: m.number, measureId: m.id,
    barline:    m.barline ?? 'single',
    timeSig:    resolveTimeSig(staff.measures, mIdx, score.timeSignature), ownTs: m.timeSignature,
    keySig:     resolveKeySig(staff.measures, mIdx, score.keySignature),   ownKs: m.keySignature,
    clef:       resolveClef(staff.measures, mIdx, staff.clef),             ownClef: m.clef?.type,
    tempo:      resolveDirectiveTempo(staff.measures, mIdx, score.tempo),  ownTempo: m.tempo,
  })), [staff, score])

  const isEditing = (measureId: string, col: string) => editCell?.measureId === measureId && editCell?.col === col

  function startEdit(measureId: string, col: string, val: string) {
    setEditCell({ measureId, col }); setEditVal(val); setEditErr(null)
  }
  function cancelEdit() { setEditCell(null); setEditErr(null) }

  function commitStructEdit(measureId: string, col: string, val: string) {
    const loc = { partId, staffId, measureId }
    if (col === 'barline') {
      dispatch({ type: 'SET_BARLINE', ...loc, barline: val as BarlineType })
    } else if (col === 'clef') {
      if (val === '—') dispatch({ type: 'CLEAR_CLEF', ...loc })
      else             dispatch({ type: 'SET_CLEF',   ...loc, clef: val as ClefType })
    } else if (col === 'timesig') {
      if (val === '—') { dispatch({ type: 'CLEAR_TIME', ...loc }); cancelEdit(); return }
      const parts = val.split('/')
      const num = parseInt(parts[0]); const den = parseInt(parts[1])
      if (!num || !den || den < 1) { setEditErr('Format: numerator/denominator e.g. 3/4'); return }
      dispatch({ type: 'SET_TIME', ...loc, time: { numerator: num, denominator: den } })
    } else if (col === 'keysig') {
      if (val === '—') { dispatch({ type: 'CLEAR_KEY', ...loc }); cancelEdit(); return }
      const opt = KEY_OPTIONS.find(k => keyLabel(k) === val)
      if (!opt) { setEditErr('Unknown key signature'); return }
      dispatch({ type: 'SET_KEY', ...loc, key: opt })
    } else if (col === 'tempo') {
      if (val === '' || val === '—') { dispatch({ type: 'CLEAR_MEASURE_TEMPO', measureId }); cancelEdit(); return }
      const bpm = parseInt(val)
      if (isNaN(bpm) || bpm < 1) { setEditErr('Enter a positive BPM value'); return }
      dispatch({ type: 'SET_MEASURE_TEMPO', measureId, bpm })
    }
    cancelEdit()
  }

  const inh = (own: unknown) => !own

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {editErr && <div style={{ padding: '4px 12px', background: '#3a1a1a', color: '#ff9090', fontSize: 11, flexShrink: 0 }}>{editErr}</div>}
      <div style={{ overflow: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Bar','Barline','Time sig','Key sig','Clef','Tempo (♩=)'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => {
            const bg = rowBg(i)
            const td = { ...TD, background: bg }

            const barlineCell = isEditing(r.measureId, 'barline')
              ? <select style={EDIT_SELECT} value={r.barline} autoFocus
                  onChange={e => commitStructEdit(r.measureId, 'barline', e.target.value)}
                  onKeyDown={e => e.key === 'Escape' && cancelEdit()} onBlur={cancelEdit}>
                  {BARLINES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555' }} onClick={() => startEdit(r.measureId, 'barline', r.barline)}>{r.barline}</span>

            const tsCell = isEditing(r.measureId, 'timesig')
              ? <input style={{ ...EDIT_INPUT, width: 60 }} value={editVal} autoFocus placeholder="e.g. 3/4 or —"
                  onChange={e => setEditVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitStructEdit(r.measureId, 'timesig', editVal); if (e.key === 'Escape') cancelEdit() }}
                  onBlur={() => commitStructEdit(r.measureId, 'timesig', editVal)} />
              : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555', color: inh(r.ownTs) ? DIM : '#d4d4d4' }} onClick={() => startEdit(r.measureId, 'timesig', fmtTs(r.ownTs))}>
                  {fmtTs(r.timeSig)}{inh(r.ownTs) && <span style={{ fontSize: 10, marginLeft: 4 }}>(inh.)</span>}
                </span>

            const ksCell = isEditing(r.measureId, 'keysig')
              ? <select style={EDIT_SELECT} value={r.ownKs ? keyLabel(r.ownKs) : '—'} autoFocus
                  onChange={e => { commitStructEdit(r.measureId, 'keysig', e.target.value) }}
                  onKeyDown={e => e.key === 'Escape' && cancelEdit()} onBlur={cancelEdit}>
                  <option value="—">— (inherited)</option>
                  {KEY_OPTIONS.map(k => { const lbl = keyLabel(k); return <option key={`${k.fifths}-${k.mode}`} value={lbl}>{lbl}</option> })}
                </select>
              : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555', color: inh(r.ownKs) ? DIM : '#d4d4d4' }} onClick={() => startEdit(r.measureId, 'keysig', r.ownKs ? keyLabel(r.ownKs) : '—')}>
                  {keyLabel(r.keySig)}{inh(r.ownKs) && <span style={{ fontSize: 10, marginLeft: 4 }}>(inh.)</span>}
                </span>

            const clefCell = isEditing(r.measureId, 'clef')
              ? <select style={EDIT_SELECT} value={r.ownClef ?? '—'} autoFocus
                  onChange={e => { commitStructEdit(r.measureId, 'clef', e.target.value) }}
                  onKeyDown={e => e.key === 'Escape' && cancelEdit()} onBlur={cancelEdit}>
                  <option value="—">— (inherited)</option>
                  {CLEFS.map(c => <option key={c} value={c}>{cap(c)}</option>)}
                </select>
              : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555', color: inh(r.ownClef) ? DIM : '#d4d4d4' }} onClick={() => startEdit(r.measureId, 'clef', r.ownClef ?? '—')}>
                  {cap(r.clef)}{inh(r.ownClef) && <span style={{ fontSize: 10, marginLeft: 4 }}>(inh.)</span>}
                </span>

            const tempoCell = isEditing(r.measureId, 'tempo')
              ? <input style={{ ...EDIT_INPUT, width: 56 }} value={editVal} autoFocus placeholder="BPM or —"
                  onChange={e => setEditVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitStructEdit(r.measureId, 'tempo', editVal); if (e.key === 'Escape') cancelEdit() }}
                  onBlur={() => commitStructEdit(r.measureId, 'tempo', editVal)} />
              : <span style={{ cursor: 'pointer', textDecoration: 'underline dotted #555', color: inh(r.ownTempo) ? DIM : '#d4d4d4' }} onClick={() => startEdit(r.measureId, 'tempo', r.ownTempo ? String(r.ownTempo) : '')}>
                  {r.tempo}{inh(r.ownTempo) && <span style={{ fontSize: 10, marginLeft: 4 }}>(inh.)</span>}
                </span>

            return (
              <tr key={r.key} style={{ background: bg }}>
                <td style={td}>{r.number}</td>
                <td style={td}>{barlineCell}</td>
                <td style={td}>{tsCell}</td>
                <td style={td}>{ksCell}</td>
                <td style={td}>{clefCell}</td>
                <td style={td}>{tempoCell}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const TABS: { id: EditorTab; label: string }[] = [
  { id: 'notes', label: 'Notes' }, { id: 'expressions', label: 'Expressions' },
  { id: 'directives', label: 'Directives' }, { id: 'midi', label: 'MIDI' }, { id: 'structure', label: 'Structure' },
]

export function EventEditorView(): JSX.Element {
  const { score, dispatch, dispatchBatch } = useAppStore()

  const [selectedPartId,   setSelectedPartId]   = useState(score.parts[0]?.id ?? '')
  const [selectedStaveIdx, setSelectedStaveIdx] = useState(0)
  const [activeTab,        setActiveTab]        = useState<EditorTab>('notes')
  const [filterBarFrom, setFilterBarFrom] = useState('')
  const [filterBarTo,   setFilterBarTo]   = useState('')
  const [filterVoice,   setFilterVoice]   = useState('all')
  const [filterType,    setFilterType]    = useState('all')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpand = (id: string) => setExpandedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  const part  = score.parts.find(p => p.id === selectedPartId) ?? score.parts[0]
  const staff = part?.staves[selectedStaveIdx] ?? part?.staves[0]

  const handlePartChange = (partId: string) => {
    setSelectedPartId(partId); setSelectedStaveIdx(0)
    setFilterBarFrom(''); setFilterBarTo(''); setFilterVoice('all'); setFilterType('all')
    setExpandedIds(new Set())
  }

  const navigateToDynamic = (bar: number) => {
    setActiveTab('notes'); setFilterBarFrom(String(bar)); setFilterBarTo(String(bar))
  }

  if (!part || !staff) return <div style={{ padding: 24, color: DIM, fontSize: 13 }}>No score loaded.</div>

  const selStyle: React.CSSProperties = { padding: '4px 8px', background: '#2d2d2d', border: '1px solid #555', color: '#ccc', fontSize: 12, borderRadius: 3, cursor: 'pointer' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e', color: '#d4d4d4' }}>
      {/* Selectors */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: '#252526', borderBottom: '1px solid #3e3e3e', flexShrink: 0 }}>
        <label style={{ fontSize: 11, color: '#888' }}>Part</label>
        <select value={selectedPartId} onChange={e => handlePartChange(e.target.value)} style={selStyle}>
          {score.parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {part.staves.length > 1 && <>
          <label style={{ fontSize: 11, color: '#888' }}>Stave</label>
          <select value={selectedStaveIdx} onChange={e => setSelectedStaveIdx(Number(e.target.value))} style={selStyle}>
            {part.staves.map((s, i) => <option key={s.id} value={i}>{cap(s.clef)}</option>)}
          </select>
        </>}
      </div>

      {/* Category tabs */}
      <div style={{ display: 'flex', background: '#252526', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ padding: '6px 16px', background: 'none', border: 'none', borderBottom: activeTab === t.id ? '2px solid #0e639c' : '2px solid transparent', color: activeTab === t.id ? '#d4d4d4' : '#666', fontSize: 12, cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'notes' && <NotesTab staff={staff} partId={part.id} staffId={staff.id} scoreTs={score.timeSignature} dispatch={dispatch} dispatchBatch={dispatchBatch} filterBarFrom={filterBarFrom} filterBarTo={filterBarTo} filterVoice={filterVoice} filterType={filterType} setFilterBarFrom={setFilterBarFrom} setFilterBarTo={setFilterBarTo} setFilterVoice={setFilterVoice} setFilterType={setFilterType} expandedIds={expandedIds} toggleExpand={toggleExpand} />}
        {activeTab === 'expressions' && <ExpressionsTab staff={staff} partId={part.id} staffId={staff.id} scoreTs={score.timeSignature} dispatch={dispatch} onNavigate={navigateToDynamic} />}
        {activeTab === 'directives'  && <DirectivesTab staff={staff} partId={part.id} staffId={staff.id} dispatch={dispatch} />}
        {activeTab === 'midi'        && <MidiTab staff={staff} partId={part.id} staffId={staff.id} scoreTs={score.timeSignature} dispatch={dispatch} />}
        {activeTab === 'structure'   && <StructureTab staff={staff} partId={part.id} staffId={staff.id} score={score} dispatch={dispatch} />}
      </div>
    </div>
  )
}
