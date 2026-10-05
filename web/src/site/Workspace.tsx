import { useCallback, useEffect, useMemo, useState } from 'react'
import { WorkspaceExplorer, type WorkspaceCreateInput, type WorkspaceEntity, type WorkspaceEntityPage, type WorkspaceListInput, type WorkspaceSaveInput, type WorkspaceSnapshot, type WorkspaceTransport } from '@redbamboo/workspace'
import { api, explain, type Account } from './api'
import { useLocale, workspaceFrench } from './i18n'

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
  return <section className="workspace-page">
    <header className="campaign-page-header"><div><h2>{t('Workspace')}</h2><p>{t('The complete campaign database: worlds, characters, lore, jobs, and every custom record.')}</p></div></header>
    {locale === 'fr' && <p className="quiet">Les traductions françaises sont affichées en lecture seule. Revenez à EN pour modifier la source canonique.</p>}
    {error && <p className="error" role="alert"><span>{error}</span></p>}
    {loading ? <p role="status">{t('Opening the campaign workspace…')}</p> : snapshot ? <WorkspaceExplorer snapshot={snapshot} transport={transport} onRefresh={load} locale={locale} messages={locale === 'fr' ? workspaceFrench : undefined} readOnly={locale === 'fr'} /> : <button onClick={() => void load()}>{t('Try again')}</button>}
  </section>
}
