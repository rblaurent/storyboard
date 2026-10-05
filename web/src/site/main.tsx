import { createRoot } from 'react-dom/client'
import { App } from './App'
import { LocaleProvider } from './i18n'
import './site.css'
import '@redbamboo/workspace/workspace.css'
createRoot(document.getElementById('root')!).render(<LocaleProvider><App /></LocaleProvider>)
