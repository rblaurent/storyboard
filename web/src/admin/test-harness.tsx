// Loaded only by admin.fixture.html, outside the shipped module graph.
import { createRoot } from 'react-dom/client'
import { Management } from './Management'
import { Settings } from './Settings'
import './admin.css'
const theme = new URLSearchParams(location.search).get('theme')
document.documentElement.classList.toggle('dark', theme === 'dark')
document.documentElement.style.height = '100%'
document.body.style.cssText = 'height:100%;margin:0;overflow:hidden;background:var(--background);color:var(--foreground);font-family:system-ui'
document.getElementById('fixture-root')!.style.height = '100%'
createRoot(document.getElementById('fixture-root')!).render(new URLSearchParams(location.search).get('surface') === 'settings' ? <div style={{ maxWidth: 1100, margin: '40px auto', padding: 24 }}><Settings /></div> : <Management />)
