import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Toolbar } from './Toolbar'
import { ScoreCanvas } from './ScoreCanvas'
import { RoutingView } from './RoutingView'
import { StatusBar } from './StatusBar'
import { PartsPanel } from './PartsPanel'
import { SequenceEditor } from './SequenceEditor'
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
  const [sequencerPartId,    setSequencerPartId]    = useState<string | null>(null)
  const [sequencerPatternId, setSequencerPatternId] = useState<string | undefined>(undefined)

  // Prefetch Salamander Grand Piano samples in the background
  useEffect(() => { loadSampler() }, [])

  // ── Wire native menu events to store actions ────────────────────────────────
  useEffect(() => {
    const cleanups = [
      window.electronAPI.onMenuEvent('menu:new',     () => { if (!isPlaying) newScore() }),
      window.electronAPI.onMenuEvent('menu:open',    () => { if (!isPlaying) handleOpen() }),
      window.electronAPI.onMenuEvent('menu:save',    () => saveScore()),
      window.electronAPI.onMenuEvent('menu:saveAs',  () => saveScoreAs()),
      window.electronAPI.onMenuEvent('menu:undo',    () => { if (!isPlaying) undo() }),
      window.electronAPI.onMenuEvent('menu:redo',    () => { if (!isPlaying) redo() }),
      window.electronAPI.onMenuEvent('menu:zoomIn',  () => setZoom(zoom + 0.1)),
      window.electronAPI.onMenuEvent('menu:zoomOut', () => setZoom(zoom - 0.1)),
      window.electronAPI.onMenuEvent('menu:zoomFit', () => setZoom(1.0)),
      window.electronAPI.onMenuEvent('menu:exportMidi',      () => handleExportMidi()),
      window.electronAPI.onMenuEvent('menu:importMidi',      () => { if (!isPlaying) handleImportMidi() }),
      window.electronAPI.onMenuEvent('menu:exportPdf',       () => handleExportPdf()),
      window.electronAPI.onMenuEvent('menu:exportMusicXml',  () => handleExportMusicXml()),
      window.electronAPI.onMenuEvent('menu:importMusicXml',  () => { if (!isPlaying) handleImportMusicXml() }),
    ]
    return () => cleanups.forEach(cleanup => cleanup())
  }, [zoom, isPlaying])   // re-register when zoom or playback state changes

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); if (!isPlaying) undo() }
      if (mod && e.key === 'z' &&  e.shiftKey) { e.preventDefault(); if (!isPlaying) redo() }
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
        {activeView === 'score' && !sequencerPartId && partsPanelOpen && (
          <PartsPanel onClose={() => setPartsPanelOpen(false)} />
        )}
        {/* Sequence editor: shown when user drills into a sequencer-mode part bar */}
        {sequencerPartId && (
          <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <SequenceEditor
              partId={sequencerPartId}
              initialPatternId={sequencerPatternId}
              onBack={() => { setSequencerPartId(null); setSequencerPatternId(undefined) }}
            />
          </main>
        )}
        {/* Both score/routing views stay mounted — toggle via display to avoid expensive remount renders during playback */}
        <main style={{ flex: 1, overflow: 'auto', display: !sequencerPartId && activeView === 'score' ? 'block' : 'none' }}>
          <div style={{ padding: '24px' }}>
            <ScoreCanvas onOpenSequencer={(partId, patternId) => { setSequencerPartId(partId); setSequencerPatternId(patternId) }} />
          </div>
        </main>
        <main style={{ flex: 1, overflow: 'auto', display: !sequencerPartId && activeView === 'routing' ? 'block' : 'none' }}>
          <RoutingView />
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
