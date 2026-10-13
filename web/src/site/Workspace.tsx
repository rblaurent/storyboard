import { useCallback, useEffect, useMemo, useState } from 'react'
import { WorkspaceExplorer, type WorkspaceCreateInput, type WorkspaceEntity, type WorkspaceEntityPage, type WorkspaceEntitySupplementProps, type WorkspaceField, type WorkspaceFieldRendererProps, type WorkspaceListInput, type WorkspaceSaveInput, type WorkspaceSnapshot, type WorkspaceTransport } from '@redbamboo/workspace'
import { api, explain, type Account } from './api'
import { useLocale, workspaceFrench } from './i18n'
import { ArtworkGenerator } from './ArtworkGenerator'

function imageField(field: WorkspaceField) {
  const constraints = typeof field.constraints === 'object' && field.constraints ? field.constraints as Record<string, unknown> : {}
  const hints = JSON.stringify(field.displayHints || '').toLowerCase()
  return ['asset', 'image'].includes(field.fieldType) || field.fieldType === 'entity_ref' && constraints.target_type === 'asset' || hints.includes('image') || ['string', 'text'].includes(field.fieldType) && ['image', 'image_url', 'portrait', 'avatar', 'cover', 'artwork'].includes(field.key)
}

function WorkspaceArtworkField({ campaignId, csrfToken, entity, field, value, set, disabled }: WorkspaceFieldRendererProps & { campaignId: string; csrfToken: string }) {
  const [preview, setPreview] = useState('')
  const hasImage = typeof value === 'string' && value.trim().length > 0
  const src = preview || (hasImage ? `/api/campaigns/${campaignId}/workspace/entities/${entity.id}/images/${encodeURIComponent(field.key)}` : '')
  return <div className="workspace-artwork-field">{src && <img src={src} alt={`${entity.name} ${field.name}`} />}<details><summary>{hasImage ? 'Create a replacement' : 'Create image'}</summary><ArtworkGenerator campaignId={campaignId} csrfToken={csrfToken} targetKind="entity" entityId={entity.id} field={field.key} disabled={disabled} onSelect={candidate => { set(candidate.assetId); setPreview(candidate.imageUrl) }} /></details>{hasImage && <button type="button" onClick={() => { set(''); setPreview('') }} disabled={disabled}>Remove image</button>}</div>
}

function PlayerViewEditor({ campaignId, csrfToken, entity, type, readOnly, saved }: WorkspaceEntitySupplementProps & { campaignId: string; csrfToken: string }) {
  const initial = entity.playerView || { prepared: false, title: entity.name, description: '', imageField: null, fieldKeys: [] }
  const [title, setTitle] = useState(initial.title || entity.name)
  const [description, setDescription] = useState(initial.description || '')
  const [image, setImage] = useState(initial.imageField || '')
  const [fields, setFields] = useState<string[]>(initial.fieldKeys || [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const available = (type?.fields || []).filter(field => field.key !== 'description')
  const images = available.filter(imageField)
  const selected = available.filter(field => fields.includes(field.key) && entity.data[field.key] != null && entity.data[field.key] !== '')
  async function save() {
    if (busy || readOnly || !title.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      const value = await api<WorkspaceEntity>(`/campaigns/${campaignId}/workspace/entities/${entity.id}/player-view`, csrfToken, 'PUT', { title: title.trim(), description, imageField: image || null, fieldKeys: fields, expectedUpdatedAt: entity.updatedAt, operationId: crypto.randomUUID() })
      await saved(value); setNotice('Player view saved.')
    } catch (cause) { setError(explain(cause)) }
    finally { setBusy(false) }
  }
  return <section className="workspace-player-view">
    <header><div><span className="eyebrow">PLAYER VIEW</span><h3>What players may see</h3></div><span className={`visual-identity-state${entity.playerView?.prepared ? '' : ' is-dirty'}`}>{entity.playerView?.prepared ? 'READY' : 'PRIVATE'}</span></header>
    <p>This is the safe presentation used whenever the entity is revealed. Canonical fields above remain private unless selected here.</p>
    <div className="workspace-player-view-grid">
      <div className="workspace-player-view-form">
        <label>Player-facing title<input maxLength={300} value={title} disabled={readOnly || busy} onChange={event => setTitle(event.target.value)} /></label>
        <label>Player-facing description<textarea rows={5} maxLength={20000} value={description} disabled={readOnly || busy} onChange={event => setDescription(event.target.value)} placeholder="Describe only what the players can safely know." /></label>
        {images.length > 0 && <label>Primary image<select value={image} disabled={readOnly || busy} onChange={event => setImage(event.target.value)}><option value="">No image</option>{images.map(field => <option key={field.key} value={field.key}>{field.name}</option>)}</select></label>}
        {available.length > 0 && <fieldset><legend>Visible fields</legend>{available.map(field => <label className="check" key={field.key}><input type="checkbox" checked={fields.includes(field.key)} disabled={readOnly || busy} onChange={() => setFields(value => value.includes(field.key) ? value.filter(key => key !== field.key) : [...value, field.key])} />{field.name}</label>)}</fieldset>}
        {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
        {!readOnly && <button className="primary" disabled={busy || !title.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save player view'}</button>}
      </div>
      <article className="workspace-player-preview"><span>{type?.name || entity.typeSlug}</span><h4>{title || entity.name}</h4>{description && <p>{description}</p>}{selected.length > 0 && <dl>{selected.map(field => <div key={field.key}><dt>{field.name}</dt><dd>{renderValue(entity.data[field.key])}</dd></div>)}</dl>}</article>
    </div>
  </section>
}

function renderValue(value: unknown) { if (Array.isArray(value)) return value.map(String).join(' · '); if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).filter(item => typeof item === 'string' || typeof item === 'number').slice(0, 4).join(' · '); return String(value ?? '') }

export function CampaignWorkspace({ id, me }: { id: string; me: Account }) {
  const { locale, t } = useLocale()
  const base = `/campaigns/${id}/workspace`
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try { setSnapshot(await api<WorkspaceSnapshot>(`${base}?locale=${locale}`)) }
    catch (cause) { setError(explain(cause)) }
    finally { setLoading(false) }
  }, [base, locale])
  useEffect(() => { const controller = new AbortController(); setLoading(true); api<WorkspaceSnapshot>(`${base}?locale=${locale}`, '', 'GET', undefined, controller.signal).then(setSnapshot).catch(cause => { if (!controller.signal.aborted) setError(explain(cause)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) }); return () => controller.abort() }, [base, locale])
  const transport = useMemo<WorkspaceTransport>(() => ({
    async list(input: WorkspaceListInput) { try { const query = new URLSearchParams({ types: input.typeSlugs.join(','), limit: String(input.limit || 50), locale }); if (input.query) query.set('query', input.query); if (input.cursor) query.set('cursor', input.cursor); return await api<WorkspaceEntityPage>(`${base}/entities?${query}`) } catch (cause) { throw new Error(explain(cause)) } },
    async save(entityId: string, input: WorkspaceSaveInput) { try { return await api<WorkspaceEntity>(`${base}/entities/${entityId}`, me.csrfToken, 'PUT', input) } catch (cause) { throw new Error(explain(cause)) } },
    async create(input: WorkspaceCreateInput) { try { return await api<WorkspaceEntity>(`${base}/entities`, me.csrfToken, 'POST', input) } catch (cause) { throw new Error(explain(cause)) } },
    async remove(entityId: string, expectedUpdatedAt: string) { try { await api(`${base}/entities/${entityId}/delete`, me.csrfToken, 'POST', { expectedUpdatedAt }) } catch (cause) { throw new Error(explain(cause)) } },
  }), [base, me.csrfToken, locale])
  const renderField = useCallback((props: WorkspaceFieldRendererProps) => imageField(props.field) ? <WorkspaceArtworkField {...props} campaignId={id} csrfToken={me.csrfToken} /> : undefined, [id, me.csrfToken])
  const renderEntitySupplement = useCallback((props: WorkspaceEntitySupplementProps) => <PlayerViewEditor {...props} campaignId={id} csrfToken={me.csrfToken} />, [id, me.csrfToken])
  return <section className="workspace-page">
    <header className="campaign-page-header"><div><h2>{t('Workspace')}</h2><p>{t('The complete campaign database: worlds, characters, lore, jobs, and every custom record.')}</p></div></header>
    {locale === 'fr' && <p className="quiet">Les traductions françaises sont affichées en lecture seule. Revenez à EN pour modifier la source canonique.</p>}
    {error && <p className="error" role="alert"><span>{error}</span></p>}
    {loading ? <p role="status">{t('Opening the campaign workspace…')}</p> : snapshot ? <WorkspaceExplorer snapshot={snapshot} transport={transport} onRefresh={load} locale={locale} messages={locale === 'fr' ? workspaceFrench : undefined} readOnly={locale === 'fr'} renderField={locale === 'fr' ? undefined : renderField} renderEntitySupplement={locale === 'fr' ? undefined : renderEntitySupplement} /> : <button onClick={() => void load()}>{t('Try again')}</button>}
  </section>
}
