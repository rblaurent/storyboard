import type { HTMLAttributes, ReactNode } from 'react'
import { SiteIcon } from './icons'

type LiveFoldoutProps = Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'> & {
  module: 'players' | 'visuals' | 'music'
  label: string
  icon: 'players' | 'projector' | 'music'
  open: boolean
  panelExpanded: boolean
  toggle: () => void
  className: string
  status?: ReactNode
  children: ReactNode
}

export function LiveFoldout({ module, label, icon, open, panelExpanded, toggle, className, status, children, ...section }: LiveFoldoutProps) {
  const bodyId = `live-${module}-content`
  return <section {...section} className={`${className} live-foldout${open ? ' is-module-open' : ' is-module-closed'}`}>
    <button className="live-module-toggle" type="button" aria-expanded={open} aria-controls={bodyId} aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`} onClick={toggle}>
      <span className="live-module-label"><SiteIcon name={icon} /><span>{label.toUpperCase()}</span></span>
      {status}
      <SiteIcon name="chevron" className="live-module-chevron" />
    </button>
    <div id={bodyId} className="live-module-body" hidden={panelExpanded && !open}>{children}</div>
  </section>
}
