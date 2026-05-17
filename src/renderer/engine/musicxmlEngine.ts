// ─────────────────────────────────────────────────────────────────────────────
// MusicXML export — MusicXML 3.1 partwise
//
// scoreToMusicXml(score) → UTF-8 XML string
//
// Notes are stored at written pitch in the model (pitchToHz subtracts
// transposeSemitones to get sounding pitch), so notes are output as-is
// and a <transpose> element carries the sounding-pitch offset for importing apps.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Score, Measure, Note, Rest, Chord, NoteEvent,
  Directive, Duration, Accidental, ClefType, TimeSignature,
} from '@shared/score'

// ── Constants ─────────────────────────────────────────────────────────────────

const DIVISIONS = 16   // per quarter note — matches DURATION_UNITS × (16/64)

const DURATION_TYPE: Record<Duration, string> = {
  '64th': '64th', '32nd': '32nd', '16th': '16th',
  'eighth': 'eighth', 'quarter': 'quarter', 'half': 'half', 'whole': 'whole',
}

const DURATION_DIVS: Record<Duration, number> = {
  '64th': 1, '32nd': 2, '16th': 4, 'eighth': 8,
  'quarter': 16, 'half': 32, 'whole': 64,
}

const DYNAMIC_SOUND: Record<string, number> = {
  ppp: 19, pp: 32, p: 51, mp: 70, mf: 83, f: 102, ff: 115, fff: 127,
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function tag(name: string, content: string, attrs: Record<string, string | number> = {}): string {
  const attrStr = Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('')
  return content === '' ? `<${name}${attrStr}/>` : `<${name}${attrStr}>${content}</${name}>`
}

function indent(level: number): string {
  return '  '.repeat(level)
}

// ── Pitch helpers ─────────────────────────────────────────────────────────────

function accidentalAlter(acc: Accidental): number | null {
  switch (acc) {
    case 'sharp':       return 1
    case 'flat':        return -1
    case 'doubleSharp': return 2
    case 'doubleFlat':  return -2
    case 'natural':     return 0
    default:            return null
  }
}

function accidentalName(acc: Accidental): string | null {
  switch (acc) {
    case 'sharp':       return 'sharp'
    case 'flat':        return 'flat'
    case 'doubleSharp': return 'double-sharp'
    case 'doubleFlat':  return 'double-flat'
    case 'natural':     return 'natural'
    default:            return null
  }
}

function dottedDivs(duration: Duration, dots: 0 | 1 | 2): number {
  const base = DURATION_DIVS[duration]
  if (dots === 1) return base + base / 2
  if (dots === 2) return base + base / 2 + base / 4
  return base
}

// ── Structural elements ───────────────────────────────────────────────────────

function clefElement(clef: ClefType): string {
  const inner: Record<ClefType, string> = {
    treble:     '<sign>G</sign><line>2</line>',
    bass:       '<sign>F</sign><line>4</line>',
    alto:       '<sign>C</sign><line>3</line>',
    tenor:      '<sign>C</sign><line>4</line>',
    percussion: '<sign>percussion</sign>',
  }
  return tag('clef', inner[clef] ?? inner.treble)
}

function transposeElement(transposeSemitones: number): string {
  if (transposeSemitones === 0) return ''
  const chromatic = -transposeSemitones
  const diatonic  = Math.round(chromatic * 7 / 12)
  return tag('transpose', `<diatonic>${diatonic}</diatonic><chromatic>${chromatic}</chromatic>`)
}

// ── Attributes block ──────────────────────────────────────────────────────────

function attributesBlock(
  measure:     Measure,
  prevMeasure: Measure | undefined,
  isFirst:     boolean,
  staffClef:   ClefType,
  scoreFifths: number,
  scoreMode:   string,
  scoreTime:   TimeSignature,
  transposeSemitones: number,
  lvl:         number,
): string[] {
  const parts: string[] = []

  if (isFirst) parts.push(`${indent(lvl + 1)}<divisions>${DIVISIONS}</divisions>`)

  // Key signature
  const keyFifths = measure.keySignature?.fifths ?? scoreFifths
  const keyMode   = measure.keySignature?.mode   ?? scoreMode
  const prevFifths = prevMeasure?.keySignature?.fifths ?? (isFirst ? null : scoreFifths)
  const prevMode   = prevMeasure?.keySignature?.mode   ?? (isFirst ? null : scoreMode)
  if (isFirst || keyFifths !== prevFifths || keyMode !== prevMode) {
    parts.push(`${indent(lvl + 1)}<key><fifths>${keyFifths}</fifths><mode>${keyMode}</mode></key>`)
  }

  // Time signature
  const tsNum = measure.timeSignature?.numerator   ?? scoreTime.numerator
  const tsDen = measure.timeSignature?.denominator ?? scoreTime.denominator
  const prevNum = prevMeasure?.timeSignature?.numerator   ?? (isFirst ? null : scoreTime.numerator)
  const prevDen = prevMeasure?.timeSignature?.denominator ?? (isFirst ? null : scoreTime.denominator)
  if (isFirst || tsNum !== prevNum || tsDen !== prevDen) {
    parts.push(`${indent(lvl + 1)}<time><beats>${tsNum}</beats><beat-type>${tsDen}</beat-type></time>`)
  }

  // Clef
  const clef     = measure.clef?.type ?? staffClef
  const prevClef = prevMeasure?.clef?.type ?? (isFirst ? null : staffClef)
  if (isFirst || clef !== prevClef) {
    parts.push(`${indent(lvl + 1)}${clefElement(clef)}`)
  }

  // Transpose (first measure of part only)
  if (isFirst && transposeSemitones !== 0) {
    parts.push(`${indent(lvl + 1)}${transposeElement(transposeSemitones)}`)
  }

  if (parts.length === 0) return []
  return [`${indent(lvl)}<attributes>`, ...parts, `${indent(lvl)}</attributes>`]
}

// ── Directions ────────────────────────────────────────────────────────────────

function tempoDirection(bpm: number, text: string | undefined, lvl: number): string[] {
  const wordsEl = text && text.trim() && !/^\d+$/.test(text.trim())
    ? [`${indent(lvl + 1)}<direction-type><words font-weight="bold" font-style="italic">${esc(text)}</words></direction-type>`]
    : []
  return [
    `${indent(lvl)}<direction placement="above">`,
    ...wordsEl,
    `${indent(lvl + 1)}<direction-type>`,
    `${indent(lvl + 2)}<metronome parentheses="no">`,
    `${indent(lvl + 3)}<beat-unit>quarter</beat-unit>`,
    `${indent(lvl + 3)}<per-minute>${bpm}</per-minute>`,
    `${indent(lvl + 2)}</metronome>`,
    `${indent(lvl + 1)}</direction-type>`,
    `${indent(lvl + 1)}<sound tempo="${bpm}"/>`,
    `${indent(lvl)}</direction>`,
  ]
}

function directiveLines(directives: readonly Directive[], scoreTempo: number, isFirstMeasureOfFirstPart: boolean, lvl: number): string[] {
  const lines: string[] = []

  if (isFirstMeasureOfFirstPart) {
    const hasTempoDirective = directives.some(d => d.category === 'tempo' && d.bpm != null)
    if (!hasTempoDirective) {
      lines.push(...tempoDirection(scoreTempo, undefined, lvl))
    }
  }

  for (const d of directives) {
    if (d.category === 'tempo' && d.bpm != null) {
      lines.push(...tempoDirection(d.bpm, d.text, lvl))
    } else if (d.category === 'dynamic') {
      const soundVal = DYNAMIC_SOUND[d.text] ?? 64
      lines.push(
        `${indent(lvl)}<direction placement="below">`,
        `${indent(lvl + 1)}<direction-type><dynamics><${esc(d.text)}/></dynamics></direction-type>`,
        `${indent(lvl + 1)}<sound dynamics="${soundVal}"/>`,
        `${indent(lvl)}</direction>`,
      )
    } else if (d.category === 'expression') {
      lines.push(
        `${indent(lvl)}<direction placement="above">`,
        `${indent(lvl + 1)}<direction-type><words font-style="italic">${esc(d.text)}</words></direction-type>`,
        `${indent(lvl)}</direction>`,
      )
    }
  }

  return lines
}

// ── Notes ─────────────────────────────────────────────────────────────────────

type BeamState = { active: boolean }

function notationsElement(tieTypes: string[], articulations: readonly string[]): string {
  const parts: string[] = []

  for (const t of tieTypes) parts.push(`<tied type="${t}"/>`)

  const artEls: string[] = []
  const ornEls: string[] = []
  let fermata = false

  for (const art of articulations) {
    if      (art === 'staccato') artEls.push('<staccato/>')
    else if (art === 'accent')   artEls.push('<accent/>')
    else if (art === 'tenuto')   artEls.push('<tenuto/>')
    else if (art === 'marcato')  artEls.push('<strong-accent/>')
    else if (art === 'fermata')  fermata = true
    else if (art === 'trill')    ornEls.push('<trill-mark/>')
    else if (art === 'mordent')  ornEls.push('<mordent/>')
    else if (art === 'turn')     ornEls.push('<turn/>')
  }

  if (artEls.length) parts.push(`<articulations>${artEls.join('')}</articulations>`)
  if (ornEls.length) parts.push(`<ornaments>${ornEls.join('')}</ornaments>`)
  if (fermata)       parts.push('<fermata/>')

  return parts.length ? `<notations>${parts.join('')}</notations>` : ''
}

function isSubQuarter(duration: Duration): boolean {
  return DURATION_DIVS[duration] < DURATION_DIVS['quarter']
}

function noteLines(event: NoteEvent, beamState: BeamState, lvl: number): string[] {
  const lines: string[] = []

  if (event.type === 'note') {
    const n = event as Note
    const divs   = dottedDivs(n.duration, n.dots)
    const alter  = accidentalAlter(n.pitch.accidental)
    const accName = accidentalName(n.pitch.accidental)

    const tieEls  = [n.tieEnd ? '<tie type="stop"/>' : '', n.tieStart ? '<tie type="start"/>' : ''].filter(Boolean)
    const tieTypes = [...(n.tieEnd ? ['stop'] : []), ...(n.tieStart ? ['start'] : [])]
    const dotEls  = '<dot/>'.repeat(n.dots)

    // Beam
    let beamEl = ''
    if (isSubQuarter(n.duration)) {
      if      (n.beamStart)       { beamEl = '<beam number="1">begin</beam>';    beamState.active = true }
      else if (n.beamEnd)         { beamEl = '<beam number="1">end</beam>';      beamState.active = false }
      else if (beamState.active)    beamEl = '<beam number="1">continue</beam>'
    } else {
      beamState.active = false
    }

    const notEl = notationsElement(tieTypes, n.articulations)
    const alterEl  = alter !== null ? `<alter>${alter}</alter>` : ''
    const accEl    = accName ? `<accidental>${accName}</accidental>` : ''

    lines.push(`${indent(lvl)}<note>`)
    lines.push(`${indent(lvl + 1)}<pitch><step>${n.pitch.noteName}</step>${alterEl}<octave>${n.pitch.octave}</octave></pitch>`)
    lines.push(`${indent(lvl + 1)}<duration>${divs}</duration>`)
    if (tieEls.length) lines.push(`${indent(lvl + 1)}${tieEls.join('')}`)
    lines.push(`${indent(lvl + 1)}<type>${DURATION_TYPE[n.duration]}</type>`)
    if (dotEls) lines.push(`${indent(lvl + 1)}${dotEls}`)
    if (accEl)  lines.push(`${indent(lvl + 1)}${accEl}`)
    if (beamEl) lines.push(`${indent(lvl + 1)}${beamEl}`)
    if (notEl)  lines.push(`${indent(lvl + 1)}${notEl}`)
    lines.push(`${indent(lvl)}</note>`)

  } else if (event.type === 'rest') {
    const r = event as Rest
    const divs  = dottedDivs(r.duration, r.dots)
    const dotEls = '<dot/>'.repeat(r.dots)
    beamState.active = false

    lines.push(`${indent(lvl)}<note>`)
    lines.push(`${indent(lvl + 1)}<rest/>`)
    lines.push(`${indent(lvl + 1)}<duration>${divs}</duration>`)
    lines.push(`${indent(lvl + 1)}<type>${DURATION_TYPE[r.duration]}</type>`)
    if (dotEls) lines.push(`${indent(lvl + 1)}${dotEls}`)
    lines.push(`${indent(lvl)}</note>`)

  } else if (event.type === 'chord') {
    const c = event as Chord
    const divs   = dottedDivs(c.duration, c.dots)
    const dotEls = '<dot/>'.repeat(c.dots)
    beamState.active = false

    for (let i = 0; i < c.pitches.length; i++) {
      const p       = c.pitches[i]
      const alter   = accidentalAlter(p.accidental)
      const accName = accidentalName(p.accidental)
      const alterEl = alter !== null ? `<alter>${alter}</alter>` : ''
      const accEl   = accName ? `<accidental>${accName}</accidental>` : ''
      const notEl   = i === 0 ? notationsElement([], c.articulations) : ''

      lines.push(`${indent(lvl)}<note>`)
      if (i > 0) lines.push(`${indent(lvl + 1)}<chord/>`)
      lines.push(`${indent(lvl + 1)}<pitch><step>${p.noteName}</step>${alterEl}<octave>${p.octave}</octave></pitch>`)
      lines.push(`${indent(lvl + 1)}<duration>${divs}</duration>`)
      lines.push(`${indent(lvl + 1)}<type>${DURATION_TYPE[c.duration]}</type>`)
      if (dotEls) lines.push(`${indent(lvl + 1)}${dotEls}`)
      if (accEl)  lines.push(`${indent(lvl + 1)}${accEl}`)
      if (notEl)  lines.push(`${indent(lvl + 1)}${notEl}`)
      lines.push(`${indent(lvl)}</note>`)
    }
  }

  return lines
}

// ── Barline element ───────────────────────────────────────────────────────────

function barlineLines(style: string, direction: string | undefined, location: 'left' | 'right', lvl: number): string[] {
  const repeatEl = direction ? `${indent(lvl + 1)}<repeat direction="${direction}"/>` : ''
  return [
    `${indent(lvl)}<barline location="${location}">`,
    `${indent(lvl + 1)}<bar-style>${style}</bar-style>`,
    ...(repeatEl ? [repeatEl] : []),
    `${indent(lvl)}</barline>`,
  ]
}

// ── Part list ─────────────────────────────────────────────────────────────────

function partListLines(score: Score): string[] {
  const lines = ['  <part-list>']
  let midiChannel = 1

  for (let i = 0; i < score.parts.length; i++) {
    const part   = score.parts[i]
    const partId = `P${i + 1}`
    const instrId = `${partId}-I1`
    const isPerc  = part.staves[0]?.clef === 'percussion'
    const channel = isPerc ? 10 : Math.min(midiChannel, 16)
    if (!isPerc) {
      midiChannel++
      if (midiChannel === 10) midiChannel++  // skip channel 10 for non-percussion
    }

    lines.push(
      `    <score-part id="${partId}">`,
      `      <part-name>${esc(part.name)}</part-name>`,
      ...(part.shortName ? [`      <part-abbreviation>${esc(part.shortName)}</part-abbreviation>`] : []),
      `      <score-instrument id="${instrId}">`,
      `        <instrument-name>${esc(part.name)}</instrument-name>`,
      `      </score-instrument>`,
      `      <midi-instrument id="${instrId}">`,
      `        <midi-channel>${channel}</midi-channel>`,
      `        <midi-program>${part.midiProgram}</midi-program>`,
      `        <volume>${Math.round(part.volume * 100)}</volume>`,
      `      </midi-instrument>`,
      `    </score-part>`,
    )
  }

  lines.push('  </part-list>')
  return lines
}

// ── Part / measure sections ───────────────────────────────────────────────────

function partLines(score: Score, partIdx: number): string[] {
  const part  = score.parts[partIdx]
  const staff = part.staves[0]
  if (!staff) return []

  const partId  = `P${partIdx + 1}`
  const lines: string[] = [`  <part id="${partId}">`]

  for (let mIdx = 0; mIdx < staff.measures.length; mIdx++) {
    const measure     = staff.measures[mIdx]
    const prevMeasure = mIdx > 0 ? staff.measures[mIdx - 1] : undefined
    const isFirst     = mIdx === 0
    const lvl         = 2

    lines.push(`    <measure number="${mIdx + 1}">`)

    // Left barline: begin-repeat when previous measure carried repeat-start
    if (prevMeasure?.barline === 'repeat-start') {
      lines.push(...barlineLines('heavy-light', 'forward', 'left', lvl + 1))
    }

    // Attributes (divisions, key, time, clef, transpose)
    lines.push(...attributesBlock(
      measure, prevMeasure, isFirst,
      staff.clef,
      score.keySignature.fifths,
      score.keySignature.mode,
      score.timeSignature,
      part.transposeSemitones,
      lvl + 1,
    ))

    // Directions from directives (tempo on measure 1 always; dynamic/expression as placed)
    lines.push(...directiveLines(
      measure.directives ?? [],
      score.tempo,
      isFirst && partIdx === 0,
      lvl + 1,
    ))

    // Notes — voice 0 only
    const beamState: BeamState = { active: false }
    for (const event of measure.voices[0]?.events ?? []) {
      lines.push(...noteLines(event, beamState, lvl + 1))
    }

    // Right barline for non-default barlines (repeat-start is handled as left of next measure)
    if (measure.barline && measure.barline !== 'single' && measure.barline !== 'repeat-start') {
      const bl: Record<string, [string, string | undefined]> = {
        'double':     ['light-light', undefined],
        'final':      ['light-heavy', undefined],
        'repeat-end': ['light-heavy', 'backward'],
      }
      const [style, dir] = bl[measure.barline] ?? []
      if (style) lines.push(...barlineLines(style, dir, 'right', lvl + 1))
    }

    lines.push('    </measure>')
  }

  lines.push('  </part>')
  return lines
}

// ── Public API ────────────────────────────────────────────────────────────────

export function scoreToMusicXml(score: Score): string {
  const m = score.metadata
  const lines: string[] = []

  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<!DOCTYPE score-partwise PUBLIC')
  lines.push('  "-//Recordare//DTD MusicXML 3.1 Partwise//EN"')
  lines.push('  "http://www.musicxml.org/dtds/partwise.dtd">')
  lines.push('<score-partwise version="3.1">')

  if (m.title) {
    lines.push('  <work>')
    lines.push(`    <work-title>${esc(m.title)}</work-title>`)
    lines.push('  </work>')
  }

  if (m.subtitle) {
    lines.push(`  <movement-title>${esc(m.subtitle)}</movement-title>`)
  }

  lines.push('  <identification>')
  if (m.composer)  lines.push(`    <creator type="composer">${esc(m.composer)}</creator>`)
  if (m.lyricist)  lines.push(`    <creator type="lyricist">${esc(m.lyricist)}</creator>`)
  if (m.arranger)  lines.push(`    <creator type="arranger">${esc(m.arranger)}</creator>`)
  if (m.copyright) lines.push(`    <rights>${esc(m.copyright)}</rights>`)
  lines.push('    <encoding>')
  lines.push('      <software>Notation App</software>')
  lines.push(`      <encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date>`)
  lines.push('    </encoding>')
  lines.push('  </identification>')

  lines.push(...partListLines(score))

  for (let i = 0; i < score.parts.length; i++) {
    lines.push(...partLines(score, i))
  }

  lines.push('</score-partwise>')

  return lines.join('\n')
}
