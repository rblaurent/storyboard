import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { SiteIcon } from './icons'
import { api, ApiError, explain, imageSource, type Account, type Campaign, type MusicBrief, type MusicGeneration, type MusicPage, type MusicPlaylist, type MusicQueueItem, type MusicStatus, type MusicTrack, type Operation, type Person, type Player } from './api'

function Avatar({ person }: { person: Person }) {
  const src = imageSource(person.avatar)
  return src ? <img className="avatar" src={src} alt="" referrerPolicy="no-referrer" /> : <span className="avatar initials" aria-hidden="true">{person.name.slice(0, 1)}</span>
}
function Feedback({ tone, children }: { tone: 'error' | 'notice'; children: React.ReactNode }) {
  return <p className={tone} role={tone === 'error' ? 'alert' : 'status'}><SiteIcon name={tone === 'error' ? 'warning' : 'check'} /><span>{children}</span></p>
}
function ErrorMessage({ error }: { error: string }) { return error ? <Feedback tone="error">{error}</Feedback> : null }
function CampaignPageHeader({ title, description, aside }: { title: string; description: string; aside?: React.ReactNode }) {
  return <header className="campaign-page-header"><div><h2>{title}</h2><p>{description}</p></div>{aside && <div className="campaign-page-header-aside">{aside}</div>}</header>
}
function Artwork({ campaign }: { campaign: Campaign }) {
  const src = imageSource(campaign.image)
  const [loaded, setLoaded] = useState<{ source: string; url: string } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!src?.startsWith('/api/')) return
    const controller = new AbortController(); setError('')
    // A stable image URL can stay in the browser's decoded-image cache even with no-store.
    // Explicitly re-read only authorized product media and retain the previous image until ready.
    void fetch(src, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.status === 401) window.dispatchEvent(new Event('storyboard:signout'))
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) throw new Error('media_unavailable')
      const content = await response.blob()
      if (!controller.signal.aborted) setLoaded({ source: src, url: URL.createObjectURL(content) })
    }).catch(() => { if (!controller.signal.aborted) setError('Artwork could not be loaded. Your previous image is kept. Reopen the campaign to try again.') })
    return () => controller.abort()
  }, [src, campaign.revision])
  useEffect(() => { return () => { if (loaded) URL.revokeObjectURL(loaded.url) } }, [loaded])
  const visible = src?.startsWith('/api/') ? loaded?.source === src ? loaded.url : undefined : src
  return <div><div className="artwork">{visible ? <img src={visible} alt={`${campaign.name} artwork`} /> : <div className="artwork-empty"><SiteIcon name="image" size={32} className="frame-mark" /><span>{src && !error ? 'Loading artwork…' : 'A story taking shape'}</span></div>}</div>{error && <p className="quiet" role="status">{error}</p>}</div>
}
function roleName(role: string) { return role === 'gm' ? 'Game Master' : 'Player' }
function Link({ href, navigate, children, ...props }: { href: string; navigate: (p: string) => void; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href={href} onClick={e => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.button === 0) { e.preventDefault(); navigate(href) } }}>{children}</a>
}
function Menu({ className, label, trigger, children }: { className: string; label: string; trigger: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('.menu-trigger')?.focus() } }
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key) }
  }, [open])
  return <div className={`${className}${open ? ' is-open' : ''}`} ref={root}><button type="button" className="menu-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>{trigger}</button>{open && <div className="menu-popover" role="menu" onClick={event => { if ((event.target as HTMLElement).closest('button,a')) setOpen(false) }}>{children}</div>}</div>
}
function AccountMenu({ me, signingOut, signout }: { me: Account; signingOut: boolean; signout: () => Promise<void> }) {
  return <Menu className="account-menu" label={`Account menu for ${me.name}`} trigger={<SiteIcon name="menu" size={24} weight="bold" />}><div className="menu-account"><Avatar person={me} /><div><strong>{me.name}</strong><span>Storyboard account</span></div></div><button className="menu-row" role="menuitem" onClick={() => void signout()} disabled={signingOut}><SiteIcon name={signingOut ? 'busy' : 'signout'} className={signingOut ? 'is-spinning' : undefined} />{signingOut ? 'Signing out…' : 'Sign out'}</button></Menu>
}
function RolePicker({ value, disabled, label, onChange }: { value: 'gm' | 'player'; disabled?: boolean; label: string; onChange: (value: 'gm' | 'player') => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('.select-trigger')?.focus() } }
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key) }
  }, [open])
  return <div className={`role-picker${open ? ' is-open' : ''}`} ref={root}><button type="button" className="select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(v => !v)}><span>{roleName(value)}</span><SiteIcon name="chevron" size={16} className="menu-chevron" /></button>{open && <div className="select-popover" role="listbox" aria-label={label}>{(['player', 'gm'] as const).map(option => <button type="button" role="option" aria-selected={option === value} key={option} onClick={() => { setOpen(false); if (option !== value) onChange(option) }}>{roleName(option)}{option === value && <SiteIcon name="check" size={16} />}</button>)}</div>}</div>
}
export function App() {
  const [me, setMe] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [path, setPath] = useState(window.location.pathname)
  const [signingOut, setSigningOut] = useState(false)
  const [playerCampaignId, setPlayerCampaignId] = useState('')
  const navigate = useCallback((next: string) => { history.pushState(null, '', next); setPath(next); window.scrollTo(0, 0) }, [])
  useEffect(() => {
    const pop = () => setPath(window.location.pathname)
    const logout = () => { setMe(null); setError('Your session expired. Sign in to continue.') }
    window.addEventListener('popstate', pop); window.addEventListener('storyboard:signout', logout)
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('storyboard:signout', logout) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    api<Account>('/me', '', 'GET', undefined, controller.signal).then(setMe).catch(c => { if (!controller.signal.aborted && !(c instanceof ApiError && c.status === 401)) setError(explain(c)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])
  async function signout() {
    setSigningOut(true); setError('')
    try {
      await api('/logout', me!.csrfToken, 'POST', {})
      // Operation receipts are only resume hints. Clear this browser's hints on sign-out.
      for (const k of Object.keys(sessionStorage)) if (k.startsWith(`storyboard:operation:${me!.id}:`) || k.startsWith(`storyboard:music-generation:${me!.id}:`)) sessionStorage.removeItem(k)
      setMe(null); navigate('/')
    } catch (c) { setError(explain(c)) } finally { setSigningOut(false) }
  }
  const match = /^\/campaigns\/([0-9a-f-]{36})\/(description|players|music)$/i.exec(path)
  useEffect(() => { if (match?.[1]) setPlayerCampaignId(match[1]) }, [match?.[1]])
  const campaignDashboard = !!(me && !loading && match)
  return <div className={`storyboard-site${campaignDashboard ? ' campaign-dashboard-site' : ''}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    {!campaignDashboard && <header className="masthead"><Link href="/" navigate={navigate} className="wordmark"><SiteIcon name="notebook" size={32} className="brand-mark" /> Storyboard<span className="wordmark-caption">THE CAMPAIGN NOTEBOOK</span></Link>
      {me && <AccountMenu me={me} signingOut={signingOut} signout={signout} />}
    </header>}
    <main id="main" className={campaignDashboard ? 'campaign-main' : undefined} tabIndex={-1}>
      {error && <ErrorMessage error={error} />}
      {loading ? <div className="loading" role="status"><SiteIcon name="busy" className="is-spinning" />Opening your notebook…</div> : !me ? <section className="signin"><span className="eyebrow">YOUR NEXT CHAPTER</span><h1>Every great story<br />starts at the table.</h1><p>A place for your campaigns, the people in them,<br className="desktop-break" /> and the worlds you bring to life together.</p><a className="button primary" href="/auth/google"><SiteIcon name="google" />Sign in with Google <SiteIcon name="out" /></a><p className="quiet">Use the Google account you share with your Game Master.</p></section> : path === '/' ? <Picker me={me} navigate={navigate} /> : match ? <CampaignView key={match[1]} id={match[1]} tab={match[2]} me={me} navigate={navigate} signingOut={signingOut} signout={signout} /> : <section className="empty"><h1>Page unavailable</h1><Link href="/" navigate={navigate}>Back to campaigns</Link></section>}
    </main>
    {me && playerCampaignId && <PlayerDock campaignId={playerCampaignId} csrfToken={me.csrfToken} navigate={navigate} />}
    <footer><span>Storyboard</span><span>A place for stories shared.</span></footer>
  </div>
}

function Picker({ me, navigate }: { me: Account; navigate: (p: string) => void }) {
  const [archived, setArchived] = useState(() => { try { return localStorage.getItem('storyboard:show-archived') === 'true' } catch { return false } })
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const creation = useRef<{ name: string; operationId: string } | null>(null)
  const createLock = useRef(false)
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('')
    api<Campaign[]>('/campaigns' + (archived ? '?archived=true' : ''), '', 'GET', undefined, controller.signal).then(setCampaigns).catch(c => { if (!controller.signal.aborted) setError(explain(c)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [archived, reload])
  async function create(e: FormEvent) {
    e.preventDefault(); if (createLock.current || !me.canCreate) return
    createLock.current = true; setBusy(true); setError('')
    const command = creation.current ?? { name: name.trim(), operationId: crypto.randomUUID() }; creation.current = command
    try { const campaign = await api<Campaign>('/campaigns', me.csrfToken, 'POST', command); navigate(`/campaigns/${campaign.id}/description`) }
    catch (c) { setError(explain(c)); if (c instanceof ApiError && c.status >= 400 && c.status < 500) creation.current = null }
    finally { createLock.current = false; setBusy(false) }
  }
  return <section>
    <div className="page-heading"><div><span className="eyebrow">THE STORIES WE SHARE</span><h1>Your campaigns<span className="title-stop">.</span></h1><p>Pick up where the table left off.</p></div><button className="primary" disabled={!me.canCreate} onClick={() => setCreating(v => !v)}><SiteIcon name="plus" />Create campaign</button></div>
    {!me.canCreate && <p className="quiet">Your Game Master can add you to a campaign. An administrator can enable campaign creation.</p>}
    <div className="picker-rule"><span>{loading ? 'Loading campaigns…' : `${campaigns.length} ${campaigns.length === 1 ? 'campaign' : 'campaigns'}`}</span><label className="check"><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); try { localStorage.setItem('storyboard:show-archived', String(e.target.checked)) } catch { /* preference optional */ } }} />Show archived</label></div>
    {creating && <form className="create-form panel" onSubmit={create}><label htmlFor="new-name">Campaign name</label><div className="inline"><input autoFocus id="new-name" required maxLength={120} value={name} disabled={busy || !!creation.current} onChange={e => setName(e.target.value)} placeholder="Give your story a title" /><button className="primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : creation.current ? 'Retry creation' : 'Create'}</button><button type="button" disabled={busy} onClick={() => { setCreating(false); creation.current = null }}>Cancel</button></div><p className="quiet">Start with a name. Add your description and artwork next.</p></form>}
    <ErrorMessage error={error} />{error && !creating && <button onClick={() => setReload(v => v + 1)}>Try again</button>}
    {loading ? <div className="campaign-grid" aria-label="Loading campaigns">{[0, 1, 2].map(n => <div key={n} className="skeleton-card" />)}</div> : !campaigns.length && !error ? <div className="empty"><span className="eyebrow">AN OPEN PAGE</span><h2>{archived ? 'No campaigns yet' : 'Your next story is waiting'}</h2><p>{me.canCreate ? 'Create a campaign to bring your table together.' : 'Once your Game Master adds you, your campaign will appear here.'}</p></div> : <div className="campaign-grid">{campaigns.map((campaign, i) => <Link key={campaign.id} className="campaign-card" href={`/campaigns/${campaign.id}/description`} navigate={navigate}><Artwork campaign={campaign} /><div className="card-content"><div className="card-meta"><span>CAMPAIGN {String(i + 1).padStart(2, '0')}</span>{campaign.archived && <span className="badge"><SiteIcon name="archive" size={16} />Archived</span>}</div><h2>{campaign.name}</h2><p className="card-summary">{campaign.summary || campaign.description || 'An unwritten chapter. Open the campaign to begin.'}</p>{campaign.summaryStale && <span className="quiet">Summary may need updating</span>}<div className="card-roster"><div className="avatar-stack">{campaign.players.slice(0, 4).map(p => <Avatar key={p.id} person={p} />)}</div><span>{campaign.playerCount} at the table</span><span className="role">{roleName(campaign.role)}</span></div></div></Link>)}</div>}
  </section>
}

type Draft = Pick<Campaign, 'name' | 'description' | 'summary'> & { expectedRevision: number }
type GenerationCommand = { kind: 'image' | 'summary'; prompt: string; expectedRevision: number; operationId: string }
type Receipt = { command: GenerationCommand; id?: string }
function readReceipt(key: string): Receipt | null {
  try { const r = JSON.parse(sessionStorage.getItem(key) || 'null'); return r && typeof r.command?.operationId === 'string' && ['image', 'summary'].includes(r.command.kind) && typeof r.command.prompt === 'string' && Number.isSafeInteger(r.command.expectedRevision) && (!r.id || /^[0-9a-f-]{36}$/i.test(r.id)) ? r : null } catch { return null }
}
type MusicGenerationCommand = { operationId: string; situation: string; brief: MusicBrief; confirmed: true }
function readMusicGenerationReceipt(key: string): { id: string; command: MusicGenerationCommand } | null {
  try { const value = JSON.parse(sessionStorage.getItem(key) || 'null'); return value && /^[0-9a-f-]{36}$/i.test(value.id) && /^[0-9a-f-]{36}$/i.test(value.command?.operationId) && typeof value.command?.situation === 'string' && value.command?.confirmed === true && typeof value.command?.brief?.prompt === 'string' ? value : null } catch { return null }
}
function CampaignView({ id, tab, me, navigate, signingOut, signout }: { id: string; tab: string; me: Account; navigate: (p: string) => void; signingOut: boolean; signout: () => Promise<void> }) {
  const base = `/campaigns/${id}`
  const receiptKey = `storyboard:operation:${me.id}:${id}`
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const draftRef = useRef<Draft | null>(null)
  const dirty = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(() => readReceipt(receiptKey))
  const [operation, setOperation] = useState<Operation | null>(null)
  const [pollError, setPollError] = useState('')
  const [pollVersion, setPollVersion] = useState(0)
  const mounted = useRef(true)
  const lock = useRef(false)
  const active = !!receipt || !!operation && !['failed', 'completed'].includes(operation.state)
  const gm = campaign?.role === 'gm'
  const updateDraft = (value: Draft) => { draftRef.current = value; setDraft(value) }
  const accept = useCallback((value: Campaign, replace = false) => {
    setCampaign(value)
    if (replace || !dirty.current) { const d = { name: value.name, description: value.description, summary: value.summary, expectedRevision: value.revision }; draftRef.current = d; setDraft(d); dirty.current = false }
  }, [])
  const refresh = useCallback(async (signal?: AbortSignal) => { const value = await api<Campaign>(base, '', 'GET', undefined, signal); if (!signal?.aborted && mounted.current) accept(value); return value }, [base, accept])
  useEffect(() => { mounted.current = true; const controller = new AbortController(); void refresh(controller.signal).catch(c => { if (!controller.signal.aborted) setError(explain(c)) }); return () => { mounted.current = false; controller.abort() } }, [refresh])
  function retain(value: Receipt | null) { setReceipt(value); try { if (value) sessionStorage.setItem(receiptKey, JSON.stringify(value)); else sessionStorage.removeItem(receiptKey) } catch { /* resume hints are optional, never authority */ } }
  useEffect(() => {
    if (!receipt?.id || !gm) return
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const op = await api<Operation>(`${base}/operations/${receipt!.id}`, '', 'GET', undefined, controller.signal)
        if (controller.signal.aborted) return
        setOperation(op); setPollError('')
        if (op.state === 'completed' || op.state === 'failed') {
          // Keep the receipt until the matching final campaign read succeeds.
          if (op.state === 'completed') await refresh(controller.signal)
          if (controller.signal.aborted) return
          retain(null)
          if (op.state === 'completed') setNotice(op.applied ? `${op.kind === 'image' ? 'Artwork' : 'Summary'} is ready.${dirty.current ? ' Your unsaved draft is kept; review the saved version before saving.' : ''}` : 'The result is ready, but newer campaign changes were retained. It was not applied.')
          return
        }
        timer = setTimeout(() => void poll(), 1600)
      } catch (c) { if (!controller.signal.aborted) setPollError(explain(c) + ' Resume status to check this exact request.') }
    }
    void poll(); return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [receipt?.id, gm, base, pollVersion, refresh])
  async function perform(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (c) { if (mounted.current) setError(explain(c)) } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  async function start(command?: GenerationCommand) {
    await perform(async () => {
      const value = command ?? { kind: 'image' as const, prompt: prompt.trim(), expectedRevision: campaign!.revision, operationId: crypto.randomUUID() }
      retain({ command: value }); setOperation(null); setPollError('')
      try { const op = await api<Operation>(base + '/generate', me.csrfToken, 'POST', value); if (mounted.current) { setOperation(op); retain({ command: value, id: op.id }) } }
      catch (c) { if (c instanceof ApiError && c.status >= 400 && c.status < 500 && mounted.current) retain(null); throw c }
    })
  }
  function edit(key: keyof Pick<Draft, 'name' | 'description' | 'summary'>, value: string) { dirty.current = true; updateDraft({ ...draftRef.current!, [key]: value }) }
  function reviewLatest() { if (campaign) { updateDraft({ ...draftRef.current!, expectedRevision: campaign.revision }); setNotice('Your draft is kept and now uses the latest revision. Compare it with the saved version below before saving.') } }
  if (!campaign || !draft) return <section className="empty"><Link href="/" navigate={navigate}><SiteIcon name="back" />Back to campaigns</Link><ErrorMessage error={error} />{error ? <button onClick={() => void refresh().catch(c => setError(explain(c)))}>Try again</button> : <p role="status">Opening campaign…</p>}</section>
  return <section>
    <header className="campaign-dashboard-header" data-ui-region="campaign-header">
      <div className="campaign-dashboard-bar">
        <div className="campaign-dashboard-identity"><SiteIcon name="notebook" size={32} className="brand-mark" /><div className="campaign-title-line"><h1>{campaign.name}</h1><span className="campaign-context">CAMPAIGN NOTEBOOK</span></div></div>
        <div className="campaign-dashboard-controls">
          <Menu className="campaign-menu" label={`Campaign menu for ${campaign.name}`} trigger={<SiteIcon name="menu" size={24} weight="bold" />}>
            <div className="menu-account"><Avatar person={me} /><div><strong>{me.name}</strong><span>{roleName(campaign.role)}{campaign.archived ? ' · Archived' : ''}</span></div></div>
            <Link className="menu-row" role="menuitem" href="/" navigate={navigate}><SiteIcon name="back" />Back to campaigns</Link>
            {gm && <button className="menu-row" role="menuitem" disabled={busy || active} onClick={() => void perform(async () => { const value = await api<Campaign>(base + (campaign.archived ? '/restore' : '/archive'), me.csrfToken, 'POST', {}); if (mounted.current) { accept(value); setNotice(campaign.archived ? 'Campaign restored.' : 'Campaign archived. Your table can still open this link.') } })}><SiteIcon name={campaign.archived ? 'restore' : 'archive'} />{campaign.archived ? 'Restore campaign' : 'Archive campaign'}</button>}
            <button className="menu-row" role="menuitem" onClick={() => void signout()} disabled={signingOut}><SiteIcon name={signingOut ? 'busy' : 'signout'} className={signingOut ? 'is-spinning' : undefined} />{signingOut ? 'Signing out…' : 'Sign out'}</button>
          </Menu>
        </div>
      </div>
      <nav className="campaign-tabs" aria-label="Campaign tabs">{['description', 'players', 'music'].map(t => <Link key={t} href={`${base}/${t}`} navigate={navigate} aria-current={tab === t ? 'page' : undefined}><SiteIcon name={t === 'description' ? 'description' : t === 'players' ? 'players' : 'music'} />{t === 'description' ? 'Description' : t === 'players' ? 'Players' : 'Music'}</Link>)}</nav>
    </header>
    <ErrorMessage error={error} />{notice && <Feedback tone="notice">{notice}</Feedback>}
    {tab === 'music' ? <MusicWorkspace id={id} gm={!!gm} me={me} /> : tab === 'players' ? <Players id={id} gm={!!gm} me={me} onMembershipChange={async () => { await refresh() }} /> : <section className="description-page"><CampaignPageHeader title="Description" description="Edit the campaign premise, summary, and artwork." /><div className="description-grid">
      <div>
        {gm ? <form className="description-form" onSubmit={e => { e.preventDefault(); if (active) return; void perform(async () => { const value = await api<Campaign>(base, me.csrfToken, 'PUT', draftRef.current); if (mounted.current) { accept(value, true); setNotice('Campaign saved.') } }) }}><label htmlFor="campaign-name">Campaign name</label><input id="campaign-name" value={draft.name} onChange={e => edit('name', e.target.value)} required maxLength={120} /><label htmlFor="campaign-description">Description</label><textarea id="campaign-description" rows={12} maxLength={40000} value={draft.description} onChange={e => edit('description', e.target.value)} placeholder="Set the scene. What kind of world will your players step into?" /><label htmlFor="campaign-summary">Summary</label><textarea id="campaign-summary" rows={4} maxLength={1500} value={draft.summary} onChange={e => edit('summary', e.target.value)} placeholder="A short introduction for your table" /><div className="form-actions"><button className="primary" disabled={busy || active || !draft.name.trim() || !dirty.current}><SiteIcon name={busy ? 'busy' : 'save'} className={busy ? 'is-spinning' : undefined} />{busy ? 'Saving…' : 'Save changes'}</button><span className="quiet">{active ? 'Wait for the current request before saving.' : dirty.current ? 'Unsaved changes' : 'All changes saved'}</span></div></form> : <article className="read-description"><p>{campaign.description || 'Your Game Master has not added a description yet.'}</p></article>}
        {gm && dirty.current && <details className="saved-version"><summary>Review latest saved version</summary><button disabled={busy || active} onClick={() => void perform(async () => { await refresh(); setNotice('The latest saved version is shown below. Your draft is kept.') })}>Refresh saved version</button><h3>{campaign.name}</h3><p>{campaign.description || 'No saved description.'}</p><p>{campaign.summary || 'No saved summary.'}</p>{draft.expectedRevision !== campaign.revision && <button disabled={busy || active} onClick={reviewLatest}>Keep draft against latest revision</button>}</details>}
      </div>
      <aside className="campaign-aside"><Artwork campaign={campaign} />
        {gm && <form className="image-form" onSubmit={e => { e.preventDefault(); if (!active && !busy) void start() }}><label htmlFor="image-prompt">A quick image idea</label><textarea id="image-prompt" rows={3} maxLength={4000} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="A lonely observatory above a sea of clouds…" disabled={busy || active} /><button className="accent" disabled={busy || active || !prompt.trim()}><SiteIcon name="generate" />Generate artwork</button></form>}
        <section className="summary-panel"><span className="eyebrow">AT A GLANCE</span><h2>The story so far</h2><p>{campaign.summary || 'A short introduction will appear here.'}</p>{campaign.summaryStale && <p className="quiet">The description changed. This summary may need updating.</p>}{gm && <><button disabled={busy || active || dirty.current || !campaign.description.trim()} onClick={() => void start({ kind: 'summary', prompt: '', expectedRevision: campaign.revision, operationId: crypto.randomUUID() })}><SiteIcon name="generate" />Generate summary</button><p className="quiet">Uses the saved description. Save your changes first.</p></>}</section>
        {(operation || receipt) && <section className="operation-panel" aria-live="polite"><span className="eyebrow">{(operation?.kind || receipt?.command.kind) === 'image' ? 'ARTWORK' : 'SUMMARY'}</span><p>{!operation ? receipt?.id ? 'Checking request…' : 'Request not confirmed. Retry to recover the same request.' : ({ pending: 'Request queued…', refining: 'Refining the idea…', generating: 'Creating the artwork…', saving: 'Saving the result…', completed: operation.applied ? 'Ready and saved.' : 'Ready. Newer campaign changes were retained; this result was not applied.', failed: operation.error || 'Generation failed. Your previous artwork is kept. Try again.' }[operation.state])}</p>{operation?.refinedPrompt && <details><summary>View refined prompt</summary><p>{operation.refinedPrompt}</p></details>}{receipt && !receipt.id && <button disabled={busy} onClick={() => void start(receipt.command)}>Retry same request</button>}<ErrorMessage error={pollError} />{pollError && <button onClick={() => setPollVersion(v => v + 1)}>Resume status</button>}</section>}
      </aside>
    </div></section>}
  </section>
}

function trackTime(ms: number) { const seconds = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
function MusicArtwork({ src, title, source }: { src: string | null; title: string; source?: MusicTrack['sourceKind'] }) {
  const safe = imageSource(src); const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [safe])
  return safe && !failed ? <img className="music-art" src={safe} alt={`${title} cover`} onError={() => setFailed(true)} /> : <span className={`music-art music-art-empty${source ? ` is-${source}` : ''}`} aria-label={`${title} has no cover`}><SiteIcon name={source === 'spotify' ? 'spotify' : 'music'} /></span>
}

interface SpotifyWebPlaybackState { paused: boolean; position: number; duration: number }
interface SpotifyWebPlayer {
  addListener(event: string, listener: (value: any) => void): boolean
  connect(): Promise<boolean>
  disconnect(): void
  activateElement(): Promise<void>
  togglePlay(): Promise<void>
  pause(): Promise<void>
}
interface SpotifyWebPlayerConstructor {
  new(options: { name: string; getOAuthToken: (callback: (token: string) => void) => void; volume: number; enableMediaSession: boolean }): SpotifyWebPlayer
}
declare global {
  interface Window {
    Spotify?: { Player: SpotifyWebPlayerConstructor }
    onSpotifyWebPlaybackSDKReady?: () => void
    __storyboardSpotifyPlayerReady?: boolean
  }
}
let spotifySdkPromise: Promise<void> | null = null
function spotifyWebPlaybackSdk() {
  if (window.Spotify) return Promise.resolve()
  if (spotifySdkPromise) return spotifySdkPromise
  spotifySdkPromise = new Promise<void>((resolve, reject) => {
    const previous = window.onSpotifyWebPlaybackSDKReady
    const timer = window.setTimeout(() => reject(new Error('spotify_sdk_timeout')), 15000)
    const failed = () => { window.clearTimeout(timer); reject(new Error('spotify_sdk_unavailable')) }
    window.onSpotifyWebPlaybackSDKReady = () => { window.clearTimeout(timer); previous?.(); resolve() }
    const existing = document.querySelector<HTMLScriptElement>('script[data-storyboard-spotify-sdk]')
    if (existing) existing.addEventListener('error', failed, { once: true })
    else {
      const script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.async = true
      script.dataset.storyboardSpotifySdk = ''
      script.addEventListener('error', failed, { once: true })
      document.body.appendChild(script)
    }
  }).catch(error => { spotifySdkPromise = null; throw error })
  return spotifySdkPromise
}

function PlayerDock({ campaignId, csrfToken, navigate }: { campaignId: string; csrfToken: string; navigate: (p: string) => void }) {
  const [track, setTrack] = useState<MusicTrack | null>(null)
  const [sourceCampaignId, setSourceCampaignId] = useState(campaignId)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [playerError, setPlayerError] = useState('')
  const audio = useRef<HTMLAudioElement>(null)
  const spotify = useRef<SpotifyWebPlayer | null>(null)
  const spotifyCreating = useRef<Promise<SpotifyWebPlayer> | null>(null)
  const spotifyDeviceId = useRef('')
  const tokenCampaignId = useRef(campaignId)
  const playerErrorRef = useRef('')
  useEffect(() => {
    let disposed = false
    const announceReady = (ready: boolean, error = '') => {
      window.__storyboardSpotifyPlayerReady = ready
      playerErrorRef.current = error
      setPlayerError(error)
      window.dispatchEvent(new CustomEvent('storyboard:spotify-player-ready', { detail: { ready, error } }))
    }
    const ensurePlayer = () => {
      if (spotify.current && spotifyDeviceId.current) return Promise.resolve(spotify.current)
      if (spotifyCreating.current) return spotifyCreating.current
      announceReady(false)
      spotifyCreating.current = spotifyWebPlaybackSdk().then(() => new Promise<SpotifyWebPlayer>((resolve, reject) => {
        if (disposed || !window.Spotify) { reject(new Error('spotify_sdk_unavailable')); return }
        const player = new window.Spotify.Player({
          name: 'Storyboard · This browser',
          volume: 0.72,
          enableMediaSession: true,
          getOAuthToken: callback => {
            void api<{ accessToken: string }>(`/campaigns/${tokenCampaignId.current}/music/browser-player`, csrfToken, 'POST', {})
              .then(value => callback(value.accessToken))
              .catch(cause => { announceReady(false, explain(cause)); callback('') })
          },
        })
        spotify.current = player
        let settled = false
        const failed = (message: string) => {
          announceReady(false, message)
          if (!settled) { settled = true; reject(new Error('spotify_player_unavailable')) }
        }
        player.addListener('ready', ({ device_id }: { device_id: string }) => {
          if (disposed) { player.disconnect(); return }
          spotifyDeviceId.current = device_id
          announceReady(true)
          if (!settled) { settled = true; resolve(player) }
        })
        player.addListener('not_ready', () => { spotifyDeviceId.current = ''; announceReady(false, 'The browser player went offline. Tap Play to reconnect it.') })
        player.addListener('player_state_changed', (state: SpotifyWebPlaybackState | null) => {
          if (!state) return
          setPlaying(!state.paused)
          setProgress(state.position || 0)
        })
        player.addListener('initialization_error', () => failed('This browser cannot start protected Spotify playback.'))
        player.addListener('authentication_error', () => failed('Reconnect Spotify once in Smart Home settings to enable full browser playback.'))
        player.addListener('account_error', () => failed('Full browser playback requires a Spotify Premium account.'))
        player.addListener('playback_error', () => announceReady(true, 'Spotify could not play that track. Try another track.'))
        player.addListener('autoplay_failed', () => announceReady(true, 'Tap Play once more to allow audio in this browser.'))
        void player.connect().then(connected => { if (!connected) failed('Spotify could not connect this browser player.') }).catch(() => failed('Spotify could not connect this browser player.'))
      })).catch(error => {
        spotify.current?.disconnect()
        spotify.current = null
        spotifyDeviceId.current = ''
        if (!playerErrorRef.current) announceReady(false, 'Spotify could not prepare the browser player. Tap Play to retry.')
        throw error
      }).finally(() => { spotifyCreating.current = null })
      return spotifyCreating.current
    }
    const warm = (event: Event) => {
      const detail = (event as CustomEvent<{ uri: string; campaignId: string }>).detail
      if (!detail?.uri) return
      tokenCampaignId.current = detail.campaignId
      void ensurePlayer().catch(() => {})
    }
    const play = async (event: Event) => {
      const detail = (event as CustomEvent<{ track: MusicTrack; campaignId: string }>).detail
      if (!detail?.track) return
      tokenCampaignId.current = detail.campaignId
      setTrack(detail.track); setSourceCampaignId(detail.campaignId); setProgress(0)
      if (detail.track.sourceKind === 'generated' && detail.track.audioUrl) {
        void spotify.current?.pause()
        if (audio.current) { audio.current.src = detail.track.audioUrl; audio.current.currentTime = 0; void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false)) }
      } else if (detail.track.sourceKind === 'spotify' && detail.track.uri) {
        audio.current?.pause(); setPlaying(false)
        const active = spotify.current
        if (active) void active.activateElement()
        try {
          const player = await ensurePlayer()
          if (player !== active) await player.activateElement()
          await api(`/campaigns/${detail.campaignId}/music/playback`, csrfToken, 'POST', { action: 'play', trackUris: [detail.track.uri], deviceId: spotifyDeviceId.current })
          setPlaying(true)
        } catch (cause) { announceReady(false, cause instanceof ApiError ? explain(cause) : playerErrorRef.current || 'Spotify could not play in this browser.'); setPlaying(false) }
      }
    }
    window.addEventListener('storyboard:prepare-spotify-track', warm)
    window.addEventListener('storyboard:play-track', play)
    return () => {
      disposed = true
      window.removeEventListener('storyboard:prepare-spotify-track', warm)
      window.removeEventListener('storyboard:play-track', play)
      spotify.current?.disconnect(); spotify.current = null; spotifyDeviceId.current = ''; announceReady(false)
    }
  }, [csrfToken])
  async function toggle() {
    if (!track) return
    if (track.sourceKind === 'spotify') {
      if (!spotify.current) return
      await spotify.current.activateElement()
      await spotify.current.togglePlay()
      return
    }
    if (!audio.current) return
    if (playing) audio.current.pause(); else await audio.current.play()
    setPlaying(!playing)
  }
  return <aside className="player-dock" aria-label="Browser campaign player">
    <audio ref={audio} hidden onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={event => setProgress(event.currentTarget.currentTime * 1000)} onEnded={() => setPlaying(false)} />
    <Link className="player-now" href={`/campaigns/${sourceCampaignId}/music`} navigate={navigate}><MusicArtwork src={track?.imageUrl || null} title={track?.name || 'Campaign music'} source={track?.sourceKind} /><span><strong>{track?.name || 'Nothing playing'}</strong><small>{playerError || (track ? `${track.artist} · This browser` : 'Open Music to set the scene')}</small></span></Link>
    {track && <span className="player-progress">{trackTime(progress)} / {trackTime(track.durationMs)}</span>}
    <div className="player-controls"><button className="player-primary" disabled={!track} aria-label={playing ? 'Pause music in this browser' : 'Play music in this browser'} onClick={() => void toggle()}><SiteIcon name={playing ? 'pause' : 'play'} /></button></div>
  </aside>
}

function PlaylistAdder({ track, playlists, disabled, add }: { track: MusicTrack; playlists: MusicPlaylist[]; disabled: boolean; add: (track: MusicTrack, playlist: MusicPlaylist) => void }) {
  return <Menu className="track-playlist-menu" label={`Add ${track.name} to playlist`} trigger={<SiteIcon name="playlist" />}><span className="menu-caption">Add to playlist</span>{playlists.map(playlist => <button role="menuitem" type="button" key={playlist.id} disabled={disabled} onClick={() => add(track, playlist)}><span className="playlist-art"><SiteIcon name="playlist" size={16} /></span><span>{playlist.name}</span></button>)}</Menu>
}

function MusicWorkspace({ id, gm, me }: { id: string; gm: boolean; me: Account }) {
  const base = `/campaigns/${id}/music`
  const generationReceiptKey = `storyboard:music-generation:${me.id}:${id}`
  const generationResume = useRef(readMusicGenerationReceipt(generationReceiptKey))
  const [status, setStatus] = useState<MusicStatus | null>(null)
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([])
  const [selected, setSelected] = useState<MusicPlaylist | null>(null)
  const [playlistTracks, setPlaylistTracks] = useState<MusicTrack[]>([])
  const [pool, setPool] = useState<MusicTrack[]>([])
  const [queue, setQueue] = useState<MusicQueueItem[]>([])
  const [results, setResults] = useState<MusicTrack[]>([])
  const [query, setQuery] = useState('')
  const [catalogQuery, setCatalogQuery] = useState('')
  const [creatingPlaylist, setCreatingPlaylist] = useState(false)
  const [playlistName, setPlaylistName] = useState('')
  const [draggingOver, setDraggingOver] = useState(false)
  const [situation, setSituation] = useState(generationResume.current?.command.situation || '')
  const [brief, setBrief] = useState<MusicBrief | null>(generationResume.current?.command.brief || null)
  const [confirming, setConfirming] = useState(false)
  const [generation, setGeneration] = useState<MusicGeneration | null>(null)
  const [generationId, setGenerationId] = useState(generationResume.current?.id || '')
  const generationCommand = useRef<MusicGenerationCommand | null>(generationResume.current?.command || null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [spotifyPlayer, setSpotifyPlayer] = useState(() => ({ ready: !!window.__storyboardSpotifyPlayerReady, error: '' }))
  const visible = results.length ? results : selected ? playlistTracks : pool
  const firstSpotifyUri = visible.find(track => track.sourceKind === 'spotify' && track.uri)?.uri || ''
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ ready: boolean; error?: string }>).detail
      setSpotifyPlayer({ ready: !!detail?.ready, error: detail?.error || '' })
    }
    window.addEventListener('storyboard:spotify-player-ready', changed)
    return () => window.removeEventListener('storyboard:spotify-player-ready', changed)
  }, [])
  useEffect(() => {
    if (gm && firstSpotifyUri) window.dispatchEvent(new CustomEvent('storyboard:prepare-spotify-track', { detail: { uri: firstSpotifyUri, campaignId: id } }))
  }, [firstSpotifyUri, gm, id])
  useEffect(() => {
    const c = new AbortController(); setError('')
    Promise.all([api<MusicStatus>(base + '/status', '', 'GET', undefined, c.signal), api<MusicPage<MusicPlaylist>>(base + '/playlists?offset=0&limit=100', '', 'GET', undefined, c.signal), api<MusicTrack[]>(base + '/tracks', '', 'GET', undefined, c.signal), api<MusicQueueItem[]>(base + '/queue', '', 'GET', undefined, c.signal)])
      .then(([s, p, tracks, q]) => { if (!c.signal.aborted) { setStatus(s); setPlaylists(p.items); setPool(tracks); setQueue(q) } }).catch(e => { if (!c.signal.aborted) setError(explain(e)) })
    return () => c.abort()
  }, [base])
  useEffect(() => {
    if (!generationId || generation && ['completed', 'failed'].includes(generation.state)) return
    const c = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() { try { const value = await api<MusicGeneration>(`${base}/generations/${generationId}`, '', 'GET', undefined, c.signal); if (!c.signal.aborted) { setGeneration(value); if (!['completed', 'failed'].includes(value.state)) timer = setTimeout(poll, 1800) } } catch (e) { if (!c.signal.aborted) { setError(explain(e)); timer = setTimeout(poll, 3000) } } }
    timer = setTimeout(poll, 700); return () => { c.abort(); if (timer) clearTimeout(timer) }
  }, [base, generationId, generation?.state])
  async function choose(value: MusicPlaylist) { setSelected(value); setResults([]); setBusy('playlist'); setError(''); try { const p = await api<MusicPage<MusicTrack>>(`${base}/playlists/${value.id}/tracks?offset=0&limit=100`); setPlaylistTracks(p.items) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function createPlaylist(event: FormEvent) { event.preventDefault(); if (!playlistName.trim() || busy) return; setBusy('create-playlist'); setError(''); try { const value = await api<MusicPlaylist>(base + '/playlists', me.csrfToken, 'POST', { name: playlistName.trim(), description: '', operationId: crypto.randomUUID() }); setPlaylists(items => [...items, value].sort((a, b) => a.name.localeCompare(b.name))); setPlaylistName(''); setCreatingPlaylist(false); await choose(value); setNotice(`${value.name} is ready.`) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function searchSpotify(event: FormEvent) { event.preventDefault(); if (!catalogQuery.trim() || busy) return; setBusy('search'); setError(''); setBrief(null); try { const value = await api<{ query: string; tracks: MusicTrack[] }>(base + '/search', me.csrfToken, 'POST', { query: catalogQuery.trim() }); setQuery(value.query); setResults(value.tracks) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function find() { if (!situation.trim() || busy) return; setBusy('find'); setError(''); setBrief(null); try { const value = await api<{ query: string; tracks: MusicTrack[] }>(base + '/find', me.csrfToken, 'POST', { situation: situation.trim() }); setQuery(value.query); setResults(value.tracks) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function compose() { if (!situation.trim() || busy) return; setBusy('brief'); setError(''); setResults([]); setConfirming(false); setGeneration(null); setGenerationId(''); try { sessionStorage.removeItem(generationReceiptKey) } catch { /* resume hint only */ }; generationCommand.current = null; try { setBrief(await api<MusicBrief>(base + '/brief', me.csrfToken, 'POST', { situation: situation.trim() })) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function generate() { if (!brief || busy) return; setBusy('generate'); setError(''); const value = generationCommand.current ?? { operationId: crypto.randomUUID(), situation: situation.trim(), brief, confirmed: true as const }; generationCommand.current = value; try { const created = await api<MusicGeneration>(base + '/generations', me.csrfToken, 'POST', value); setGeneration(created); setGenerationId(created.id); try { sessionStorage.setItem(generationReceiptKey, JSON.stringify({ id: created.id, command: value })) } catch { /* resume hint only */ }; setConfirming(false) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function promote(candidate: string) { if (busy) return; setBusy('promote-' + candidate); setError(''); try { await api(`${base}/candidates/${candidate}/promote`, me.csrfToken, 'POST', {}); if (generation) setGeneration(await api<MusicGeneration>(`${base}/generations/${generation.id}`)); setPool(await api<MusicTrack[]>(base + '/tracks')); setNotice('Candidate saved to the campaign track pool.') } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function saveTrack(track: MusicTrack) { if (busy || track.sourceKind !== 'spotify' || !track.uri) return; setBusy('save-' + track.id); setError(''); try { const saved = await api<MusicTrack>(base + '/tracks', me.csrfToken, 'POST', { name: track.name, artist: track.artist, album: track.album, imageUrl: track.imageUrl, durationMs: track.durationMs, uri: track.uri }); setPool(items => [...items.filter(item => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name))); setNotice(`${track.name} saved to the campaign track pool.`) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function addToPlaylist(track: MusicTrack, playlist: MusicPlaylist) { if (busy) return; setBusy('playlist-add-' + track.id); setError(''); try { const updated = await api<MusicPlaylist>(`${base}/playlists/${playlist.id}/tracks`, me.csrfToken, 'POST', { trackId: track.id }); setPlaylists(items => items.map(item => item.id === updated.id ? updated : item)); if (selected?.id === playlist.id) { setSelected(updated); const page = await api<MusicPage<MusicTrack>>(`${base}/playlists/${playlist.id}/tracks?offset=0&limit=100`); setPlaylistTracks(page.items) }; setNotice(`${track.name} added to ${playlist.name}.`) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function removeFromPlaylist(track: MusicTrack) { if (!selected || busy) return; setBusy('playlist-remove-' + track.id); setError(''); try { await api(`${base}/playlists/${selected.id}/tracks/${track.id}/remove`, me.csrfToken, 'POST', {}); const page = await api<MusicPage<MusicTrack>>(`${base}/playlists/${selected.id}/tracks?offset=0&limit=100`); setPlaylistTracks(page.items); const updated = { ...selected, trackCount: page.total }; setSelected(updated); setPlaylists(items => items.map(item => item.id === updated.id ? updated : item)) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function enqueue(payload: { trackId?: string; playlistId?: string }, label: string) { if (busy || !gm) return; setBusy('enqueue'); setError(''); try { setQueue(await api<MusicQueueItem[]>(base + '/queue', me.csrfToken, 'POST', { ...payload, operationId: crypto.randomUUID() })); setNotice(`${label} added to the session queue.`) } catch (e) { setError(explain(e)) } finally { setBusy(''); setDraggingOver(false) } }
  async function removeQueue(item: MusicQueueItem) { if (busy || !gm) return; setBusy('queue-remove'); try { setQueue(await api<MusicQueueItem[]>(`${base}/queue/${item.queueId}/remove`, me.csrfToken, 'POST', {})) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function clearQueue() { if (busy || !gm) return; setBusy('queue-clear'); try { setQueue(await api<MusicQueueItem[]>(base + '/queue/clear', me.csrfToken, 'POST', {})) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  function play(track: MusicTrack) { if (busy || !gm) return; setError(''); setNotice(''); window.dispatchEvent(new CustomEvent('storyboard:play-track', { detail: { track, campaignId: id } })); setNotice(`Loaded ${track.name} in this browser.`) }
  function drag(event: React.DragEvent, value: { kind: 'track' | 'playlist'; id: string; label: string }) { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-storyboard-music', JSON.stringify(value)) }
  function drop(event: React.DragEvent) { event.preventDefault(); setDraggingOver(false); try { const value = JSON.parse(event.dataTransfer.getData('application/x-storyboard-music')) as { kind: string; id: string; label: string }; if (value.kind === 'track') void enqueue({ trackId: value.id }, value.label); else if (value.kind === 'playlist') void enqueue({ playlistId: value.id }, value.label) } catch { /* foreign drag */ } }
  const saved = (track: MusicTrack) => pool.find(item => item.id === track.id || !!track.uri && item.uri === track.uri)
  return <section className="music-workspace">
    <CampaignPageHeader title="Music" description="Curate mixed-source playlists, search Spotify, generate scores, and run one campaign queue." aside={<div className={`music-service ${status?.connected ? 'is-connected' : ''}`}><span />{status?.connected ? 'Spotify catalogue connected' : status?.error || 'Checking music service…'}</div>} />
    <ErrorMessage error={error} />{spotifyPlayer.error && <Feedback tone="error">{spotifyPlayer.error}</Feedback>}{notice && <Feedback tone="notice">{notice}</Feedback>}
    <form className="scene-composer panel" onSubmit={e => { e.preventDefault(); void find() }}><label htmlFor="music-situation">What is happening right now?</label><textarea id="music-situation" value={situation} onChange={e => setSituation(e.target.value)} maxLength={2000} rows={3} placeholder="The party enters the drowned throne room while something enormous moves below the water…" /><div className="scene-actions"><button className="primary" disabled={!gm || !situation.trim() || !!busy}><SiteIcon name="search" />{busy === 'find' ? 'Reading the room…' : 'Find music'}</button><button type="button" className="accent" disabled={!gm || !situation.trim() || !!busy} onClick={() => void compose()}><SiteIcon name="generate" />{busy === 'brief' ? 'Shaping the score…' : 'Compose new'}</button><span className="quiet">Find uses Fast. Compose uses Deep and stops before any paid generation.</span></div></form>
    {brief && <section className="music-brief panel" aria-label="Generation brief"><div><span className="eyebrow">READY TO COMPOSE</span><h3>{brief.title}</h3><p>{brief.prompt}</p></div><dl><div><dt>Mood</dt><dd>{brief.mood}</dd></div><div><dt>Energy</dt><dd>{brief.energy}</dd></div><div><dt>Tempo</dt><dd>{brief.tempo}</dd></div><div><dt>Length</dt><dd>{trackTime(brief.durationSeconds * 1000)}</dd></div></dl><p className="brief-style"><strong>Style</strong> {brief.style}</p><p className="quiet">{brief.instruments.join(' · ')}</p>{!generation && !confirming && <button className="accent" onClick={() => setConfirming(true)} disabled={!!busy}><SiteIcon name="generate" />Generate candidates</button>}{confirming && <div className="generation-confirm"><strong>This submits paid music generation.</strong><span>The brief above is the exact prompt snapshot. Retrying this confirmation reuses the same operation ID.</span><div><button className="accent" onClick={() => void generate()} disabled={!!busy}>{busy === 'generate' ? 'Submitting…' : 'Confirm and generate'}</button><button onClick={() => setConfirming(false)} disabled={!!busy}>Cancel</button></div></div>}{!generation && <p className="quiet">No credits have been spent.</p>}</section>}
    {generation && <section className="candidate-panel panel" aria-live="polite"><div className="music-section-title"><div><span className="eyebrow">GENERATED CANDIDATES</span><h3>{generation.state === 'completed' ? 'Choose what becomes part of the campaign' : generation.state === 'failed' ? 'Generation stopped' : 'Your score is being created'}</h3></div><span>{generation.state}</span></div>{generation.error && <Feedback tone="error">{generation.error}</Feedback>}{!['completed', 'failed'].includes(generation.state) && <p role="status">{generation.state === 'ingesting' ? 'Saving every candidate into Leaf Assets…' : 'Generating with the confirmed brief…'}</p>}{generation.candidates.map(candidate => <article className="candidate-row" key={candidate.id}><MusicArtwork src={candidate.cover} title={candidate.title} source="generated" /><div><strong>{candidate.title}</strong><small>{candidate.tags || brief?.style || 'generated score'} · {trackTime(candidate.durationSeconds * 1000)}</small><audio controls preload="metadata" src={candidate.audio}>Your browser cannot play this audio.</audio></div><button disabled={!!candidate.promotedTrack || !!busy} onClick={() => void promote(candidate.id)}><SiteIcon name="plus" />{candidate.promotedTrack ? 'Saved to pool' : 'Save to pool'}</button></article>)}{generation.state === 'failed' && generationCommand.current && <button disabled={!!busy} onClick={() => void generate()}>Retry same operation</button>}{generation.state === 'completed' && <p className="quiet">Credits recorded: {generation.creditsConsumed}. Every candidate is already stored durably, even before promotion.</p>}</section>}
    <form className="spotify-search" onSubmit={searchSpotify}><label htmlFor="spotify-track-search"><SiteIcon name="spotify" />Search Spotify tracks</label><div className="inline"><input id="spotify-track-search" value={catalogQuery} onChange={event => setCatalogQuery(event.target.value)} maxLength={180} placeholder="Track, artist, album, mood…" /><button disabled={!catalogQuery.trim() || !!busy}><SiteIcon name="search" />{busy === 'search' ? 'Searching…' : 'Search'}</button></div></form>
    <div className="music-layout">
      <aside className="music-library"><div className="music-section-title"><div><span className="eyebrow">CAMPAIGN</span><h3>Playlists</h3></div><button className="icon-button" aria-label="Create playlist" onClick={() => setCreatingPlaylist(v => !v)}><SiteIcon name="plus" /></button></div>{creatingPlaylist && <form className="playlist-create" onSubmit={createPlaylist}><input autoFocus value={playlistName} onChange={event => setPlaylistName(event.target.value)} maxLength={160} placeholder="Playlist name" aria-label="Playlist name" /><div><button className="primary" disabled={!playlistName.trim() || !!busy}>Create</button><button type="button" onClick={() => setCreatingPlaylist(false)}>Cancel</button></div></form>}<button className={`pool-selector${!selected && !results.length ? ' is-selected' : ''}`} onClick={() => { setSelected(null); setResults([]) }}><span className="playlist-art"><SiteIcon name="music" /></span><span><strong>Track pool</strong><small>{pool.length} mixed-source tracks</small></span></button><div className="playlist-list">{playlists.map(p => <div className={`playlist-row${selected?.id === p.id ? ' is-selected' : ''}`} key={p.id} draggable={gm} onDragStart={event => drag(event, { kind: 'playlist', id: p.id, label: p.name })}><button onClick={() => void choose(p)}><span className="playlist-art"><SiteIcon name="playlist" /></span><span><strong>{p.name}</strong><small>{p.trackCount} tracks</small></span></button>{gm && <button className="icon-button" aria-label={`Enqueue ${p.name}`} disabled={!!busy || p.trackCount === 0} onClick={() => void enqueue({ playlistId: p.id }, p.name)}><SiteIcon name="queue" /></button>}</div>)}</div></aside>
      <section className="music-tracks">
        <div className="music-section-title">
          <div><span className="eyebrow">{results.length ? 'SPOTIFY RESULTS' : selected ? 'PLAYLIST' : 'CAMPAIGN LIBRARY'}</span><h3>{results.length ? `For “${query}”` : selected?.name || 'Track pool'}</h3></div>
          <span>{!spotifyPlayer.ready && !spotifyPlayer.error && gm && firstSpotifyUri ? 'Preparing player…' : spotifyPlayer.error ? 'Player needs attention' : `${visible.length} tracks`}</span>
        </div>
        {results.length > 0 && <button className="back-to-pool" onClick={() => setResults([])}><SiteIcon name="back" />Back to {selected ? selected.name : 'track pool'}</button>}
        {busy === 'playlist' ? <p role="status">Loading tracks…</p> : !visible.length ? <div className="music-empty"><SiteIcon name="music" size={32} /><p>{selected ? 'This playlist is empty. Add tracks from the pool.' : 'Search Spotify or save a generated candidate to begin.'}</p></div> : <div className="track-list">{visible.map((track, i) => {
          const stored = saved(track)
          const draggable = stored || (!results.length && track)
          const preparingSpotify = track.sourceKind === 'spotify' && !spotifyPlayer.ready && !spotifyPlayer.error
          return <article className="track-row" key={`${track.id}-${i}`} draggable={!!gm && !!draggable} onDragStart={event => draggable && drag(event, { kind: 'track', id: draggable.id, label: draggable.name })}>
            <span className="drag-handle" aria-hidden="true"><SiteIcon name="drag" size={16} /></span>
            <MusicArtwork src={track.imageUrl} title={track.name} source={track.sourceKind} />
            <div className="track-name"><strong>{track.name}</strong><small><span className={`source-badge is-${track.sourceKind}`}>{track.sourceKind === 'spotify' ? 'Spotify' : 'Generated'}</span>{track.artist}{track.album ? ` · ${track.album}` : ''}</small></div>
            <span className="track-duration">{trackTime(track.durationMs)}</span>
            {gm && <div className="track-actions">
              <button aria-label={`Play ${track.name}`} title={preparingSpotify ? 'Preparing the browser player…' : undefined} disabled={!!busy || preparingSpotify} onClick={() => void play(track)}><SiteIcon name={preparingSpotify ? 'busy' : 'play'} className={preparingSpotify ? 'is-spinning' : undefined} /></button>
              {results.length && !stored ? <button aria-label={`Save ${track.name} to pool`} disabled={!!busy} onClick={() => void saveTrack(track)}><SiteIcon name="plus" /></button> : <>
                <button aria-label={`Enqueue ${track.name}`} disabled={!!busy || !draggable} onClick={() => draggable && void enqueue({ trackId: draggable.id }, draggable.name)}><SiteIcon name="queue" /></button>
                {selected ? <button aria-label={`Remove ${track.name} from ${selected.name}`} disabled={!!busy} onClick={() => void removeFromPlaylist(track)}><SiteIcon name="close" /></button> : playlists.length > 0 && draggable && <PlaylistAdder track={draggable} playlists={playlists} disabled={!!busy} add={(value, playlist) => void addToPlaylist(value, playlist)} />}
              </>}
            </div>}
          </article>
        })}</div>}
      </section>
      <aside className={`live-queue${draggingOver ? ' is-drop-target' : ''}`} onDragEnter={() => setDraggingOver(true)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraggingOver(false) }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={drop}><div className="music-section-title"><div><span className="eyebrow">LIVE</span><h3>Session queue</h3></div><span>{queue.length}</span></div><p className="quiet">Drag a track or whole playlist here. This queue belongs to the campaign, so it survives Spotify devices coming and going.</p>{queue.length ? <><ol className="queue-list">{queue.map((item, i) => <li key={item.queueId}><span>{String(i + 1).padStart(2, '0')}</span><div><strong>{item.track.name}</strong><small>{item.track.sourceKind === 'spotify' ? 'Spotify' : 'Generated'} · {item.track.artist}</small></div><button className="icon-button" aria-label={`Remove ${item.track.name} from queue`} onClick={() => void removeQueue(item)}><SiteIcon name="close" size={16} /></button></li>)}</ol>{gm && <button className="clear-queue" disabled={!!busy} onClick={() => void clearQueue()}>Clear queue</button>}</> : <div className="queue-placeholder"><SiteIcon name="queue" size={32} /><strong>Drop the next beat here</strong><span>Tracks and complete playlists both work.</span></div>}</aside>
    </div>
  </section>
}

function Players({ id, gm, me, onMembershipChange }: { id: string; gm: boolean; me: Account; onMembershipChange: () => Promise<void> }) {
  const base = `/campaigns/${id}`
  const [players, setPlayers] = useState<Player[]>([])
  const [email, setEmail] = useState('')
  const [results, setResults] = useState<Person[] | null>(null)
  const [addRole, setAddRole] = useState<'gm' | 'player'>('player')
  const [remove, setRemove] = useState<Player | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const mounted = useRef(true)
  const lock = useRef(false)
  useEffect(() => { mounted.current = true; const c = new AbortController(); api<Player[]>(base + '/players', '', 'GET', undefined, c.signal).then(setPlayers).catch(e => { if (!c.signal.aborted) setError(explain(e)) }).finally(() => { if (!c.signal.aborted) setLoading(false) }); return () => { mounted.current = false; c.abort() } }, [base, reload])
  async function perform(action: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (c) { if (mounted.current) setError(explain(c)) } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  async function membership(accountId: string, role: 'gm' | 'player') { const value = await api<Player[]>(base + '/players', me.csrfToken, 'POST', { accountId, role }); if (mounted.current) { setPlayers(value); setResults(null); setNotice('Membership updated.') }; await onMembershipChange() }
  return <section className="players-panel"><CampaignPageHeader title="Players" description={`${players.length} ${players.length === 1 ? 'person' : 'people'} in this campaign. Manage their roles and characters here.`} /><ErrorMessage error={error} />{error && <button disabled={busy} onClick={() => { setError(''); setReload(v => v + 1) }}>Reload roster</button>}{notice && <Feedback tone="notice">{notice}</Feedback>}
    {gm && <form className="roster-search panel" onSubmit={e => { e.preventDefault(); void perform(async () => { const value = await api<Person[]>(base + '/accounts?email=' + encodeURIComponent(email.trim())); if (mounted.current) setResults(value) }) }}><label htmlFor="account-email">Add an existing account</label><p className="quiet">Ask your player to sign in once, then look up their exact Google email.</p><div className="inline"><input id="account-email" type="email" required maxLength={254} value={email} onChange={e => { setEmail(e.target.value); setResults(null) }} placeholder="player@example.com" /><button disabled={busy}><SiteIcon name="search" />Find account</button></div>{results && (!results.length ? <p role="status">No matching account. They need to sign in first.</p> : results.map(p => <div key={p.id} className="lookup-result"><Avatar person={p} /><span>{p.name}</span><RolePicker value={addRole} label="Campaign role" onChange={setAddRole} /><button disabled={busy} onClick={() => void perform(() => membership(p.id, addRole))} type="button"><SiteIcon name="add" />Add to campaign</button></div>))}</form>}
    {loading ? <p role="status">Loading the table…</p> : <div className="roster">{players.map(p => <article className="player-row" key={p.id}><div className="player-identity"><Avatar person={p} /><div><h3>{p.name}</h3><span className="quiet">{roleName(p.role)}</span></div></div><div className="characters">{p.characters.length ? p.characters.map(c => <div className="character" key={c.id}>{imageSource(c.portrait) && <img src={imageSource(c.portrait)} alt="" />}<span>{c.name}</span></div>) : <span className="quiet">No characters yet</span>}</div>{gm && <div className="member-actions"><RolePicker value={p.role} disabled={busy} label={`Role for ${p.name}`} onChange={role => void perform(() => membership(p.accountId, role))} /><button disabled={busy} onClick={() => setRemove(p)} aria-label={`Remove ${p.name}`} className="danger"><SiteIcon name="remove" />Remove</button></div>}</article>)}</div>}
    {remove && <div className="panel remove-confirm" role="region" aria-label="Confirm membership removal"><h3>Remove {remove.name} from this campaign?</h3><p>This removes only their campaign membership and access. Their account and characters are retained.</p><div className="inline"><button className="danger" disabled={busy} onClick={() => void perform(async () => { await api(base + `/players/${remove.id}/remove`, me.csrfToken, 'POST', {}); if (mounted.current) { setRemove(null); setReload(v => v + 1); setNotice('Membership removed. Account and characters retained.') }; await onMembershipChange() })}><SiteIcon name="remove" />Remove membership</button><button disabled={busy} onClick={() => setRemove(null)}>Keep membership</button></div></div>}
  </section>
}
