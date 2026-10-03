// Loaded only by admin.fixture.html, outside the shipped module graph.
import { createRoot } from 'react-dom/client'
import { Management } from './Management'
import { Settings } from './Settings'
import './admin.css'
const theme = new URLSearchParams(location.search).get('theme')
document.documentElement.classList.toggle('dark', theme === 'dark')
document.body.style.cssText = 'margin:0;background:var(--background);color:var(--foreground);font-family:system-ui'
createRoot(document.getElementById('fixture-root')!).render(new URLSearchParams(location.search).get('surface') === 'settings' ? <div style={{ maxWidth: 1100, margin: '40px auto', padding: 24 }}><Settings /></div> : <Management />)
