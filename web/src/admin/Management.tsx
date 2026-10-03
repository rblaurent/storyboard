import { useEffect, useState } from 'react'
import { Badge, Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction, Icon, Tabs, TabsList, TabsTrigger, TabsContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Switch } from '@redbamboo/ui'
import { management, ManagementError, managementMessage } from './api'

interface Status { publicUrl: string; googleConfigured: boolean; workspace: string; version: string }
interface Account { id: string; name: string; email: string; enabled: boolean; canCreate: boolean }
interface Campaign { id: string; name: string; state: string; archived: boolean; workspace: string }
interface Operation { id: string; kind: string; state: string; error: string; applied: boolean }
interface Audit { id: number; createdAt: string; data: { action?: string; actor?: string; target?: string; outcome?: string } }
type Data = { status: Status; accounts: Account[]; campaigns: Campaign[]; operations: Operation[]; audit: Audit[] }
function EmptyState({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return <div className="storyboard-empty"><Icon name={icon} aria-hidden="true" /><h3>{title}</h3><p>{children}</p></div>
}
function SettingsButton() {
  return <Button onClick={() => window.dispatchEvent(new CustomEvent('open-settings', { detail: { section: 'storyboard' } }))}><Icon name="ph-bold ph-sliders-horizontal" aria-hidden="true" />Configure Storyboard</Button>
}
function SectionCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle><h2>{title}</h2></CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>
}
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
  const ready = !!data?.status.publicUrl && !!data?.status.googleConfigured
  return <div className="storyboard-admin" data-ui-surface="storyboard-management" aria-busy={busy}>
    <div className="storyboard-admin-inner">
      <header className="storyboard-admin-heading">
        <div className="storyboard-admin-title"><span className="storyboard-admin-mark"><Icon name="ph-bold ph-film-strip" aria-hidden="true" /></span><div><h1>Storyboard</h1><p>Manage your service and the tables it brings together.</p></div></div>
        <div className="storyboard-admin-heading-actions">
          {data?.status.publicUrl && <Button nativeButton={false} render={<a href={data.status.publicUrl} target="_blank" rel="noreferrer" />}><Icon name="ph-bold ph-arrow-square-out" aria-hidden="true" />Open Storyboard</Button>}
          <Button variant="outline" disabled={busy} onClick={() => setVersion(v => v + 1)}><Icon name="ph-bold ph-arrow-clockwise" aria-hidden="true" />Refresh</Button>
        </div>
      </header>
      {error && <div role="alert" className="storyboard-admin-error"><Icon name="ph-bold ph-warning-circle" aria-hidden="true" /><span>{error}</span></div>}
      {prepare && <SectionCard title="Prepare installation" description="Create the private workspace before configuring access.">
        <p className="storyboard-admin-help">A Leaf administrator can prepare Storyboard. An existing installation remains restricted to its owner.</p>
        {agents.length > 0 && <label className="storyboard-agent-field">Owning Agent<select aria-label="Owning Agent" value={ownerAgentId} onChange={e => setOwnerAgentId(e.target.value)}><option value="">Select an Agent</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        <Button disabled={busy || (agents.length > 0 && !ownerAgentId)} onClick={() => void perform(() => management('/provision', 'POST', ownerAgentId ? { ownerAgentId } : {}))}>Prepare Storyboard</Button>
      </SectionCard>}
      {!data && !error && <Card><CardContent><p role="status" className="storyboard-admin-help">Loading Storyboard…</p></CardContent></Card>}
      {data && <Tabs defaultValue="overview" className="storyboard-admin-tabs">
        <TabsList variant="settings" aria-label="Storyboard administration">
          <TabsTrigger value="overview"><Icon name="ph-bold ph-squares-four" aria-hidden="true" />Overview</TabsTrigger>
          <TabsTrigger value="accounts"><Icon name="ph-bold ph-users" aria-hidden="true" />Accounts<Badge variant="secondary">{data.accounts.length}</Badge></TabsTrigger>
          <TabsTrigger value="campaigns"><Icon name="ph-bold ph-books" aria-hidden="true" />Campaigns<Badge variant="secondary">{data.campaigns.length}</Badge></TabsTrigger>
          <TabsTrigger value="activity"><Icon name="ph-bold ph-pulse" aria-hidden="true" />Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="storyboard-overview">
            <Card className="storyboard-setup-card">
              <CardHeader><CardTitle><h2>{ready ? 'Your service is configured' : 'Finish setting up Storyboard'}</h2></CardTitle><CardDescription>{ready ? 'Website and Google credentials are configured. Open the portal to check sign-in.' : 'Configure the public website and Google sign-in so your players can connect.'}</CardDescription><CardAction><Badge variant="secondary"><Icon name={ready ? 'ph-bold ph-check-circle' : 'ph-bold ph-wrench'} aria-hidden="true" />{ready ? 'Configured' : 'Setup required'}</Badge></CardAction></CardHeader>
              <CardContent>
                <ul className="storyboard-checklist">
                  <li><Icon name={data.status.publicUrl ? 'ph-bold ph-check-circle' : 'ph-bold ph-circle'} aria-hidden="true" /><div><strong>Public website</strong><p>{data.status.publicUrl || 'Choose the address your table will use.'}</p></div><Badge variant="secondary">{data.status.publicUrl ? 'Configured' : 'Not configured'}</Badge></li>
                  <li><Icon name={data.status.googleConfigured ? 'ph-bold ph-check-circle' : 'ph-bold ph-circle'} aria-hidden="true" /><div><strong>Google sign-in</strong><p>{data.status.googleConfigured ? 'Google credentials are stored.' : 'Add your OAuth client in extension settings.'}</p></div><Badge variant="secondary">{data.status.googleConfigured ? 'Configured' : 'Not configured'}</Badge></li>
                </ul>
                <div className="storyboard-setup-actions"><SettingsButton />{data.status.publicUrl && <Button variant="outline" nativeButton={false} render={<a href={data.status.publicUrl} target="_blank" rel="noreferrer" />}><Icon name="ph-bold ph-arrow-square-out" aria-hidden="true" />Open website</Button>}</div>
              </CardContent>
            </Card>
            <SectionCard title="Installation" description="This Storyboard instance in Leaf.">
              <dl className="storyboard-installation"><div><dt>Version</dt><dd><Badge variant="outline">{data.status.version}</Badge></dd></div><div><dt>Workspace</dt><dd><a href={`/database/entities/page/${data.status.workspace}`}>Inspect workspace<Icon name="ph-bold ph-arrow-up-right" aria-hidden="true" /></a></dd></div></dl>
              <p className="storyboard-admin-help">Campaigns and player accounts live in Leaf. Game Masters use the website to run their campaigns.</p>
            </SectionCard>
          </div>
        </TabsContent>
        <TabsContent value="accounts">
          <SectionCard title="Accounts" description="Google accounts and permission to create campaigns.">
            {data.accounts.length ? <Table><TableHeader><TableRow><TableHead>Account</TableHead><TableHead>State</TableHead><TableHead>Can create campaigns</TableHead></TableRow></TableHeader><TableBody>{data.accounts.map(a => <TableRow key={a.id}><TableCell data-label="Account"><a href={`/database/entities/storyboard-account/${a.id}`}>{a.name}</a><p className="storyboard-admin-help">{a.email}</p></TableCell><TableCell data-label="State"><Badge variant={a.enabled ? 'secondary' : 'outline'}>{a.enabled ? 'Enabled' : 'Disabled'}</Badge></TableCell><TableCell data-label="Create campaigns"><Switch aria-label={`Allow ${a.name} to create campaigns`} checked={a.canCreate} disabled={busy} onCheckedChange={canCreate => void perform(() => management(`/manage/accounts/${a.id}/eligibility`, 'PUT', { canCreate }))} /></TableCell></TableRow>)}</TableBody></Table> : <EmptyState icon="ph-bold ph-users" title="No accounts yet">Accounts appear when people first sign in with Google. Configure sign-in in extension settings to get started.</EmptyState>}
          </SectionCard>
        </TabsContent>
        <TabsContent value="campaigns">
          <SectionCard title="Campaigns" description="Inspect campaign records and their Leaf workspaces.">
            {data.campaigns.length ? <Table><TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>State</TableHead><TableHead>Workspace</TableHead></TableRow></TableHeader><TableBody>{data.campaigns.map(c => <TableRow key={c.id}><TableCell data-label="Campaign"><a href={`/database/entities/storyboard-campaign/${c.id}`}>{c.name}</a></TableCell><TableCell data-label="State"><Badge variant="secondary">{c.archived ? 'Archived' : c.state}</Badge></TableCell><TableCell data-label="Workspace"><a href={`/database/entities/page/${c.workspace}`}>Inspect workspace</a></TableCell></TableRow>)}</TableBody></Table> : <EmptyState icon="ph-bold ph-books" title="No campaigns yet">Game Masters create campaigns on the Storyboard website. They will appear here for administration.</EmptyState>}
          </SectionCard>
        </TabsContent>
        <TabsContent value="activity">
          <div className="storyboard-activity">
            <SectionCard title="Generation operations" description="Artwork and summary requests, with their current state.">
              {data.operations.length ? <Table><TableHeader><TableRow><TableHead>Operation</TableHead><TableHead>State</TableHead><TableHead>Outcome</TableHead></TableRow></TableHeader><TableBody>{data.operations.map(o => <TableRow key={o.id}><TableCell data-label="Operation"><a href={`/database/entities/storyboard-generation/${o.id}`}>{o.kind} · {o.id}</a></TableCell><TableCell data-label="State"><Badge variant="secondary">{o.state}</Badge></TableCell><TableCell data-label="Outcome">{o.error || (o.state === 'completed' ? o.applied ? 'Applied' : 'Newer changes retained' : 'In progress')}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState icon="ph-bold ph-sparkle" title="No generation requests yet">Artwork and summary requests appear here when a Game Master generates them.</EmptyState>}
            </SectionCard>
            <SectionCard title="Recent audit activity" description="Recorded changes to Storyboard accounts and campaigns.">
              {data.audit.length ? <Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Target</TableHead><TableHead>Outcome</TableHead></TableRow></TableHeader><TableBody>{data.audit.map(a => <TableRow key={a.id}><TableCell data-label="Time">{a.createdAt}</TableCell><TableCell data-label="Action">{a.data.action || '—'}</TableCell><TableCell data-label="Actor">{a.data.actor || '—'}</TableCell><TableCell data-label="Target">{a.data.target || '—'}</TableCell><TableCell data-label="Outcome">{a.data.outcome || 'Not supplied'}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState icon="ph-bold ph-clock-counter-clockwise" title="No recorded activity yet">Administrative changes will appear here as they happen.</EmptyState>}
            </SectionCard>
          </div>
        </TabsContent>
      </Tabs>}
    </div>
  </div>
}
