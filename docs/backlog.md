# Backlog

Items deferred from active development.

## PDF Export quality

**Problem:** The current `pdfExporter.ts` renders VexFlow to an offscreen HTML Canvas (794×1123 px) and embeds the result as a PNG bitmap in jsPDF. The output is rasterized at 96 DPI — blurry when printed or zoomed.

**Proposed fix options (in order of effort):**
1. **3× DPI canvas** — render at 2382×3369, scale to A4 in jsPDF. Quick band-aid, still rasterized.
2. **VexFlow SVG backend + svg2pdf.js** — vector output, medium refactor, minor svg2pdf.js/jsPDF 4.x compat risk.
3. **Verovio via MusicXML** — professional engraving quality, requires MusicXML serialiser (being built separately as `musicxmlEngine.ts`). Revisit once MusicXML export is complete.

**Blocked by:** MusicXML export (option 3).
