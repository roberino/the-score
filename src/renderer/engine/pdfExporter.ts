// ─────────────────────────────────────────────────────────────────────────────
// PDF export via Verovio + jsPDF
//
// Pipeline: Score → MusicXML → Verovio SVG (per page) → canvas at 300 DPI → PDF
//
// Verovio is loaded lazily on first export (the WASM module is ~6 MB).
// The toolkit instance is cached across exports so subsequent calls are fast.
// ─────────────────────────────────────────────────────────────────────────────

import { jsPDF } from 'jspdf'
import type { Score } from '@shared/score'
import { scoreToMusicXml } from './musicxmlEngine'

// ── Types ─────────────────────────────────────────────────────────────────────

interface VerovioToolkitInstance {
  setOptions: (opts: Record<string, unknown>) => void
  loadData:   (data: string) => boolean
  getPageCount: () => number
  renderToSVG:  (pageNo: number) => string
  getLog:       () => string
}

// ── Constants ─────────────────────────────────────────────────────────────────

// A4 rendered at 300 DPI — sharp at any print resolution
const A4_MM  = { w: 210, h: 297 }
const DPI    = 300
const A4_PX  = {
  w: Math.round(A4_MM.w * DPI / 25.4),   // 2480
  h: Math.round(A4_MM.h * DPI / 25.4),   // 3508
}

// Verovio page dimensions in 1/10 mm units
const VRV = {
  pageWidth:        2100,   // 210 mm
  pageHeight:       2970,   // 297 mm
  pageMarginTop:    150,    // 15 mm
  pageMarginBottom: 150,
  pageMarginLeft:   200,    // 20 mm (wider left for binding)
  pageMarginRight:  150,
  scale:            40,     // % of full notation size — fits well on A4
}

// ── Lazy toolkit loader ───────────────────────────────────────────────────────

let _toolkit: VerovioToolkitInstance | null = null

async function getToolkit(): Promise<VerovioToolkitInstance> {
  if (_toolkit) return _toolkit

  // Dynamic imports keep the 6 MB WASM out of the initial bundle
  const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
    import('verovio/wasm' as string) as Promise<{ default: () => Promise<unknown> }>,
    import('verovio/esm'  as string) as Promise<{ VerovioToolkit: new (m: unknown) => VerovioToolkitInstance }>,
  ])

  const module  = await createVerovioModule()
  _toolkit = new VerovioToolkit(module)
  return _toolkit
}

// ── SVG → canvas at 300 DPI ──────────────────────────────────────────────────

function svgToCanvas(svg: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width  = A4_PX.w
    canvas.height = A4_PX.h

    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, A4_PX.w, A4_PX.h)

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const img  = new Image()

    img.onload = () => {
      ctx.drawImage(img, 0, 0, A4_PX.w, A4_PX.h)
      URL.revokeObjectURL(url)
      resolve(canvas)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to render SVG page to canvas'))
    }
    img.src = url
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

// Strip HTML tags to get plain text for PDF rendering
function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent ?? ''
}

export async function exportScorePdf(score: Score): Promise<Uint8Array> {
  const tk = await getToolkit()

  tk.setOptions({
    pageWidth:        VRV.pageWidth,
    pageHeight:       VRV.pageHeight,
    pageMarginTop:    VRV.pageMarginTop,
    pageMarginBottom: VRV.pageMarginBottom,
    pageMarginLeft:   VRV.pageMarginLeft,
    pageMarginRight:  VRV.pageMarginRight,
    scale:            VRV.scale,
    adjustPageHeight: false,
    breaks:           'auto',
  })

  const xml = scoreToMusicXml(score)
  if (!tk.loadData(xml)) {
    console.error('Verovio failed to load MusicXML\n', tk.getLog())
    return new Uint8Array()
  }

  const pageCount = tk.getPageCount()
  if (pageCount === 0) return new Uint8Array()

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  // Scale factor: canvas px at zoom=1 (1200px wide) → A4 mm
  const CANVAS_WIDTH_PX = 1200
  const pxToMm = A4_MM.w / CANVAS_WIDTH_PX
  const textBoxes = score.textBoxes ?? []

  for (let page = 1; page <= pageCount; page++) {
    const svg    = tk.renderToSVG(page)
    const canvas = await svgToCanvas(svg)

    if (page > 1) pdf.addPage()
    // PNG preserves notation's sharp edges cleanly; JPEG would introduce artefacts
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, A4_MM.w, A4_MM.h)

    // Overlay text boxes (all on every page — multi-page mapping is future work)
    pdf.setTextColor(0, 0, 0)
    pdf.setFontSize(10)
    for (const box of textBoxes) {
      const text = stripHtml(box.html).trim()
      if (!text) continue
      const xMm = Math.max(0, Math.min(box.x * pxToMm, A4_MM.w - 10))
      const yMm = Math.max(5, Math.min(box.y * pxToMm, A4_MM.h - 5))
      pdf.text(text, xMm, yMm, { maxWidth: box.width * pxToMm })
    }
  }

  return new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer)
}
