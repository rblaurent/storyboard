import { Management } from './admin/Management'
import { Settings } from './admin/Settings'
import './admin/admin.css'

// Component is the public contribution; Page supports the current Leaf route loader.
export const plugin = { id: 'storyboard', Component: Management, Page: Management, settingsPanel: { Component: Settings } }
export default plugin
