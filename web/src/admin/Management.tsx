import { useEffect, useState } from 'react'
import { Badge, Button, SectionHeader, SettingRow, Switch } from '@redbamboo/ui'
import { management, ManagementError, managementMessage } from './api'

interface Status { publicUrl: string; googleConfigured: boolean; workspace: string; version: string }
interface Account { id: string; name: string; email: string; enabled: boolean; canCreate: boolean }
interface Campaign { id: string; name: string; state: string; archived: boolean; workspace: string }
interface Operation { id: string; kind: string; state: string; error: string; applied: boolean }
interface Audit { id: number; createdAt: string; data: { action?: string; actor?: string; target?: string; outcome?: string } }
type Data = { status: Status; accounts: Account[]; campaigns: Campaign[]; operations: Operation[]; audit: Audit[] }
export function Management() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [prepare, setPrepare] = useState(false)
  const [busy, setBusy] = useState(false)
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [ownerAgentId, setOwnerAgentId] = useState('')
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError('')
    async function load() {
      try {
        const status = await management<Status>('/manage/status', 'GET', undefined, controller.signal)
        const [accounts, campaigns, operations, audit] = await Promise.all([
          management<Account[]>('/manage/accounts', 'GET', undefined, controller.signal), management<Campaign[]>('/manage/campaigns', 'GET', undefined, controller.signal), management<Operation[]>('/manage/operations', 'GET', undefined, controller.signal), management<Audit[]>('/manage/audit', 'GET', undefined, controller.signal),
        ])
        if (!controller.signal.aborted) { setData({ status, accounts, campaigns, operations, audit }); setPrepare(false) }
      } catch (c) { if (!controller.signal.aborted) { setData(null); setError(managementMessage(c)); setPrepare(c instanceof ManagementError && ['storyboard_not_configured', 'extension_owner_required'].includes(c.code)) } }
      finally { if (!controller.signal.aborted) setBusy(false) }
    }
    void load(); return () => controller.abort()
  }, [version])
  async function perform(action: () => Promise<unknown>) { setBusy(true); setError(''); try { await action(); setVersion(v => v + 1) } catch (c) { setError(managementMessage(c)); if (c instanceof ManagementError && c.code === 'owning_agent_required') { try { setAgents(await management<{ id: string; name: string }[]>('/provision/agents')) } catch (cause) { setError(managementMessage(cause)) } } setBusy(false) } }
  return <div className="storyboard-admin p-6 text-foreground space-y-6" data-ui-surface="storyboard-management" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Storyboard</h1><p className="text-sm text-muted-foreground">Service readiness, accounts, campaigns and activity.</p></div><Button variant="outline" disabled={busy} onClick={() => setVersion(v => v + 1)}>Refresh</Button></div>
    {error && <div role="alert" className="rounded-lg border border-destructive/25 p-4 text-sm text-destructive">{error}</div>}
    {prepare && <section className="space-y-3"><SectionHeader>Prepare installation</SectionHeader><p className="text-sm text-muted-foreground">A Leaf administrator can create the private Storyboard workspace and configuration. An existing installation remains restricted to its owner.</p>{agents.length > 0 && <label className="flex flex-wrap items-center gap-3 text-sm">Owning Agent<select aria-label="Owning Agent" className="min-h-11 rounded-md border border-border bg-background px-3 text-foreground focus-visible:outline-2 focus-visible:outline-ring" value={ownerAgentId} onChange={e => setOwnerAgentId(e.target.value)}><option value="">Select an Agent</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}<Button disabled={busy || (agents.length > 0 && !ownerAgentId)} onClick={() => void perform(() => management('/provision', 'POST', ownerAgentId ? { ownerAgentId } : {}))}>Prepare Storyboard</Button></section>}
    {data && <>
      <section><SectionHeader>Service</SectionHeader><SettingRow label="Public website"><span>{data.status.publicUrl || 'Not configured'}</span></SettingRow><SettingRow label="Google sign-in"><Badge variant="secondary">{data.status.googleConfigured ? 'Configured' : 'Needs configuration'}</Badge></SettingRow><SettingRow label="Version"><span>{data.status.version}</span></SettingRow><SettingRow label="Workspace"><a className="underline" href={`/database/entities/page/${data.status.workspace}`}>Inspect workspace</a></SettingRow><p className="text-sm text-muted-foreground">Configure the public website and protected credentials in Settings → Extensions → Storyboard.</p></section>
      <section><SectionHeader>Accounts</SectionHeader><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th scope="col">Account</th><th scope="col">State</th><th scope="col">Can create campaigns</th></tr></thead><tbody>{data.accounts.map(a => <tr key={a.id}><td><a className="underline" href={`/database/entities/storyboard-account/${a.id}`}>{a.name}</a><div className="text-muted-foreground">{a.email}</div></td><td>{a.enabled ? 'Enabled' : 'Disabled'}</td><td><Switch aria-label={`Allow ${a.name} to create campaigns`} checked={a.canCreate} disabled={busy} onCheckedChange={canCreate => void perform(() => management(`/manage/accounts/${a.id}/eligibility`, 'PUT', { canCreate }))} /></td></tr>)}</tbody></table></div>{!data.accounts.length && <p className="text-sm text-muted-foreground">No accounts have signed in yet.</p>}</section>
      <section><SectionHeader>Campaigns</SectionHeader><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th scope="col">Campaign</th><th scope="col">State</th><th scope="col">Workspace</th></tr></thead><tbody>{data.campaigns.map(c => <tr key={c.id}><td><a className="underline" href={`/database/entities/storyboard-campaign/${c.id}`}>{c.name}</a></td><td>{c.archived ? 'Archived' : c.state}</td><td><a className="underline" href={`/database/entities/page/${c.workspace}`}>Inspect workspace</a></td></tr>)}</tbody></table></div>{!data.campaigns.length && <p className="text-sm text-muted-foreground">No campaigns yet.</p>}</section>
      <section><SectionHeader>Generation operations</SectionHeader><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th scope="col">Operation</th><th scope="col">State</th><th scope="col">Outcome</th></tr></thead><tbody>{data.operations.map(o => <tr key={o.id}><td><a className="underline" href={`/database/entities/storyboard-generation/${o.id}`}>{o.kind} · {o.id}</a></td><td>{o.state}</td><td>{o.error || (o.state === 'completed' ? o.applied ? 'Applied' : 'Newer changes retained' : 'In progress')}</td></tr>)}</tbody></table></div>{!data.operations.length && <p className="text-sm text-muted-foreground">No generation requests yet.</p>}</section>
      <section><SectionHeader>Recent audit activity</SectionHeader><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Actor</th><th scope="col">Target</th><th scope="col">Outcome</th></tr></thead><tbody>{data.audit.map(a => <tr key={a.id}><td>{a.createdAt}</td><td>{a.data.action || '—'}</td><td>{a.data.actor || '—'}</td><td>{a.data.target || '—'}</td><td>{a.data.outcome || 'Not supplied'}</td></tr>)}</tbody></table></div>{!data.audit.length && <p className="text-sm text-muted-foreground">No recorded activity yet.</p>}</section>
    </>}
  </div>
}
