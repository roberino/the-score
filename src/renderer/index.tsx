import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './components/App'
import { loadNotationFonts } from './engine/fonts'
import './styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

loadNotationFonts().finally(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
