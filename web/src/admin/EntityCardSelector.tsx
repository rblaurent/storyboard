import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EntityCard,
  Icon,
  Input,
  ScrollArea,
} from '@redbamboo/ui'
import { hostApi, managementMessage } from './api'

interface Entity {
  id: string
  typeSlug: string
  name: string
  slug: string
  data?: unknown
}

interface EntityPage { items: Entity[]; total: number }

function dataOf(entity: Entity): Record<string, unknown> {
  if (typeof entity.data === 'string') {
    try { return JSON.parse(entity.data) as Record<string, unknown> } catch { return {} }
  }
  return entity.data && typeof entity.data === 'object' ? entity.data as Record<string, unknown> : {}
}

function iconOf(entity: Entity) {
  const icon = dataOf(entity).icon
  if (typeof icon === 'string' && icon) return icon
  return entity.typeSlug === 'quality-tier' ? 'ph-bold ph-gauge' : 'ph-bold ph-flow-arrow'
}

function colorOf(entity: Entity) {
  const color = dataOf(entity).color
  return typeof color === 'string' && color ? color : 'var(--primary)'
}

function subtitleOf(entity: Entity) {
  const description = dataOf(entity).description
  return typeof description === 'string' && description ? description : entity.slug
}

function EntityOption({ entity, selected, onSelect }: { entity: Entity; selected: boolean; onSelect: () => void }) {
  return <EntityCard
    entity={entity}
    visual={{ icon: iconOf(entity), color: colorOf(entity) }}
    subtitle={subtitleOf(entity)}
    variant="row"
    selected={selected}
    action={{ kind: 'button', onActivate: onSelect, ariaLabel: `Select ${entity.name}` }}
    trailing={selected ? <Icon name="ph-bold ph-check" className="text-xs text-primary" aria-hidden="true" /> : undefined}
    className="box-border rounded-md [&_[data-slot=entity-card-primary]]:m-0 [&_[data-slot=entity-card-primary]]:appearance-none [&_[data-slot=entity-card-primary]]:border-0 [&_[data-slot=entity-card-primary]]:bg-transparent [&_[data-slot=entity-card-primary]]:p-0"
  />
}

export function EntityCardSelector({
  label,
  targetType,
  value,
  disabled,
  onChange,
}: {
  label: string
  targetType: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const [entities, setEntities] = useState<Entity[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoaded(false)
    setError('')
    hostApi<EntityPage>(`/api/entities?type=${encodeURIComponent(targetType)}&limit=500`, 'GET', undefined, controller.signal)
      .then(page => {
        if (controller.signal.aborted) return
        const sorted = [...page.items].sort((a, b) => {
          const ao = Number(dataOf(a).sort_order)
          const bo = Number(dataOf(b).sort_order)
          if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo
          return a.name.localeCompare(b.name)
        })
        setEntities(sorted)
        setLoaded(true)
      })
      .catch(cause => {
        if (!controller.signal.aborted) { setError(managementMessage(cause)); setLoaded(true) }
      })
    return () => controller.abort()
  }, [targetType])

  const selected = entities.find(entity => entity.id === value || entity.slug === value)
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query ? entities.filter(entity => `${entity.name} ${entity.slug}`.toLowerCase().includes(query)) : entities
  }, [entities, search])

  const placeholder: Entity = {
    id: value || `${targetType}-unselected`,
    typeSlug: targetType,
    name: value || (loaded ? 'No entity selected' : 'Loading selection…'),
    slug: value,
  }
  const shown = selected ?? placeholder

  return <>
    <div className="w-full min-w-0 sm:max-w-sm">
      <EntityCard
        entity={shown}
        visual={{ icon: selected ? iconOf(selected) : error ? 'ph-bold ph-warning' : 'ph-bold ph-link', color: selected ? colorOf(selected) : error ? 'var(--destructive)' : 'var(--primary)' }}
        subtitle={selected ? subtitleOf(selected) : error || (loaded && value ? 'Saved value does not match a current entity.' : targetType)}
        variant="outlined"
        disabled={disabled}
        action={disabled ? undefined : { kind: 'button', onActivate: () => setOpen(true), ariaLabel: `Change ${label}` }}
        trailing={!disabled ? <Icon name="ph-bold ph-caret-right" className="text-[10px] text-muted-foreground" aria-hidden="true" /> : undefined}
        className="box-border [&_[data-slot=entity-card-primary]]:m-0 [&_[data-slot=entity-card-primary]]:appearance-none [&_[data-slot=entity-card-primary]]:border-0 [&_[data-slot=entity-card-primary]]:bg-transparent [&_[data-slot=entity-card-primary]]:p-0"
      />
    </div>
    <Dialog open={open} onOpenChange={next => { setOpen(next); if (!next) setSearch('') }}>
      <DialogContent className="box-border">
        <DialogHeader>
          <DialogTitle>Select {label}</DialogTitle>
          <DialogDescription>Choose a {targetType.replaceAll('-', ' ')} entity.</DialogDescription>
        </DialogHeader>
        <Input className="box-border" aria-label={`Search ${label}`} placeholder="Search…" value={search} onChange={event => setSearch(event.target.value)} autoFocus />
        <ScrollArea className="max-h-[min(400px,55vh)] -mx-6 px-6">
          {!loaded ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
            : error ? <p role="alert" className="py-8 text-center text-sm text-destructive">{error}</p>
              : filtered.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{search ? 'No matches' : 'No entities found'}</p>
                : <div className="space-y-0.5">{filtered.map(entity => <EntityOption key={entity.id} entity={entity} selected={entity.id === selected?.id} onSelect={() => { onChange(entity.slug); setOpen(false); setSearch('') }} />)}</div>}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  </>
}
