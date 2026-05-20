// ─────────────────────────────────────────────────────────────────────────────
// MusicXML engine — MusicXML 3.1 partwise
//
// scoreToMusicXml(score) → UTF-8 XML string
// musicxmlToScore(xml)   → Score
//
// Notes are stored at written pitch in the model (pitchToHz subtracts
// transposeSemitones to get sounding pitch), so notes are output as-is
// and a <transpose> element carries the sounding-pitch offset for importing apps.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid'
import type {
  Score, Part, Staff, Measure, Voice, NoteEvent, Note, Rest, Chord,
  Pitch, NoteName, Duration, Accidental, ClefType, BarlineType, Articulation,
  Directive, Slur, Hairpin, ScoreMetadata, TimeSignature, KeySignature,
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

interface SlurNotation {
  number: number
  type: 'start' | 'stop'
  placement?: 'above' | 'below'
}

function notationsElement(
  tieTypes: string[],
  articulations: readonly string[],
  slur?: SlurNotation,
): string {
  const parts: string[] = []

  for (const t of tieTypes) parts.push(`<tied type="${t}"/>`)
  if (slur) {
    const pl = slur.placement ? ` placement="${slur.placement}"` : ''
    parts.push(`<slur number="${slur.number}" type="${slur.type}"${pl}/>`)
  }

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

function noteLines(
  event: NoteEvent,
  beamState: BeamState,
  lvl: number,
  slurMap?: Map<string, SlurNotation>,
): string[] {
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

    const slur  = slurMap?.get(n.id)
    const notEl = notationsElement(tieTypes, n.articulations, slur)
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

function buildHairpinMaps(staff: Staff): {
  starts: Map<string, 'crescendo' | 'decrescendo'>
  stops:  Set<string>
} {
  const starts = new Map<string, 'crescendo' | 'decrescendo'>()
  const stops  = new Set<string>()
  for (const h of staff.hairpins ?? []) {
    starts.set(h.fromNoteId, h.type)
    stops.add(h.toNoteId)
  }
  return { starts, stops }
}

function buildSlurMap(staff: Staff): Map<string, SlurNotation> {
  const map = new Map<string, SlurNotation>()
  let num = 1
  for (const slur of staff.slurs ?? []) {
    const notation: SlurNotation = { number: num, type: 'start' }
    if (slur.placement) notation.placement = slur.placement
    map.set(slur.fromNoteId, notation)
    map.set(slur.toNoteId,   { number: num, type: 'stop' })
    num = (num % 6) + 1  // MusicXML supports slur numbers 1–6
  }
  return map
}

function partLines(score: Score, partIdx: number): string[] {
  const part  = score.parts[partIdx]
  const staff = part.staves[0]
  if (!staff) return []

  const partId  = `P${partIdx + 1}`
  const lines: string[] = [`  <part id="${partId}">`]
  const slurMap   = buildSlurMap(staff)
  const hairpinMaps = buildHairpinMaps(staff)

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
      const hairpinType = hairpinMaps.starts.get(event.id)
      if (hairpinType) {
        const wedgeType = hairpinType === 'crescendo' ? 'crescendo' : 'diminuendo'
        lines.push(
          `      <direction placement="below">`,
          `        <direction-type><wedge type="${wedgeType}" spread="0"/></direction-type>`,
          `      </direction>`,
        )
      }
      lines.push(...noteLines(event, beamState, lvl + 1, slurMap))
      if (hairpinMaps.stops.has(event.id)) {
        lines.push(
          `      <direction placement="below">`,
          `        <direction-type><wedge type="stop"/></direction-type>`,
          `      </direction>`,
        )
      }
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

// ── Import (MusicXML → Score) ─────────────────────────────────────────────────

const XML_TYPE_TO_DURATION: Record<string, Duration> = {
  whole: 'whole', half: 'half', quarter: 'quarter',
  eighth: 'eighth', '16th': '16th', '32nd': '32nd', '64th': '64th',
}

function xmlClef(clefEl: Element): ClefType {
  const sign = clefEl.querySelector('sign')?.textContent?.trim() ?? ''
  const line  = clefEl.querySelector('line')?.textContent?.trim()
  if (sign === 'G') return 'treble'
  if (sign === 'F') return 'bass'
  if (sign === 'C' && line === '3') return 'alto'
  if (sign === 'C' && line === '4') return 'tenor'
  if (sign === 'percussion') return 'percussion'
  return 'treble'
}

function xmlPitch(noteEl: Element): Pitch {
  const pitchEl  = noteEl.querySelector('pitch')
  const noteName = (pitchEl?.querySelector('step')?.textContent?.trim() ?? 'C') as NoteName
  const octave   = parseInt(pitchEl?.querySelector('octave')?.textContent ?? '4')
  const alterRaw = pitchEl?.querySelector('alter')?.textContent?.trim()
  const alter    = alterRaw !== undefined && alterRaw !== '' ? Math.round(parseFloat(alterRaw)) : null
  const hasNatural = noteEl.querySelector('accidental')?.textContent?.trim() === 'natural'

  let accidental: Accidental = null
  if (alter === 2)       accidental = 'doubleSharp'
  else if (alter === 1)  accidental = 'sharp'
  else if (alter === -1) accidental = 'flat'
  else if (alter === -2) accidental = 'doubleFlat'
  else if (alter === 0 && hasNatural) accidental = 'natural'

  return { noteName, octave, accidental }
}

function xmlDuration(noteEl: Element): Duration {
  const t = noteEl.querySelector('type')?.textContent?.trim() ?? 'quarter'
  return XML_TYPE_TO_DURATION[t] ?? 'quarter'
}

function xmlDots(noteEl: Element): 0 | 1 | 2 {
  return Math.min(2, noteEl.querySelectorAll('dot').length) as 0 | 1 | 2
}

function xmlArticulations(noteEl: Element): Articulation[] {
  const result: Articulation[] = []
  const notEl = noteEl.querySelector('notations')
  if (!notEl) return result
  const artEl = notEl.querySelector('articulations')
  if (artEl) {
    if (artEl.querySelector('staccato'))      result.push('staccato')
    if (artEl.querySelector('accent'))        result.push('accent')
    if (artEl.querySelector('tenuto'))        result.push('tenuto')
    if (artEl.querySelector('strong-accent')) result.push('marcato')
  }
  const ornEl = notEl.querySelector('ornaments')
  if (ornEl) {
    if (ornEl.querySelector('trill-mark')) result.push('trill')
    if (ornEl.querySelector('mordent'))    result.push('mordent')
    if (ornEl.querySelector('turn'))       result.push('turn')
  }
  if (notEl.querySelector('fermata')) result.push('fermata')
  return result
}

function hasDirectChild(el: Element, tag: string): boolean {
  return Array.from(el.children).some(c => c.tagName.toLowerCase() === tag)
}

function parseMusicXmlPart(
  partEl: Element,
  scoreKeyFifths: number,
  scoreKeyMode: 'major' | 'minor',
  scoreTsNum: number,
  scoreTsDen: number,
): Staff {
  const measureEls = Array.from(partEl.querySelectorAll('measure'))
  const measures: Measure[] = []
  const slurs: Slur[] = []
  const hairpins: Hairpin[] = []

  let staffClef: ClefType = 'treble'
  let prevKeyFifths = scoreKeyFifths
  let prevKeyMode: 'major' | 'minor' = scoreKeyMode
  let prevTsNum = scoreTsNum, prevTsDen = scoreTsDen

  const pendingSlurStarts = new Map<string, { fromNoteId: string; placement?: 'above' | 'below' }>()
  // Object wrapper avoids TypeScript over-narrowing inside the flushNoteBuffer closure
  const hp: {
    awaiting: 'crescendo' | 'decrescendo' | null
    open: { type: 'crescendo' | 'decrescendo'; fromNoteId: string } | null
  } = { awaiting: null, open: null }

  for (let mIdx = 0; mIdx < measureEls.length; mIdx++) {
    const measureEl = measureEls[mIdx]

    // ── Attributes ────────────────────────────────────────────────────────────
    let measureKey: KeySignature | undefined
    let measureTs: TimeSignature | undefined
    let measureClef: { type: ClefType } | undefined

    const attrsEl = measureEl.querySelector('attributes')
    if (attrsEl) {
      const keyEl = attrsEl.querySelector('key')
      if (keyEl) {
        const f = parseInt(keyEl.querySelector('fifths')?.textContent ?? String(prevKeyFifths))
        const m: 'major' | 'minor' = keyEl.querySelector('mode')?.textContent?.trim() === 'minor' ? 'minor' : 'major'
        if (mIdx > 0 && (f !== prevKeyFifths || m !== prevKeyMode)) measureKey = { fifths: f, mode: m }
        prevKeyFifths = f; prevKeyMode = m
      }
      const timeEl = attrsEl.querySelector('time')
      if (timeEl) {
        const n = parseInt(timeEl.querySelector('beats')?.textContent ?? String(prevTsNum))
        const d = parseInt(timeEl.querySelector('beat-type')?.textContent ?? String(prevTsDen))
        if (mIdx > 0 && (n !== prevTsNum || d !== prevTsDen)) measureTs = { numerator: n, denominator: d }
        prevTsNum = n; prevTsDen = d
      }
      const clefEl = attrsEl.querySelector('clef')
      if (clefEl) {
        const c = xmlClef(clefEl)
        if (mIdx === 0) staffClef = c
        else measureClef = { type: c }
      }
    }

    // ── Barline ───────────────────────────────────────────────────────────────
    let barline: BarlineType = mIdx === measureEls.length - 1 ? 'final' : 'single'
    for (const blEl of Array.from(measureEl.querySelectorAll('barline'))) {
      const location  = blEl.getAttribute('location') ?? 'right'
      const style     = blEl.querySelector('bar-style')?.textContent?.trim()
      const repeatDir = blEl.querySelector('repeat')?.getAttribute('direction')
      if (location === 'right') {
        if (style === 'light-light')                                  barline = 'double'
        else if (style === 'light-heavy' && repeatDir === 'backward') barline = 'repeat-end'
        else if (style === 'light-heavy')                             barline = 'final'
      } else if (location === 'left' && style === 'heavy-light' && repeatDir === 'forward') {
        if (mIdx > 0) measures[mIdx - 1] = { ...measures[mIdx - 1], barline: 'repeat-start' }
      }
    }

    // ── Notes and directions ──────────────────────────────────────────────────
    const events: NoteEvent[] = []
    const directives: Directive[] = []
    let noteBuffer: Element[] = []
    let lastEventId: string | null = null

    const flushNoteBuffer = (): void => {
      if (noteBuffer.length === 0) return
      const isRest = hasDirectChild(noteBuffer[0], 'rest')
      let event: NoteEvent

      if (isRest) {
        event = { id: uuid(), type: 'rest', duration: xmlDuration(noteBuffer[0]), dots: xmlDots(noteBuffer[0]) }
      } else if (noteBuffer.length === 1) {
        const el = noteBuffer[0]
        const noteId = uuid()
        const tieStart = Array.from(el.querySelectorAll('tie')).some(t => t.getAttribute('type') === 'start')
        const tieEnd   = Array.from(el.querySelectorAll('tie')).some(t => t.getAttribute('type') === 'stop')
        const beamEl   = Array.from(el.querySelectorAll('beam')).find(b => b.getAttribute('number') === '1')
        const beamTxt  = beamEl?.textContent?.trim()

        for (const slurEl of Array.from(el.querySelectorAll('notations slur'))) {
          const num = slurEl.getAttribute('number') ?? '1'
          const plc = slurEl.getAttribute('placement') as 'above' | 'below' | null
          if (slurEl.getAttribute('type') === 'start') {
            pendingSlurStarts.set(num, { fromNoteId: noteId, ...(plc ? { placement: plc } : {}) })
          } else if (slurEl.getAttribute('type') === 'stop') {
            const s = pendingSlurStarts.get(num)
            if (s) { slurs.push({ id: uuid(), fromNoteId: s.fromNoteId, toNoteId: noteId, ...(s.placement ? { placement: s.placement } : {}) }); pendingSlurStarts.delete(num) }
          }
        }
        event = {
          id: noteId, type: 'note', pitch: xmlPitch(el),
          duration: xmlDuration(el), dots: xmlDots(el),
          tieStart, tieEnd, beamStart: beamTxt === 'begin', beamEnd: beamTxt === 'end',
          articulations: xmlArticulations(el),
        }
      } else {
        const chordId = uuid()
        const firstEl = noteBuffer[0]
        for (const slurEl of Array.from(firstEl.querySelectorAll('notations slur'))) {
          const num = slurEl.getAttribute('number') ?? '1'
          const plc = slurEl.getAttribute('placement') as 'above' | 'below' | null
          if (slurEl.getAttribute('type') === 'start') {
            pendingSlurStarts.set(num, { fromNoteId: chordId, ...(plc ? { placement: plc } : {}) })
          } else if (slurEl.getAttribute('type') === 'stop') {
            const s = pendingSlurStarts.get(num)
            if (s) { slurs.push({ id: uuid(), fromNoteId: s.fromNoteId, toNoteId: chordId, ...(s.placement ? { placement: s.placement } : {}) }); pendingSlurStarts.delete(num) }
          }
        }
        event = {
          id: chordId, type: 'chord', pitches: noteBuffer.map(xmlPitch),
          duration: xmlDuration(firstEl), dots: xmlDots(firstEl),
          articulations: xmlArticulations(firstEl),
        }
      }

      if (hp.awaiting) { hp.open = { type: hp.awaiting, fromNoteId: event.id }; hp.awaiting = null }
      events.push(event)
      lastEventId = event.id
      noteBuffer = []
    }

    for (const child of Array.from(measureEl.children)) {
      const tag = child.tagName.toLowerCase()

      if (tag === 'note') {
        if (!hasDirectChild(child, 'chord')) flushNoteBuffer()
        noteBuffer.push(child)
      } else if (tag === 'direction') {
        const wedge = child.querySelector('direction-type wedge')
        if (wedge) {
          const wt = wedge.getAttribute('type')
          if (wt === 'crescendo') {
            hp.awaiting = 'crescendo'
          } else if (wt === 'diminuendo') {
            hp.awaiting = 'decrescendo'
          } else if (wt === 'stop') {
            flushNoteBuffer()
            const hType   = hp.open?.type
            const hFromId = hp.open?.fromNoteId
            if (hType && hFromId && lastEventId) {
              hairpins.push({ id: uuid(), type: hType, fromNoteId: hFromId, toNoteId: lastEventId })
              hp.open = null
            }
          }
        }

        const soundEl  = child.querySelector('sound')
        const dynEl    = child.querySelector('direction-type dynamics')
        const wordsEl  = child.querySelector('direction-type words')
        if (soundEl?.getAttribute('tempo')) {
          const t = parseFloat(soundEl.getAttribute('tempo')!)
          if (!isNaN(t) && t > 0) {
            const bpm = Math.round(t)
            const text = wordsEl?.textContent?.trim() || `♩=${bpm}`
            directives.push({ id: uuid(), category: 'tempo', text, bpm })
          }
        } else if (dynEl && dynEl.children.length > 0) {
          const dynTag = dynEl.children[0].tagName
          directives.push({ id: uuid(), category: 'dynamic', text: dynTag })
        } else if (wordsEl) {
          const text = wordsEl.textContent?.trim() ?? ''
          if (text) directives.push({ id: uuid(), category: 'expression', text })
        }
      }
    }
    flushNoteBuffer()

    measures.push({
      id: uuid(), number: mIdx + 1,
      voices: [{ id: uuid(), events } as Voice],
      barline,
      ...(measureKey   ? { keySignature: measureKey }   : {}),
      ...(measureTs    ? { timeSignature: measureTs }    : {}),
      ...(measureClef  ? { clef: measureClef }           : {}),
      ...(directives.length > 0 ? { directives }         : {}),
    })
  }

  return {
    id: uuid(), clef: staffClef, measures,
    ...(slurs.length    > 0 ? { slurs }    : {}),
    ...(hairpins.length > 0 ? { hairpins } : {}),
  }
}

export function musicxmlToScore(xml: string): Score {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Invalid MusicXML')

  const now = new Date().toISOString()

  // ── Metadata ──────────────────────────────────────────────────────────────
  const workTitle = doc.querySelector('work work-title')?.textContent?.trim() ?? ''
  const movTitle  = doc.querySelector('movement-title')?.textContent?.trim() ?? ''
  const title     = workTitle || movTitle || 'Untitled'
  const subtitle  = workTitle && movTitle ? movTitle : ''

  const metadata: ScoreMetadata = {
    title, subtitle,
    composer:  doc.querySelector('identification creator[type="composer"]')?.textContent?.trim() ?? '',
    lyricist:  doc.querySelector('identification creator[type="lyricist"]')?.textContent?.trim() ?? '',
    arranger:  doc.querySelector('identification creator[type="arranger"]')?.textContent?.trim() ?? '',
    copyright: doc.querySelector('identification rights')?.textContent?.trim() ?? '',
    createdAt: now, updatedAt: now,
  }

  // ── Part info from <part-list> ────────────────────────────────────────────
  interface PartInfo { name: string; shortName: string; midiProgram: number; midiChannel: number; volume: number }
  const partInfoMap = new Map<string, PartInfo>()
  for (const sp of Array.from(doc.querySelectorAll('part-list score-part'))) {
    const id        = sp.getAttribute('id') ?? ''
    const name      = sp.querySelector('part-name')?.textContent?.trim() ?? 'Part'
    const shortName = sp.querySelector('part-abbreviation')?.textContent?.trim() ?? name.slice(0, 4)
    const rawProg   = parseInt(sp.querySelector('midi-instrument midi-program')?.textContent ?? '1')
    const rawChan   = parseInt(sp.querySelector('midi-instrument midi-channel')?.textContent ?? '1')
    const rawVol    = parseInt(sp.querySelector('midi-instrument volume')?.textContent ?? '80')
    partInfoMap.set(id, {
      name, shortName,
      midiProgram: Math.max(0, Math.min(127, rawProg - 1)),
      midiChannel: Math.max(1, Math.min(16, rawChan)),
      volume: Math.max(0, Math.min(1, rawVol / 100)),
    })
  }

  // ── Score-level key / time / tempo from first part's first measure ────────
  let scoreKeyFifths = 0
  let scoreKeyMode: 'major' | 'minor' = 'major'
  let scoreTsNum = 4, scoreTsDen = 4, scoreTempo = 120

  const firstPartEl    = doc.querySelector('score-partwise > part')
  const firstMeasureEl = firstPartEl?.querySelector('measure')
  if (firstMeasureEl) {
    const keyEl = firstMeasureEl.querySelector('attributes key')
    if (keyEl) {
      scoreKeyFifths = parseInt(keyEl.querySelector('fifths')?.textContent ?? '0')
      if (keyEl.querySelector('mode')?.textContent?.trim() === 'minor') scoreKeyMode = 'minor'
    }
    const timeEl = firstMeasureEl.querySelector('attributes time')
    if (timeEl) {
      scoreTsNum = parseInt(timeEl.querySelector('beats')?.textContent ?? '4')
      scoreTsDen = parseInt(timeEl.querySelector('beat-type')?.textContent ?? '4')
    }
  }
  const firstSoundEl = doc.querySelector('sound[tempo]')
  if (firstSoundEl) {
    const t = parseFloat(firstSoundEl.getAttribute('tempo') ?? '120')
    if (!isNaN(t) && t > 0) scoreTempo = Math.round(t)
  }

  // ── Build parts ───────────────────────────────────────────────────────────
  const parts: Part[] = []
  for (const partEl of Array.from(doc.querySelectorAll('score-partwise > part'))) {
    const partId = partEl.getAttribute('id') ?? ''
    const info = partInfoMap.get(partId) ?? { name: 'Part', shortName: 'Pt.', midiProgram: 0, midiChannel: 1, volume: 0.8 }

    const firstM = partEl.querySelector('measure')
    const transposeEl = firstM?.querySelector('attributes transpose')
    const chromatic = transposeEl ? parseInt(transposeEl.querySelector('chromatic')?.textContent ?? '0') : 0
    const transposeSemitones = transposeEl ? -chromatic : 0

    const staff = parseMusicXmlPart(partEl, scoreKeyFifths, scoreKeyMode, scoreTsNum, scoreTsDen)

    parts.push({
      id: uuid(),
      name: info.name,
      shortName: info.shortName,
      midiProgram: info.midiProgram,
      midiChannel: info.midiChannel,
      transposeSemitones,
      staves: [staff],
      volume: info.volume,
      muted: false,
      labelVisible: true,
    })
  }

  return {
    id: uuid(), metadata, parts,
    keySignature: { fifths: scoreKeyFifths, mode: scoreKeyMode },
    timeSignature: { numerator: scoreTsNum, denominator: scoreTsDen },
    tempo: scoreTempo,
    showPartLabels: true,
    textBoxes: [],
    version: 1,
  }
}

// ── Export (Score → MusicXML) ─────────────────────────────────────────────────

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
