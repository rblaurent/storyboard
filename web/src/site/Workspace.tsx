import { useCallback, useEffect, useMemo, useState } from 'react'
import { WorkspaceExplorer, type WorkspaceCreateInput, type WorkspaceEntity, type WorkspaceEntityPage, type WorkspaceListInput, type WorkspaceSaveInput, type WorkspaceSnapshot, type WorkspaceTransport } from '@redbamboo/workspace'
import { api, explain, type Account } from './api'

export function CampaignWorkspace({ id, me }: { id: string; me: Account }) {
  const base = `/campaigns/${id}/workspace`
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try { setSnapshot(await api<WorkspaceSnapshot>(base)) }
    catch (cause) { setError(explain(cause)) }
    finally { setLoading(false) }
  }, [base])
  useEffect(() => { const controller = new AbortController(); setLoading(true); api<WorkspaceSnapshot>(base, '', 'GET', undefined, controller.signal).then(setSnapshot).catch(cause => { if (!controller.signal.aborted) setError(explain(cause)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) }); return () => controller.abort() }, [base])
  const transport = useMemo<WorkspaceTransport>(() => ({
    async list(input: WorkspaceListInput) { try { const query = new URLSearchParams({ types: input.typeSlugs.join(','), limit: String(input.limit || 50) }); if (input.query) query.set('query', input.query); if (input.cursor) query.set('cursor', input.cursor); return await api<WorkspaceEntityPage>(`${base}/entities?${query}`) } catch (cause) { throw new Error(explain(cause)) } },
    async save(entityId: string, input: WorkspaceSaveInput) { try { return await api<WorkspaceEntity>(`${base}/entities/${entityId}`, me.csrfToken, 'PUT', input) } catch (cause) { throw new Error(explain(cause)) } },
    async create(input: WorkspaceCreateInput) { try { return await api<WorkspaceEntity>(`${base}/entities`, me.csrfToken, 'POST', input) } catch (cause) { throw new Error(explain(cause)) } },
    async remove(entityId: string, expectedUpdatedAt: string) { try { await api(`${base}/entities/${entityId}/delete`, me.csrfToken, 'POST', { expectedUpdatedAt }) } catch (cause) { throw new Error(explain(cause)) } },
  }), [base, me.csrfToken])
  return <section className="workspace-page">
    <header className="campaign-page-header"><div><h2>Workspace</h2><p>The complete campaign database: worlds, characters, lore, jobs, and every custom record.</p></div></header>
    {error && <p className="error" role="alert"><span>{error}</span></p>}
    {loading ? <p role="status">Opening the campaign workspace…</p> : snapshot ? <WorkspaceExplorer snapshot={snapshot} transport={transport} onRefresh={load} /> : <button onClick={() => void load()}>Try again</button>}
  </section>
}
