# Spec: MusicXML Export

## Overview

Export the current score as a MusicXML file. MusicXML is the standard open format for exchanging notation between engraving applications (MuseScore, Sibelius, Dorico, Finale, Flat.io, Verovio). It also lays the foundation for high-quality PDF export via Verovio (see backlog).

---

## Goals

- Produce a valid MusicXML 3.1 document from the internal `Score` model
- Preserve all notation that is visually present in the score: pitches, durations, rests, chords, dots, ties, articulations, clefs, key signatures, time signatures, barlines (including repeats), tempo/dynamic/expression directives, part names and MIDI program assignments, transposing instrument metadata
- Output opens correctly in MuseScore 4 with no data loss or warnings
- File is saved via the native OS Save dialog (`.xml` extension)

---

## Out of Scope

- MXL (compressed MusicXML) — plain `.xml` only in this iteration
- MusicXML import — separate feature
- Volta brackets (not yet in data model)
- Lyrics, figured bass, chord symbols
- Multi-voice export (voice 0 only per staff — see open question)
- Grace notes

---

## Activation

| Action | Trigger |
|--------|---------|
| Export MusicXML | **File → Export → MusicXML…** (new menu item) |

A native Save dialog appears with filter `MusicXML Files (*.xml)`, default filename `<score title>.xml`.

---

## MusicXML Version

**3.1** — broadest compatibility across all target applications. The partwise document type is used (`score-partwise`).

DOCTYPE declaration:
```xml
<!DOCTYPE score-partwise PUBLIC
  "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
```

---

## Divisions

Internal duration units (`DURATION_UNITS` in `musicUtils.ts`) use 64th-note = 1 unit. MusicXML `<divisions>` sets the number of divisions per quarter note. Using **16 divisions per quarter** maps exactly:

| Note | Internal units | MusicXML duration |
|------|---------------|-------------------|
| 64th | 1 | 1 |
| 32nd | 2 | 2 |
| 16th | 4 | 4 |
| Eighth | 8 | 8 |
| Quarter | 16 | 16 |
| Half | 32 | 32 |
| Whole | 64 | 64 |

Dotted notes use the same `<duration>` as their dotted value (e.g. dotted quarter = 24) plus a `<dot/>` element.

---

## Document Structure

```
score-partwise
├── work
│   └── work-title
├── identification
│   ├── creator type="composer"
│   ├── creator type="lyricist"
│   ├── rights (copyright)
│   └── encoding
│       ├── software
│       └── encoding-date
├── part-list
│   └── score-part × N (one per part)
│       ├── part-name
│       ├── part-abbreviation
│       ├── score-instrument
│       └── midi-instrument
└── part × N
    └── measure × M
        ├── attributes (first measure and on change)
        ├── direction (tempo / dynamics / expression directives)
        ├── barline (for non-single barlines)
        └── note × E (one per event; chord pitches share a <chord/> element)
```

---

## Metadata Mapping

| Score field | MusicXML element |
|---|---|
| `metadata.title` | `<work><work-title>` |
| `metadata.subtitle` | `<movement-title>` |
| `metadata.composer` | `<identification><creator type="composer">` |
| `metadata.lyricist` | `<identification><creator type="lyricist">` |
| `metadata.arranger` | `<identification><creator type="arranger">` |
| `metadata.copyright` | `<identification><rights>` |

---

## Part List

Each `Part` in the score generates one `<score-part>`:

```xml
<score-part id="P1">
  <part-name>Violin I</part-name>
  <part-abbreviation>Vln. I</part-abbreviation>
  <score-instrument id="P1-I1">
    <instrument-name>Violin I</instrument-name>
  </score-instrument>
  <midi-instrument id="P1-I1">
    <midi-channel>1</midi-channel>
    <midi-program>41</midi-program>   <!-- part.midiProgram -->
    <volume>80</volume>               <!-- part.volume × 100 -->
  </midi-instrument>
</score-part>
```

MIDI channels are assigned 1–16, channel 10 reserved for percussion (parts with clef `percussion`).

---

## Attributes Block

Emitted on measure 1 and whenever a value changes (clef, key, time). Always includes `<divisions>16</divisions>` on measure 1.

```xml
<attributes>
  <divisions>16</divisions>
  <key>
    <fifths>-1</fifths>
    <mode>major</mode>
  </key>
  <time>
    <beats>3</beats>
    <beat-type>4</beat-type>
  </time>
  <clef>
    <sign>G</sign>
    <line>2</line>
  </clef>
  <transpose>                    <!-- transposing instruments only -->
    <diatonic>-1</diatonic>
    <chromatic>-2</chromatic>
  </transpose>
</attributes>
```

### Clef mapping

| Internal | `<sign>` | `<line>` |
|----------|---------|---------|
| treble | G | 2 |
| bass | F | 4 |
| alto | C | 3 |
| tenor | C | 4 |
| percussion | percussion | — |

### Transposing instruments

`part.transposeSemitones > 0` means the written pitch is above concert pitch. MusicXML `<transpose>` encodes this as:

```
chromatic = -transposeSemitones   (negative = sounds lower than written)
diatonic  = approximation in diatonic steps
```

The notes themselves are stored at **concert pitch** internally and must be transposed to **written pitch** before output (add `transposeSemitones` semitones to the MIDI pitch, then re-spell to the nearest enharmonic).

---

## Notes

### Single note

```xml
<note>
  <pitch>
    <step>G</step>
    <alter>1</alter>      <!-- sharp=1, flat=-1, natural=0 (omit if 0), doubleSharp=2, doubleFlat=-2 -->
    <octave>4</octave>
  </pitch>
  <duration>16</duration>
  <type>quarter</type>
  <dot/>                  <!-- present if dots ≥ 1 -->
  <dot/>                  <!-- present if dots = 2 -->
  <notations>
    <tied type="start"/>  <!-- if tieStart -->
    <articulations>
      <staccato/>
    </articulations>
  </notations>
</note>
```

### Chord

MusicXML represents chords as successive `<note>` elements where all but the first carry `<chord/>`. All pitches share the same duration.

```xml
<note>
  <pitch><step>C</step><octave>4</octave></pitch>
  <duration>16</duration>
  <type>quarter</type>
</note>
<note>
  <chord/>
  <pitch><step>E</step><octave>4</octave></pitch>
  <duration>16</duration>
  <type>quarter</type>
</note>
```

### Rest

```xml
<note>
  <rest/>
  <duration>16</duration>
  <type>quarter</type>
</note>
```

Whole-measure rests use `<rest measure="yes"/>` with no `<type>`.

### Ties

`tieStart=true` → `<tie type="start"/>` inside `<note>` + `<tied type="start"/>` inside `<notations>`.  
`tieEnd=true` → `<tie type="stop"/>` + `<tied type="stop"/>`.

### Accidentals

`<alter>` encodes the accidental as a semitone offset; an additional `<accidental>` element is emitted when the note has an explicit accidental (not just a key signature implication):

| Internal | `<alter>` | `<accidental>` |
|---|---|---|
| `sharp` | 1 | `sharp` |
| `flat` | -1 | `flat` |
| `natural` | 0 | `natural` |
| `doubleSharp` | 2 | `double-sharp` |
| `doubleFlat` | -2 | `double-flat` |
| `null` | (omit) | (omit) |

### Articulations mapping

| Internal | MusicXML element |
|---|---|
| `staccato` | `<staccato/>` |
| `accent` | `<accent/>` |
| `tenuto` | `<tenuto/>` |
| `marcato` | `<strong-accent/>` |
| `fermata` | `<fermata/>` (outside `<articulations>`, sibling) |
| `trill` | `<ornaments><trill-mark/></ornaments>` |
| `mordent` | `<ornaments><mordent/></ornaments>` |
| `turn` | `<ornaments><turn/></ornaments>` |

### Beams

`beamStart=true` → `<beam number="1">begin</beam>`  
`beamEnd=true` → `<beam number="1">end</beam>`  
Beamed notes between start and end (neither flag set, duration < quarter) → `<beam number="1">continue</beam>`

---

## Barlines

Non-default barlines are emitted as `<barline>` elements.

```xml
<!-- repeat-end: right barline of measure -->
<barline location="right">
  <bar-style>light-heavy</bar-style>
  <repeat direction="backward"/>
</barline>

<!-- repeat-start: right barline of measure (signals next measure begins a repeat) -->
<barline location="right">
  <bar-style>heavy-light</bar-style>
  <repeat direction="forward"/>
</barline>

<!-- double -->
<barline location="right">
  <bar-style>light-light</bar-style>
</barline>

<!-- final (last measure — default in MusicXML, can be omitted or explicit) -->
<barline location="right">
  <bar-style>light-heavy</bar-style>
</barline>
```

---

## Directions (Directives)

### Tempo

```xml
<direction placement="above">
  <direction-type>
    <metronome parentheses="no">
      <beat-unit>quarter</beat-unit>
      <per-minute>120</per-minute>
    </metronome>
  </direction-type>
  <sound tempo="120"/>
</direction>
```

If the directive also has a text word (e.g. "Allegro"), a `<words>` element is included before `<metronome>`.

Score-level tempo is emitted on measure 1 even if no explicit directive exists.

### Dynamics

```xml
<direction placement="below">
  <direction-type>
    <dynamics><mf/></dynamics>
  </direction-type>
  <sound dynamics="71"/>    <!-- 0–127 proportional to volume multiplier -->
</direction>
```

### Expression (text only, e.g. "pizz.", "arco")

```xml
<direction placement="above">
  <direction-type>
    <words font-style="italic">pizz.</words>
  </direction-type>
</direction>
```

---

## Module: `musicxmlEngine.ts`

Located at `src/renderer/engine/musicxmlEngine.ts`. Pure function, no React or store imports.

```typescript
export function scoreToMusicXml(score: Score): string
```

Returns a UTF-8 XML string. The IPC layer writes it to disk.

---

## IPC / Menu wiring

New menu item under **File → Export**:

| Item | IPC channel |
|---|---|
| Export MusicXML… | `musicxml:export` |

Main process handler writes the XML string as UTF-8. Preload exposes `exportMusicXml(xml: string)`.

---

## Decisions

| Question | Decision |
|---|---|
| Subtitle | Map to `<movement-title>` |
| Transposing instruments | Written pitch + `<transpose>` element |
| Beaming | Infer `continue` beams from `beamStart`/`beamEnd` flags |
| Voices | Voice 0 only |
| File format | `.xml` (uncompressed) |
