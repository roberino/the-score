import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Toolbar } from './Toolbar'
import { ScoreCanvas } from './ScoreCanvas'
import { RoutingView } from './RoutingView'
import { StatusBar } from './StatusBar'
import { PartsPanel } from './PartsPanel'
import type { Score } from '@shared/score'
import { scoreToMidi, midiToScore } from '../engine/midiEngine'
import { loadSampler } from '../engine/samplerEngine'
import { exportScorePdf } from '../engine/pdfExporter'
import { scoreToMusicXml, musicxmlToScore } from '../engine/musicxmlEngine'

type AppView = 'score' | 'routing'

const TAB_LABELS: Record<AppView, string> = {
  score:   'Score',
  routing: 'Routing',
}

export function App(): JSX.Element {
  const { undo, redo, newScore, loadScore, saveScore, saveScoreAs, setZoom, zoom,
          isPlaying, startPlayback, stopPlayback, inputMode } = useAppStore()
  const [partsPanelOpen, setPartsPanelOpen] = useState(false)
  const [activeView, setActiveView] = useState<AppView>('score')

  // Prefetch Salamander Grand Piano samples in the background
  useEffect(() => { loadSampler() }, [])

  // ── Wire native menu events to store actions ────────────────────────────────
  useEffect(() => {
    const cleanups = [
      window.electronAPI.onMenuEvent('menu:new',     () => newScore()),
      window.electronAPI.onMenuEvent('menu:open',    () => handleOpen()),
      window.electronAPI.onMenuEvent('menu:save',    () => saveScore()),
      window.electronAPI.onMenuEvent('menu:saveAs',  () => saveScoreAs()),
      window.electronAPI.onMenuEvent('menu:undo',    () => undo()),
      window.electronAPI.onMenuEvent('menu:redo',    () => redo()),
      window.electronAPI.onMenuEvent('menu:zoomIn',  () => setZoom(zoom + 0.1)),
      window.electronAPI.onMenuEvent('menu:zoomOut', () => setZoom(zoom - 0.1)),
      window.electronAPI.onMenuEvent('menu:zoomFit', () => setZoom(1.0)),
      window.electronAPI.onMenuEvent('menu:exportMidi',      () => handleExportMidi()),
      window.electronAPI.onMenuEvent('menu:importMidi',      () => handleImportMidi()),
      window.electronAPI.onMenuEvent('menu:exportPdf',       () => handleExportPdf()),
      window.electronAPI.onMenuEvent('menu:exportMusicXml',  () => handleExportMusicXml()),
      window.electronAPI.onMenuEvent('menu:importMusicXml',  () => handleImportMusicXml()),
    ]
    return () => cleanups.forEach(cleanup => cleanup())
  }, [zoom])   // re-register when zoom changes so closure captures latest value

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (mod && e.key === 'z' &&  e.shiftKey) { e.preventDefault(); redo() }
      if (mod && e.key === 's' && !e.shiftKey) { e.preventDefault(); saveScore() }
      // Space toggles playback except in note/rest mode (where Space enters a rest)
      if (!mod && e.key === ' ' && inputMode !== 'note' && inputMode !== 'rest') {
        e.preventDefault()
        isPlaying ? stopPlayback() : startPlayback()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [inputMode, isPlaying, startPlayback, stopPlayback])

  async function handleOpen(): Promise<void> {
    const result = await window.electronAPI.openFile()
    if (!result) return
    try {
      const score = JSON.parse(result.content) as Score
      loadScore(score, result.path)
    } catch {
      console.error('Failed to parse score file')
    }
  }

  async function handleExportMidi(): Promise<void> {
    const score = useAppStore.getState().score
    const bytes = scoreToMidi(score)
    await window.electronAPI.exportMidi(bytes)
  }

  async function handleImportMidi(): Promise<void> {
    const result = await window.electronAPI.importMidi()
    if (!result) return
    try {
      const score = midiToScore(result.bytes)
      loadScore(score, result.path)
    } catch {
      console.error('Failed to import MIDI file')
    }
  }

  async function handleExportPdf(): Promise<void> {
    const score = useAppStore.getState().score
    const bytes = await exportScorePdf(score)
    await window.electronAPI.exportPdf(bytes)
  }

  async function handleExportMusicXml(): Promise<void> {
    const score = useAppStore.getState().score
    const xml = scoreToMusicXml(score)
    await window.electronAPI.exportMusicXml(xml)
  }

  async function handleImportMusicXml(): Promise<void> {
    const result = await window.electronAPI.importMusicXml()
    if (!result) return
    try {
      const score = musicxmlToScore(result.xml)
      loadScore(score, result.path)
    } catch {
      console.error('Failed to import MusicXML file')
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#1e1e1e',
      color: '#d4d4d4',
      overflow: 'hidden'
    }}>
      <Toolbar onTogglePartsPanel={() => setPartsPanelOpen(x => !x)} partsPanelOpen={partsPanelOpen} />

      {/* View tabs */}
      <div style={{ display: 'flex', background: '#252526', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {(Object.keys(TAB_LABELS) as AppView[]).map(view => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            style={{
              padding: '6px 18px',
              background: 'none',
              border: 'none',
              borderBottom: activeView === view ? '2px solid #0e639c' : '2px solid transparent',
              color: activeView === view ? '#d4d4d4' : '#666',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {TAB_LABELS[view]}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {activeView === 'score' && partsPanelOpen && <PartsPanel onClose={() => setPartsPanelOpen(false)} />}
        <main style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ padding: activeView === 'score' ? '24px' : '0' }}>
            {activeView === 'score'   ? <ScoreCanvas /> : <RoutingView />}
          </div>
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
