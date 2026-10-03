import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { SiteIcon } from './icons'
import { api, ApiError, explain, imageSource, type Account, type Campaign, type MusicBrief, type MusicGeneration, type MusicPage, type MusicPlayback, type MusicPlaylist, type MusicStatus, type MusicTrack, type Operation, type Person, type Player } from './api'

function Avatar({ person }: { person: Person }) {
  const src = imageSource(person.avatar)
  return src ? <img className="avatar" src={src} alt="" referrerPolicy="no-referrer" /> : <span className="avatar initials" aria-hidden="true">{person.name.slice(0, 1)}</span>
}
function Feedback({ tone, children }: { tone: 'error' | 'notice'; children: React.ReactNode }) {
  return <p className={tone} role={tone === 'error' ? 'alert' : 'status'}><SiteIcon name={tone === 'error' ? 'warning' : 'check'} /><span>{children}</span></p>
}
function ErrorMessage({ error }: { error: string }) { return error ? <Feedback tone="error">{error}</Feedback> : null }
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
function AccountMenu({ me, signingOut, signout }: { me: Account; signingOut: boolean; signout: () => Promise<void> }) {
  return <details className="account-menu"><summary aria-label={`Account menu for ${me.name}`}><Avatar person={me} /><span>{me.name}</span><SiteIcon name="chevron" className="menu-chevron" /></summary><div><button onClick={() => void signout()} disabled={signingOut}><SiteIcon name={signingOut ? 'busy' : 'signout'} className={signingOut ? 'is-spinning' : undefined} />{signingOut ? 'Signing out…' : 'Sign out'}</button></div></details>
}
export function App() {
  const [me, setMe] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [path, setPath] = useState(window.location.pathname)
  const [signingOut, setSigningOut] = useState(false)
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
        <Link className="campaign-back" href="/" navigate={navigate} aria-label="Back to campaigns"><SiteIcon name="back" /><span>Campaigns</span></Link>
        <div className="campaign-dashboard-identity"><span className="eyebrow">{roleName(campaign.role).toUpperCase()}</span><div className="campaign-title-line"><h1>{campaign.name}</h1>{campaign.archived && <span className="badge"><SiteIcon name="archive" size={16} />Archived · available to your table</span>}</div></div>
        <div className="campaign-dashboard-controls">
          {gm && <details className="campaign-menu"><summary><span className="campaign-action-label"><span>Campaign </span>Actions</span><SiteIcon name="chevron" className="menu-chevron" /></summary><div><p>Archive hides this campaign from the default picker. Your table keeps access.</p><button disabled={busy || active} onClick={() => void perform(async () => { const value = await api<Campaign>(base + (campaign.archived ? '/restore' : '/archive'), me.csrfToken, 'POST', {}); if (mounted.current) { accept(value); setNotice(campaign.archived ? 'Campaign restored.' : 'Campaign archived. Your table can still open this link.') } })}><SiteIcon name={campaign.archived ? 'restore' : 'archive'} />{campaign.archived ? 'Restore campaign' : 'Archive campaign'}</button></div></details>}
          <AccountMenu me={me} signingOut={signingOut} signout={signout} />
        </div>
      </div>
      <nav className="campaign-tabs" aria-label="Campaign tabs">{['description', 'players', 'music'].map(t => <Link key={t} href={`${base}/${t}`} navigate={navigate} aria-current={tab === t ? 'page' : undefined}><SiteIcon name={t === 'description' ? 'description' : t === 'players' ? 'players' : 'music'} />{t === 'description' ? 'Description' : t === 'players' ? 'Players' : 'Music'}</Link>)}</nav>
    </header>
    <ErrorMessage error={error} />{notice && <Feedback tone="notice">{notice}</Feedback>}
    {tab === 'music' ? <MusicWorkspace id={id} gm={!!gm} me={me} /> : tab === 'players' ? <Players id={id} gm={!!gm} me={me} onMembershipChange={async () => { await refresh() }} /> : <div className="description-grid">
      <div>
        {gm ? <form className="description-form" onSubmit={e => { e.preventDefault(); if (active) return; void perform(async () => { const value = await api<Campaign>(base, me.csrfToken, 'PUT', draftRef.current); if (mounted.current) { accept(value, true); setNotice('Campaign saved.') } }) }}><span className="eyebrow">THE PREMISE</span><label htmlFor="campaign-name">Campaign name</label><input id="campaign-name" value={draft.name} onChange={e => edit('name', e.target.value)} required maxLength={120} /><label htmlFor="campaign-description">Description</label><textarea id="campaign-description" rows={12} maxLength={40000} value={draft.description} onChange={e => edit('description', e.target.value)} placeholder="Set the scene. What kind of world will your players step into?" /><label htmlFor="campaign-summary">Summary</label><textarea id="campaign-summary" rows={4} maxLength={1500} value={draft.summary} onChange={e => edit('summary', e.target.value)} placeholder="A short introduction for your table" /><div className="form-actions"><button className="primary" disabled={busy || active || !draft.name.trim() || !dirty.current}><SiteIcon name={busy ? 'busy' : 'save'} className={busy ? 'is-spinning' : undefined} />{busy ? 'Saving…' : 'Save changes'}</button><span className="quiet">{active ? 'Wait for the current request before saving.' : dirty.current ? 'Unsaved changes' : 'All changes saved'}</span></div></form> : <article className="read-description"><span className="eyebrow">THE PREMISE</span><h2>{campaign.name}</h2><p>{campaign.description || 'Your Game Master has not added a description yet.'}</p></article>}
        {gm && dirty.current && <details className="saved-version"><summary>Review latest saved version</summary><button disabled={busy || active} onClick={() => void perform(async () => { await refresh(); setNotice('The latest saved version is shown below. Your draft is kept.') })}>Refresh saved version</button><h3>{campaign.name}</h3><p>{campaign.description || 'No saved description.'}</p><p>{campaign.summary || 'No saved summary.'}</p>{draft.expectedRevision !== campaign.revision && <button disabled={busy || active} onClick={reviewLatest}>Keep draft against latest revision</button>}</details>}
      </div>
      <aside className="campaign-aside"><Artwork campaign={campaign} />
        {gm && <form className="image-form" onSubmit={e => { e.preventDefault(); if (!active && !busy) void start() }}><label htmlFor="image-prompt">A quick image idea</label><textarea id="image-prompt" rows={3} maxLength={4000} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="A lonely observatory above a sea of clouds…" disabled={busy || active} /><button className="accent" disabled={busy || active || !prompt.trim()}><SiteIcon name="generate" />Generate artwork</button></form>}
        <section className="summary-panel"><span className="eyebrow">AT A GLANCE</span><h2>The story so far</h2><p>{campaign.summary || 'A short introduction will appear here.'}</p>{campaign.summaryStale && <p className="quiet">The description changed. This summary may need updating.</p>}{gm && <><button disabled={busy || active || dirty.current || !campaign.description.trim()} onClick={() => void start({ kind: 'summary', prompt: '', expectedRevision: campaign.revision, operationId: crypto.randomUUID() })}><SiteIcon name="generate" />Generate summary</button><p className="quiet">Uses the saved description. Save your changes first.</p></>}</section>
        {(operation || receipt) && <section className="operation-panel" aria-live="polite"><span className="eyebrow">{(operation?.kind || receipt?.command.kind) === 'image' ? 'ARTWORK' : 'SUMMARY'}</span><p>{!operation ? receipt?.id ? 'Checking request…' : 'Request not confirmed. Retry to recover the same request.' : ({ pending: 'Request queued…', refining: 'Refining the idea…', generating: 'Creating the artwork…', saving: 'Saving the result…', completed: operation.applied ? 'Ready and saved.' : 'Ready. Newer campaign changes were retained; this result was not applied.', failed: operation.error || 'Generation failed. Your previous artwork is kept. Try again.' }[operation.state])}</p>{operation?.refinedPrompt && <details><summary>View refined prompt</summary><p>{operation.refinedPrompt}</p></details>}{receipt && !receipt.id && <button disabled={busy} onClick={() => void start(receipt.command)}>Retry same request</button>}<ErrorMessage error={pollError} />{pollError && <button onClick={() => setPollVersion(v => v + 1)}>Resume status</button>}</section>}
      </aside>
    </div>}
    <PlayerDock id={id} gm={!!gm} me={me} navigate={navigate} />
  </section>
}

function trackTime(ms: number) { const seconds = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
function MusicArtwork({ src, title }: { src: string | null; title: string }) { const safe = imageSource(src); return safe ? <img className="music-art" src={safe} alt={`${title} cover`} /> : <span className="music-art music-art-empty" aria-label={`${title} has no cover`}><SiteIcon name="music" /></span> }

function PlayerDock({ id, gm, me, navigate }: { id: string; gm: boolean; me: Account; navigate: (p: string) => void }) {
  const base = `/campaigns/${id}/music`
  const [state, setState] = useState<MusicPlayback | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() { try { setState(await api<MusicPlayback>(base + '/playback', '', 'GET', undefined, controller.signal)) } catch { /* The music page carries the actionable error. */ } if (!controller.signal.aborted) timer = setTimeout(poll, 5000) }
    void poll(); return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [base])
  async function command(action: 'play' | 'pause' | 'next' | 'previous') { if (busy || !gm) return; setBusy(true); try { setState(await api<MusicPlayback>(base + '/playback', me.csrfToken, 'POST', { action, deviceId: state?.deviceId })) } finally { setBusy(false) } }
  return <aside className="player-dock" aria-label="Campaign player">
    <Link className="player-now" href={`${base}`} navigate={navigate}><MusicArtwork src={state?.track?.imageUrl || null} title={state?.track?.name || 'Campaign music'} /><span><strong>{state?.track?.name || 'Nothing playing'}</strong><small>{state?.track ? `${state.track.artist}${state.deviceName ? ` · ${state.deviceName}` : ''}` : 'Open Music to set the scene'}</small></span></Link>
    {state?.track && <span className="player-progress">{trackTime(state.progressMs)} / {trackTime(state.track.durationMs)}</span>}
    {gm && <div className="player-controls"><button disabled={busy || !state?.track} aria-label="Previous track" onClick={() => void command('previous')}><SiteIcon name="previous" /></button><button className="player-primary" disabled={busy || !state?.track} aria-label={state?.playing ? 'Pause music' : 'Play music'} onClick={() => void command(state?.playing ? 'pause' : 'play')}><SiteIcon name={state?.playing ? 'pause' : 'play'} /></button><button disabled={busy || !state?.track} aria-label="Next track" onClick={() => void command('next')}><SiteIcon name="next" /></button></div>}
  </aside>
}

function MusicWorkspace({ id, gm, me }: { id: string; gm: boolean; me: Account }) {
  const base = `/campaigns/${id}/music`
  const generationReceiptKey = `storyboard:music-generation:${me.id}:${id}`
  const generationResume = useRef(readMusicGenerationReceipt(generationReceiptKey))
  const [status, setStatus] = useState<MusicStatus | null>(null)
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([])
  const [playlistPage, setPlaylistPage] = useState<MusicPage<MusicPlaylist> | null>(null)
  const [selected, setSelected] = useState<MusicPlaylist | null>(null)
  const [tracks, setTracks] = useState<MusicTrack[]>([])
  const [queue, setQueue] = useState<MusicTrack[]>([])
  const [results, setResults] = useState<MusicTrack[]>([])
  const [query, setQuery] = useState('')
  const [situation, setSituation] = useState(generationResume.current?.command.situation || '')
  const [brief, setBrief] = useState<MusicBrief | null>(generationResume.current?.command.brief || null)
  const [confirming, setConfirming] = useState(false)
  const [generation, setGeneration] = useState<MusicGeneration | null>(null)
  const [generationId, setGenerationId] = useState(generationResume.current?.id || '')
  const generationCommand = useRef<MusicGenerationCommand | null>(generationResume.current?.command || null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const c = new AbortController(); setError('')
    Promise.all([api<MusicStatus>(base + '/status', '', 'GET', undefined, c.signal), api<MusicPage<MusicPlaylist>>(base + '/playlists?offset=0&limit=50', '', 'GET', undefined, c.signal), api<MusicTrack[]>(base + '/queue', '', 'GET', undefined, c.signal)])
      .then(([s, p, q]) => { if (!c.signal.aborted) { setStatus(s); setPlaylistPage(p); setPlaylists(p.items); setQueue(q) } }).catch(e => { if (!c.signal.aborted) setError(explain(e)) })
    return () => c.abort()
  }, [base])
  useEffect(() => {
    if (!generationId || generation && ['completed', 'failed'].includes(generation.state)) return
    const c = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() { try { const value = await api<MusicGeneration>(`${base}/generations/${generationId}`, '', 'GET', undefined, c.signal); if (!c.signal.aborted) { setGeneration(value); if (!['completed', 'failed'].includes(value.state)) timer = setTimeout(poll, 1800) } } catch (e) { if (!c.signal.aborted) { setError(explain(e)); timer = setTimeout(poll, 3000) } } }
    timer = setTimeout(poll, 700); return () => { c.abort(); if (timer) clearTimeout(timer) }
  }, [base, generationId, generation?.state])
  async function choose(value: MusicPlaylist) { setSelected(value); setBusy('playlist'); setError(''); try { const p = await api<MusicPage<MusicTrack>>(`${base}/playlists/${encodeURIComponent(value.id)}/tracks?offset=0&limit=100`); setTracks(p.items) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function more() { if (!playlistPage?.hasMore || busy) return; setBusy('more'); try { const p = await api<MusicPage<MusicPlaylist>>(`${base}/playlists?offset=${playlists.length}&limit=50`); setPlaylists(v => [...v, ...p.items]); setPlaylistPage(p) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function find() { if (!situation.trim() || busy) return; setBusy('find'); setError(''); setBrief(null); try { const value = await api<{ query: string; tracks: MusicTrack[] }>(base + '/find', me.csrfToken, 'POST', { situation: situation.trim() }); setQuery(value.query); setResults(value.tracks) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function compose() { if (!situation.trim() || busy) return; setBusy('brief'); setError(''); setResults([]); setConfirming(false); setGeneration(null); setGenerationId(''); try { sessionStorage.removeItem(generationReceiptKey) } catch { /* resume hint only */ }; generationCommand.current = null; try { setBrief(await api<MusicBrief>(base + '/brief', me.csrfToken, 'POST', { situation: situation.trim() })) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function generate() { if (!brief || busy) return; setBusy('generate'); setError(''); const value = generationCommand.current ?? { operationId: crypto.randomUUID(), situation: situation.trim(), brief, confirmed: true as const }; generationCommand.current = value; try { const created = await api<MusicGeneration>(base + '/generations', me.csrfToken, 'POST', value); setGeneration(created); setGenerationId(created.id); try { sessionStorage.setItem(generationReceiptKey, JSON.stringify({ id: created.id, command: value })) } catch { /* resume hint only */ }; setConfirming(false) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function promote(candidate: string) { if (busy) return; setBusy('promote-' + candidate); setError(''); try { await api(`${base}/candidates/${candidate}/promote`, me.csrfToken, 'POST', {}); if (generation) setGeneration(await api<MusicGeneration>(`${base}/generations/${generation.id}`)); setNotice('Candidate saved as a reusable campaign track.') } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  async function command(action: 'play' | 'queue', track: MusicTrack) { if (busy || !gm) return; setBusy(track.id + action); setError(''); setNotice(''); try { await api(base + '/playback', me.csrfToken, 'POST', action === 'play' ? { action, trackUris: [track.uri] } : { action, uri: track.uri }); if (action === 'queue') setQueue(await api<MusicTrack[]>(base + '/queue')); setNotice(action === 'play' ? `Playing ${track.name}.` : `${track.name} added to the live queue.`) } catch (e) { setError(explain(e)) } finally { setBusy('') } }
  const visible = results.length ? results : tracks
  return <section className="music-workspace">
    <div className="music-heading"><div><span className="eyebrow">SCORE THE SESSION</span><h2>Music</h2><p>Build the atmosphere, manage the live queue, or turn the current scene into a new score.</p></div><div className={`music-service ${status?.connected ? 'is-connected' : ''}`}><span />{status?.connected ? `Spotify · ${status.displayName || 'Connected'}` : status?.error || 'Checking music service…'}</div></div>
    <ErrorMessage error={error} />{notice && <Feedback tone="notice">{notice}</Feedback>}
    <form className="scene-composer panel" onSubmit={e => { e.preventDefault(); void find() }}><label htmlFor="music-situation">What is happening right now?</label><textarea id="music-situation" value={situation} onChange={e => setSituation(e.target.value)} maxLength={2000} rows={3} placeholder="The party enters the drowned throne room while something enormous moves below the water…" /><div className="scene-actions"><button className="primary" disabled={!gm || !situation.trim() || !!busy}><SiteIcon name="search" />{busy === 'find' ? 'Reading the room…' : 'Find music'}</button><button type="button" className="accent" disabled={!gm || !situation.trim() || !!busy} onClick={() => void compose()}><SiteIcon name="generate" />{busy === 'brief' ? 'Shaping the score…' : 'Compose new'}</button><span className="quiet">Find uses Fast. Compose uses Deep and stops before any paid generation.</span></div></form>
    {brief && <section className="music-brief panel" aria-label="Generation brief"><div><span className="eyebrow">READY TO COMPOSE</span><h3>{brief.title}</h3><p>{brief.prompt}</p></div><dl><div><dt>Mood</dt><dd>{brief.mood}</dd></div><div><dt>Energy</dt><dd>{brief.energy}</dd></div><div><dt>Tempo</dt><dd>{brief.tempo}</dd></div><div><dt>Length</dt><dd>{trackTime(brief.durationSeconds * 1000)}</dd></div></dl><p className="brief-style"><strong>Style</strong> {brief.style}</p><p className="quiet">{brief.instruments.join(' · ')}</p>{!generation && !confirming && <button className="accent" onClick={() => setConfirming(true)} disabled={!!busy}><SiteIcon name="generate" />Generate candidates</button>}{confirming && <div className="generation-confirm"><strong>This submits paid music generation.</strong><span>The brief above is the exact prompt snapshot. Retrying this confirmation reuses the same operation ID.</span><div><button className="accent" onClick={() => void generate()} disabled={!!busy}>{busy === 'generate' ? 'Submitting…' : 'Confirm and generate'}</button><button onClick={() => setConfirming(false)} disabled={!!busy}>Cancel</button></div></div>}{!generation && <p className="quiet">No credits have been spent.</p>}</section>}
    {generation && <section className="candidate-panel panel" aria-live="polite"><div className="music-section-title"><div><span className="eyebrow">GENERATED CANDIDATES</span><h3>{generation.state === 'completed' ? 'Choose what becomes part of the campaign' : generation.state === 'failed' ? 'Generation stopped' : 'Your score is being created'}</h3></div><span>{generation.state}</span></div>{generation.error && <Feedback tone="error">{generation.error}</Feedback>}{!['completed', 'failed'].includes(generation.state) && <p role="status">{generation.state === 'ingesting' ? 'Saving every candidate into Leaf Assets…' : 'Generating with the confirmed brief…'}</p>}{generation.candidates.map(candidate => <article className="candidate-row" key={candidate.id}><MusicArtwork src={candidate.cover} title={candidate.title} /><div><strong>{candidate.title}</strong><small>{candidate.tags || brief?.style || 'generated score'} · {trackTime(candidate.durationSeconds * 1000)}</small><audio controls preload="metadata" src={candidate.audio}>Your browser cannot play this audio.</audio></div><button disabled={!!candidate.promotedTrack || !!busy} onClick={() => void promote(candidate.id)}><SiteIcon name="plus" />{candidate.promotedTrack ? 'Saved to library' : 'Save track'}</button></article>)}{generation.state === 'failed' && generationCommand.current && <button disabled={!!busy} onClick={() => void generate()}>Retry same operation</button>}{generation.state === 'completed' && <p className="quiet">Credits recorded: {generation.creditsConsumed}. Every candidate is already stored durably, even before promotion.</p>}</section>}
    <div className="music-layout">
      <aside className="music-library"><div className="music-section-title"><div><span className="eyebrow">LIBRARY</span><h3>Playlists</h3></div><span>{playlists.length}{playlistPage ? ` / ${playlistPage.total}` : ''}</span></div><div className="playlist-list">{playlists.map(p => <button key={p.id} className={selected?.id === p.id ? 'is-selected' : ''} onClick={() => void choose(p)}><MusicArtwork src={p.imageUrl} title={p.name} /><span><strong>{p.name}</strong><small>{p.trackCount} tracks</small></span></button>)}</div>{playlistPage?.hasMore && <button disabled={!!busy} onClick={() => void more()}>Load more playlists</button>}</aside>
      <section className="music-tracks"><div className="music-section-title"><div><span className="eyebrow">{results.length ? 'MATCHES' : 'SELECTED PLAYLIST'}</span><h3>{results.length ? `For “${query}”` : selected?.name || 'Choose a playlist'}</h3></div><span>{visible.length} tracks</span></div>{busy === 'playlist' ? <p role="status">Loading tracks…</p> : !visible.length ? <div className="music-empty"><SiteIcon name="music" size={32} /><p>{selected ? 'This playlist has no playable tracks.' : 'Select a playlist or describe the current scene.'}</p></div> : <div className="track-list">{visible.map((track, i) => <article className="track-row" key={`${track.id}-${i}`}><span className="track-number">{String(i + 1).padStart(2, '0')}</span><MusicArtwork src={track.imageUrl} title={track.name} /><div className="track-name"><strong>{track.name}</strong><small>{track.artist}{track.album ? ` · ${track.album}` : ''}</small></div><span className="track-duration">{trackTime(track.durationMs)}</span>{gm && <div className="track-actions"><button aria-label={`Play ${track.name}`} disabled={!!busy} onClick={() => void command('play', track)}><SiteIcon name="play" /></button><button aria-label={`Queue ${track.name}`} disabled={!!busy} onClick={() => void command('queue', track)}><SiteIcon name="queue" /></button></div>}</article>)}</div>}</section>
      <aside className="live-queue"><div className="music-section-title"><div><span className="eyebrow">LIVE</span><h3>Session queue</h3></div><span>{queue.length}</span></div><p className="quiet">Spotify keeps the authoritative queue. Add tracks here, then use the player dock from any campaign tab.</p>{queue.length ? <ol className="queue-list">{queue.map((track, i) => <li key={`${track.id}-${i}`}><span>{String(i + 1).padStart(2, '0')}</span><div><strong>{track.name}</strong><small>{track.artist}</small></div><span>{trackTime(track.durationMs)}</span></li>)}</ol> : <div className="queue-placeholder"><SiteIcon name="list" size={32} /><strong>The queue is clear</strong><span>Add a track when the next beat reveals itself.</span></div>}</aside>
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
  return <section className="players-panel"><div className="section-heading"><div><span className="eyebrow">AROUND THE TABLE</span><h2>Players & their characters</h2><p className="quiet">{players.length} {players.length === 1 ? 'person' : 'people'} in this campaign.</p></div></div><ErrorMessage error={error} />{error && <button disabled={busy} onClick={() => { setError(''); setReload(v => v + 1) }}>Reload roster</button>}{notice && <Feedback tone="notice">{notice}</Feedback>}
    {gm && <form className="roster-search panel" onSubmit={e => { e.preventDefault(); void perform(async () => { const value = await api<Person[]>(base + '/accounts?email=' + encodeURIComponent(email.trim())); if (mounted.current) setResults(value) }) }}><label htmlFor="account-email">Add an existing account</label><p className="quiet">Ask your player to sign in once, then look up their exact Google email.</p><div className="inline"><input id="account-email" type="email" required maxLength={254} value={email} onChange={e => { setEmail(e.target.value); setResults(null) }} placeholder="player@example.com" /><button disabled={busy}><SiteIcon name="search" />Find account</button></div>{results && (!results.length ? <p role="status">No matching account. They need to sign in first.</p> : results.map(p => <div key={p.id} className="lookup-result"><Avatar person={p} /><span>{p.name}</span><label className="sr-only" htmlFor="add-role">Campaign role</label><select id="add-role" value={addRole} onChange={e => setAddRole(e.target.value as 'gm' | 'player')}><option value="player">Player</option><option value="gm">Game Master</option></select><button disabled={busy} onClick={() => void perform(() => membership(p.id, addRole))} type="button"><SiteIcon name="add" />Add to campaign</button></div>))}</form>}
    {loading ? <p role="status">Loading the table…</p> : <div className="roster">{players.map(p => <article className="player-row" key={p.id}><div className="player-identity"><Avatar person={p} /><div><h3>{p.name}</h3><span className="quiet">{roleName(p.role)}</span></div></div><div className="characters">{p.characters.length ? p.characters.map(c => <div className="character" key={c.id}>{imageSource(c.portrait) && <img src={imageSource(c.portrait)} alt="" />}<span>{c.name}</span></div>) : <span className="quiet">No characters yet</span>}</div>{gm && <div className="member-actions"><label className="sr-only" htmlFor={`role-${p.id}`}>Role for {p.name}</label><select id={`role-${p.id}`} value={p.role} disabled={busy} onChange={e => void perform(() => membership(p.accountId, e.target.value as 'gm' | 'player'))}><option value="player">Player</option><option value="gm">Game Master</option></select><button disabled={busy} onClick={() => setRemove(p)} aria-label={`Remove ${p.name}`} className="danger"><SiteIcon name="remove" />Remove</button></div>}</article>)}</div>}
    {remove && <div className="panel remove-confirm" role="region" aria-label="Confirm membership removal"><h3>Remove {remove.name} from this campaign?</h3><p>This removes only their campaign membership and access. Their account and characters are retained.</p><div className="inline"><button className="danger" disabled={busy} onClick={() => void perform(async () => { await api(base + `/players/${remove.id}/remove`, me.csrfToken, 'POST', {}); if (mounted.current) { setRemove(null); setReload(v => v + 1); setNotice('Membership removed. Account and characters retained.') }; await onMembershipChange() })}><SiteIcon name="remove" />Remove membership</button><button disabled={busy} onClick={() => setRemove(null)}>Keep membership</button></div></div>}
  </section>
}
