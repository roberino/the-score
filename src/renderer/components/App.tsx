import { useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { Toolbar } from './Toolbar'
import { ScoreCanvas } from './ScoreCanvas'
import { StatusBar } from './StatusBar'
import type { Score } from '@shared/score'

export function App(): JSX.Element {
  const { undo, redo, newScore, loadScore, saveScore, saveScoreAs, setZoom, zoom } = useAppStore()

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
      window.electronAPI.onMenuEvent('menu:zoomFit', () => setZoom(1.0))
    ]
    return () => cleanups.forEach(cleanup => cleanup())
  }, [zoom])   // re-register when zoom changes so closure captures latest value

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (mod && e.key === 'z' &&  e.shiftKey) { e.preventDefault(); redo() }
      if (mod && e.key === 's' && !e.shiftKey) { e.preventDefault(); saveScore() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

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

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#1e1e1e',
      color: '#d4d4d4',
      overflow: 'hidden'
    }}>
      <Toolbar />
      <main style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        <ScoreCanvas />
      </main>
      <StatusBar />
    </div>
  )
}
