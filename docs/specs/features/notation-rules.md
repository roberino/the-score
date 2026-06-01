# Notation Rules

## 1. Accidentals

An accidental (sharp, flat, natural, double-sharp, or double-flat) applies to every subsequent note of the same pitch *and octave* within the same measure. It remains active until the barline.

If a note that would otherwise be affected by an in-measure accidental is to be played at its natural (key-signature) pitch, it must be preceded by a natural sign (or a sharp/flat restoring the key-signature value if applicable).

**Tied notes across barlines** — a pitch tied from one measure into the next retains the accidental on the tied continuation note; the continuation note does *not* display the accidental symbol (the tie implies continuity). Accidentals are not otherwise carried across barlines.

**Accidentals within chords** — each note in a chord is treated independently. If two notes in the same chord share a pitch class but are in different octaves, each requires its own accidental.

**Octave independence** — an accidental on C4 does not apply to C5 in the same measure. Accidentals apply only to the exact octave on which they appear.

### Courtesy (cautionary) accidentals

A courtesy accidental is a reminder accidental shown in parentheses. It is not required by the rules above but is conventional in the following situations:

- A note appears in the measure immediately following a measure in which the same pitch carried an accidental (the barline resets it, but the reminder prevents misreading).
- A note immediately follows a tied note that carried an accidental into the measure (the tie ends and the pitch returns to its key-signature value).
- A key signature change causes a previously accidentalled pitch to change its default (see §5.1).

Courtesy accidentals are editorial: their display should be toggleable per note.

---

## 2. Stems

### 2.1 Single-voice stem direction

- Notes below the middle staff line (B4 in treble, D3 in bass): stem **up**.
- Notes above the middle staff line: stem **down**.
- Notes on the middle line: stem direction follows the prevailing context (typically down by convention, or matching adjacent notes in a phrase).
- For chords, the stem direction is determined by the note furthest from the middle line. If equidistant, stem goes down.

### 2.2 Multi-voice stem direction

When two voices share a staff, stems are forced regardless of pitch:

- **Voice 1**: stems always **up**.
- **Voice 2**: stems always **down**.

This overrides the single-voice rules above.

### 2.3 Stem length

The default stem length is one octave (3.5 staff spaces). Stems are lengthened when a note is far from the middle staff line so that the stem tip reaches at least to the middle line. Beamed notes may have shortened or lengthened stems to keep the beam slope moderate.

---

## 3. Beams

### 3.1 Beam grouping by time signature

Notes are beamed together within the natural beat groupings of the time signature. A beat boundary always breaks a beam.

| Metre | Beat unit | Beam group |
|---|---|---|
| 2/4, 3/4, 4/4 | quarter | up to 4 eighth notes or 8 sixteenth notes per beat |
| 2/2 (cut time) | half | up to 4 eighth notes per beat |
| 3/8 | dotted quarter | all three eighth notes beam together |
| 6/8, 12/8 | dotted quarter | beam within each dotted-quarter pulse (groups of 3 eighths) |
| 9/8 | dotted quarter | three groups of 3 eighths |
| 5/4 | varies | typically 2+3 or 3+2; follows the established subdivision |

Beaming never crosses a beat boundary unless explicitly overridden by the user.

### 3.2 Beam slope

The beam slope follows the melodic contour: rising phrase → slight upward slope; falling phrase → slight downward slope; repeated pitch or ambiguous contour → flat beam. Slope is capped to prevent extreme angles (maximum ~15°).

### 3.3 Secondary beams (16th and shorter)

Secondary beam groups follow the same beat-subdivision logic. A secondary beam break (where the primary beam continues but the secondary beam stops) may appear at the half-beat to clarify subdivision. A full beam break is preferred over a partial break when both groupings are equal.

### 3.4 Beam suppression for tuplet brackets

When a tuplet group is fully beamed, the bracket is suppressed and only the number is shown. The bracket is displayed only when the group contains rests, mixed durations, or unbeamed noteheads (quarter notes or longer).

---

## 4. Rests

### 4.1 Single-voice rest placement

- **Whole rest**: hangs from the fourth line (second from top).
- **Half rest**: sits on the third line (middle line).
- **All other rests**: centred vertically on the middle line.

### 4.2 Multi-voice rest placement

When two voices share a staff, rests are displaced so the two voices do not collide:

- **Voice 1** rests move **up** from the default position (whole/half rests raised by one space; shorter rests moved to the upper half of the staff).
- **Voice 2** rests move **down** from the default position (whole/half rests lowered by one space; shorter rests moved to the lower half of the staff).

### 4.3 Whole-measure rests

A whole-measure rest is always notated as a whole rest regardless of the time signature (even in 3/4, 6/8, etc.). In multi-measure rests (e.g. in a part with extended tacet passages), a thick horizontal line with a number above indicates the number of silent measures.

---

## 5. Key signatures

### 5.1 Key signature changes mid-score

When the key signature changes mid-score:

1. Natural cancellation signs are shown for every pitch that was sharp or flat in the outgoing key but is natural in the incoming key. These appear *before* the new key signature accidentals, reading left to right in a standard order (cancellation order is the reverse of the circle of fifths relative to the departing key).
2. If the new key has more sharps/flats of the same type (e.g. G major → D major, both sharp keys), only the *added* sharps appear; no cancellation naturals are needed.
3. If the key changes from sharps to flats or vice versa, all outgoing accidentals are cancelled before the new ones appear.
4. A key change to C major / A minor (no accidentals) shows only cancellation naturals.

### 5.2 Courtesy key signature at system breaks

When a key signature change falls immediately at the start of a new system, a small "warning" key signature is shown at the end of the preceding system, after the final barline. This applies to both key changes and the return to no accidentals.

### 5.3 Enharmonic spelling

Within a given key, pitches should be spelled according to their diatonic function:

- In sharp keys, prefer sharp spellings (F#, C#, G#…) over their flat enharmonic equivalents.
- In flat keys, prefer flat spellings (Bb, Eb, Ab…) over sharp equivalents.
- In C major / A minor, use the spelling that requires the fewest accidentals in context (typically sharps for raised pitches, flats for lowered ones).

Double accidentals (double-sharp, double-flat) are used when diatonic logic requires them (e.g. the seventh degree of A# harmonic minor is G##), not as a shortcut to avoid a natural sign.

---

## 6. Time signatures

### 6.1 Courtesy time signature at system breaks

When a time signature change falls immediately at the start of a new system, a small warning time signature is shown at the end of the preceding system after the final barline.

### 6.2 Pickup bars (anacrusis)

A pickup bar is an incomplete first measure that contains less than a full bar's worth of beats. Convention:

- The pickup bar is excluded from bar numbering: bar 1 begins at the first full measure.
- The pickup bar has no rest fill; only the actual pickup notes appear.
- When a repeat includes a pickup, the pickup is included in the repeated material; the end-repeat barline is placed at the end of the penultimate full measure, and the pickup leads into the next section naturally.

---

## 7. Chords and note spacing

### 7.1 Second intervals and unisons

When two notes in a chord are a minor or major second apart, the upper note is offset to the right of the stem. When two notes are a unison (same pitch, different voices), one is offset to avoid overlap.

The rule is: noteheads on the same side as the stem alternate to the opposite side when in close interval; noteheads on the opposite side from the stem are not displaced unless they collide.

### 7.2 Multi-voice note collision

When two voices share a stem direction conflict (Voice 1 note is lower than the Voice 2 note at the same beat), stems still follow the voice rule (§2.2). Noteheads may share the same horizontal position if the interval is a third or larger; seconds and unisons require the offset rule in §7.1.

---

## 8. Ties and slurs

### 8.1 Ties

A tie connects two notes of **identical pitch**. The second note is not re-attacked; its duration is added to the first. The tie arc is placed on the opposite side from the stem (stem-up → tie below; stem-down → tie above). For notes on ledger lines or at the extremes of the staff, the tie may flip to avoid collision with the staff lines.

Ties in multi-voice writing follow the voice stem direction: Voice 1 ties below (notehead side), Voice 2 ties above.

### 8.2 Slurs

A slur connects notes of **different pitches** (or the same pitch when legato articulation is intended rather than duration extension). The arc placement mirrors the tie rule: opposite side from the stem, or below the notes when stem direction is ambiguous. Slurs default to the notehead side when explicitly placed.

A slur over a group of notes starts at the first notehead and ends at the last notehead in the group (not at the stems).

---

## 9. Tuplets

A tuplet is a group of notes that fills the time of a different number of notes of the same value (e.g. three eighth notes in the time of two = triplet).

- The tuplet number is shown above or below the group, on the stem side.
- A bracket is shown when the group is not fully beamed (see §3.4).
- Nested tuplets (a triplet within a triplet) follow the same rules recursively.
- Tuplet notation applies to the notated durations only; the sounding durations are proportionally compressed or expanded.
