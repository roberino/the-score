# Backlog

Items deferred from active development.

## MusicXML Feature Gaps

Features supported by the MusicXML standard that are not yet implemented in the editor.

| Priority | Feature | Description | Status |
|----------|---------|-------------|--------|
| High | Volta brackets | First/second endings (1., 2., etc.) — import, render, playback, export | Complete |
| High | Multiple voices | Two independent voices per staff (e.g., soprano+alto on treble) — data model, rendering, editing | Complete |
| High | Lyrics | Syllable-by-syllable text attached to notes, including melisma slurs | Complete |
| High | Grand staff / multi-stave parts | Single instrument (piano) spanning multiple staves linked by brace | Not Started |
| High | Ottava lines | 8va / 8vb / 15ma transposition lines — render and affect playback pitch | Not Started |
| High | Chord symbols / harmony | Chord names above the staff (C, Dm7, G/B, etc.) | Not Started |
| Medium | Grace notes | Acciaccatura and appoggiatura — import, render, basic playback | Not Started |
| Medium | Rehearsal marks | Boxed letters/numbers (A, B, 1, 2) at section boundaries | Not Started |
| Medium | Segno / Coda / D.S. / D.C. | Repeat navigation signs and their jump logic in playback | Not Started |
| Medium | Tremolo | Single-note and alternating tremolo — render and playback | Not Started |
| Medium | Breath marks & caesura | Breath mark (comma) and caesura (railway tracks) between notes | Not Started |
| Medium | Extended tuplet ratios | 7:4, 9:8 and other non-standard ratios beyond 3:2, 5:4, 6:4 | Not Started |
| Medium | Unpitched percussion / drum notation | Drum clef, unpitched noteheads, GM drum map for playback | Not Started |
| Low | Nested tuplets | Tuplets inside tuplets (e.g., triplet within a quintuplet) | Not Started |
| Low | Composite time signatures | Additive meters like 3+2+2/8 | Not Started |
| Low | Alternative note heads | X heads, diamond heads, slash heads, etc. | Not Started |
| Low | Fingering & string numbers | Fingering digits and circled string numbers for guitar/strings | Not Started |
| Low | Arpeggio / glissando / portamento | Wavy arpeggiation, glissando lines, portamento slides | Not Started |
| Low | Cross-staff notation | Notes belonging to one voice but displayed on an adjacent staff | Not Started |

---

## PDF Export quality

**Problem:** The current `pdfExporter.ts` renders VexFlow to an offscreen HTML Canvas (794×1123 px) and embeds the result as a PNG bitmap in jsPDF. The output is rasterized at 96 DPI — blurry when printed or zoomed.

**Proposed fix options (in order of effort):**
1. **3× DPI canvas** — render at 2382×3369, scale to A4 in jsPDF. Quick band-aid, still rasterized.
2. **VexFlow SVG backend + svg2pdf.js** — vector output, medium refactor, minor svg2pdf.js/jsPDF 4.x compat risk.
3. **Verovio via MusicXML** — professional engraving quality, requires MusicXML serialiser (being built separately as `musicxmlEngine.ts`). Revisit once MusicXML export is complete.

**Blocked by:** MusicXML export (option 3).
