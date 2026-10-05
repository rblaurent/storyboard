import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, explain, imageSource, type Account, type Visual, type VisualBrief, type VisualCandidate, type VisualGeneration, type VisualMatch, type VisualQueueItem, type VisualSession, type VisualSet } from './api'
import { SiteIcon } from './icons'
import { LiveFoldout } from './LiveFoldout'

const operation = () => crypto.randomUUID()
type VisualGenerationCommand = { operationId: string; situation: string; brief: VisualBrief; confirmed: true }
function readGenerationReceipt(key: string): { id: string; command: VisualGenerationCommand } | null {
  try { const value = JSON.parse(sessionStorage.getItem(key) || 'null'); return value && /^[0-9a-f-]{36}$/i.test(value.id) && /^[0-9a-f-]{36}$/i.test(value.command?.operationId) && typeof value.command?.situation === 'string' && value.command?.confirmed === true && Array.isArray(value.command?.brief?.frames) ? value : null } catch { return null }
}

function Message({ error = false, children }: { error?: boolean; children: React.ReactNode }) {
  return <p className={error ? 'error' : 'notice'} role={error ? 'alert' : 'status'}><SiteIcon name={error ? 'warning' : 'check'} /><span>{children}</span></p>
}

function VisualCard({ visual, actions, draggable, onDragStart }: { visual: Visual; actions?: React.ReactNode; draggable?: boolean; onDragStart?: React.DragEventHandler<HTMLElement> }) {
  return <article className="visual-card" draggable={draggable} onDragStart={onDragStart}>
    <img src={imageSource(visual.imageUrl)} alt={visual.name} />
    <div className="visual-card-copy"><strong>{visual.name}</strong><small>{visual.mood || visual.tags.join(' · ') || 'Campaign visual'}</small></div>
    {actions && <div className="visual-card-actions">{actions}</div>}
  </article>
}

function CandidateCard({ candidate, busy, promote }: { candidate: VisualCandidate; busy: boolean; promote: () => void }) {
  return <article className="visual-candidate">
    <img src={imageSource(candidate.imageUrl)} alt={candidate.title} />
    <div><strong>{candidate.title}</strong><small>{candidate.mood}{candidate.tags.length ? ` · ${candidate.tags.join(' · ')}` : ''}</small><p>{candidate.prompt}</p></div>
    <button disabled={busy || !!candidate.promotedVisual} onClick={promote}><SiteIcon name="plus" />{candidate.promotedVisual ? 'In library' : 'Save to library'}</button>
  </article>
}

export function VisualsWorkspace({ id, gm, me }: { id: string; gm: boolean; me: Account }) {
  const base = `/campaigns/${id}/visuals`
  const receiptKey = `storyboard:visual-generation:${me.id}:${id}`
  const resume = useRef(readGenerationReceipt(receiptKey))
  const [library, setLibrary] = useState<Visual[]>([])
  const [sets, setSets] = useState<VisualSet[]>([])
  const [session, setSession] = useState<VisualSession | null>(null)
  const [situation, setSituation] = useState(resume.current?.command.situation || '')
  const [suggestions, setSuggestions] = useState<Visual[]>([])
  const [brief, setBrief] = useState<VisualBrief | null>(resume.current?.command.brief || null)
  const [generation, setGeneration] = useState<VisualGeneration | null>(null)
  const [generationEntityId, setGenerationEntityId] = useState(resume.current?.id || '')
  const [newSetName, setNewSetName] = useState('')
  const [selectedSet, setSelectedSet] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const generationCommand = useRef<VisualGenerationCommand | null>(resume.current?.command || null)

  async function refresh() {
    const [nextLibrary, nextSets, nextSession] = await Promise.all([
      api<Visual[]>(base + '/library'), api<VisualSet[]>(base + '/sets'), api<VisualSession>(base + '/session'),
    ])
    setLibrary(nextLibrary); setSets(nextSets); setSession(nextSession)
  }
  useEffect(() => { let alive = true; void refresh().catch(c => { if (alive) setError(explain(c)) }); const timer = window.setInterval(() => { void api<VisualSession>(base + '/session').then(v => { if (alive) setSession(v) }).catch(() => {}) }, 2500); return () => { alive = false; window.clearInterval(timer) } }, [base])
  useEffect(() => {
    if (!generationEntityId || generation && ['completed', 'failed'].includes(generation.state)) return
    const timer = window.setInterval(() => { void api<VisualGeneration>(`${base}/generations/${generationEntityId}`).then(setGeneration).catch(c => setError(explain(c))) }, 1800)
    return () => window.clearInterval(timer)
  }, [base, generationEntityId, generation?.state])

  async function work(label: string, action: () => Promise<void>) {
    if (busy) return; setBusy(label); setError(''); setNotice('')
    try { await action() } catch (c) { setError(explain(c)); if (c instanceof ApiError && c.code === 'visual_session_changed') await refresh().catch(() => {}) } finally { setBusy('') }
  }
  async function find() { await work('find', async () => { const result = await api<VisualMatch>(base + '/match', me.csrfToken, 'POST', { situation }); setSuggestions(result.suggestions); setBrief(result.quickBrief); setNotice(result.suggestions.length ? 'Existing campaign images matched the scene.' : 'No library match yet. The quick image brief is ready.') }) }
  async function buildSet() { await work('brief', async () => { setBrief(await api<VisualBrief>(base + '/brief', me.csrfToken, 'POST', { situation })); setSuggestions([]); generationCommand.current = null; setGenerationEntityId(''); setGeneration(null); try { sessionStorage.removeItem(receiptKey) } catch { /* Resume hint only. */ } }) }
  async function generate() { if (!brief) return; await work('generate', async () => { const command = generationCommand.current ?? { operationId: operation(), situation, brief, confirmed: true as const }; generationCommand.current = command; const result = await api<VisualGeneration>(base + '/generations', me.csrfToken, 'POST', command); setGeneration(result); setGenerationEntityId(result.id); try { sessionStorage.setItem(receiptKey, JSON.stringify({ id: result.id, command })) } catch { /* Resume hint only. */ } }) }
  async function promote(candidate: VisualCandidate) { await work('promote', async () => { await api(base + `/candidates/${candidate.id}/promote`, me.csrfToken, 'POST', {}); setGeneration(value => value ? { ...value, candidates: value.candidates.map(c => c.id === candidate.id ? { ...c, promotedVisual: 'saved' } : c) } : value); await refresh(); setNotice(`${candidate.title} is now in the campaign library.`) }) }
  async function createSet(e: FormEvent) { e.preventDefault(); await work('set', async () => { const created = await api<VisualSet>(base + '/sets', me.csrfToken, 'POST', { name: newSetName, description: '', operationId: operation() }); setNewSetName(''); setSelectedSet(created.id); await refresh() }) }
  async function addToSet(visual: Visual) { if (!selectedSet) { setError('Choose or create a visual set first.'); return } await work('set-item', async () => { await api(`${base}/sets/${selectedSet}/items`, me.csrfToken, 'POST', { visualId: visual.id }); await refresh(); setNotice(`${visual.name} added to the visual set.`) }) }
  async function enqueue(value: { visualId?: string; setId?: string }, label: string) { await work('queue', async () => { await api<VisualQueueItem[]>(base + '/queue', me.csrfToken, 'POST', { ...value, operationId: operation() }); window.dispatchEvent(new CustomEvent('storyboard:visual-queue-changed', { detail: { campaignId: id } })); setNotice(`${label} added to the projection queue.`) }) }
  async function command(action: string, extra: Record<string, unknown> = {}) { if (!session) return; await work('command', async () => setSession(await api<VisualSession>(base + '/session/commands', me.csrfToken, 'POST', { action, operationId: operation(), expectedRevision: session.revision, ...extra }))) }
  function drag(event: React.DragEvent, value: { kind: 'visual' | 'set'; id: string; label: string }) { event.dataTransfer.setData('application/x-storyboard-visual', JSON.stringify(value)); event.dataTransfer.effectAllowed = 'copy' }

  return <section className="visuals-workspace">
    <header className="campaign-page-header"><div><h2>Visuals</h2><p>Build the atmosphere, curate visual sets, and control what the table sees.</p></div><a className="button projection-link" href={`/campaigns/${id}/projection`} target="_blank" rel="noreferrer"><SiteIcon name="projector" />Open projection</a></header>
    {error && <Message error>{error}</Message>}{notice && <Message>{notice}</Message>}
    {gm && <form className="visual-scene panel" onSubmit={e => { e.preventDefault(); void find() }}><label htmlFor="visual-situation">What should the room look like?</label><textarea id="visual-situation" rows={3} maxLength={2000} value={situation} onChange={e => setSituation(e.target.value)} placeholder="The drowned throne room lies silent, moonlight filtering through black water above…" /><div className="scene-actions"><button className="primary" disabled={!situation.trim() || !!busy}><SiteIcon name="search" />{busy === 'find' ? 'Reading the scene…' : 'Cue image'}</button><button type="button" className="accent" disabled={!situation.trim() || !!busy} onClick={() => void buildSet()}><SiteIcon name="generate" />{busy === 'brief' ? 'Designing the set…' : 'Build visual set'}</button><span className="quiet">Cue uses Fast. Build uses Deep and stops before image generation.</span></div></form>}
    {suggestions.length > 0 && <section className="visual-suggestions"><div className="visual-section-title"><div><span className="eyebrow">MATCHED FROM THE LIBRARY</span><h3>Ready without rendering</h3></div></div><div className="visual-grid">{suggestions.map(v => <VisualCard key={v.id} visual={v} actions={gm && <><button onClick={() => void command('show', { visualId: v.id })}><SiteIcon name="projector" />Show</button><button onClick={() => void enqueue({ visualId: v.id }, v.name)}><SiteIcon name="queue" />Queue</button></>} />)}</div></section>}
    {brief && <section className="visual-brief panel"><div className="visual-section-title"><div><span className="eyebrow">GENERATION BRIEF</span><input aria-label="Visual set title" value={brief.title} onChange={e => setBrief({ ...brief, title: e.target.value })} /></div><div className="brief-controls"><label>Every <input type="number" min={5} max={300} value={brief.intervalSeconds} onChange={e => setBrief({ ...brief, intervalSeconds: Number(e.target.value) })} /> sec</label><select aria-label="Transition" value={brief.transition} onChange={e => setBrief({ ...brief, transition: e.target.value as 'cut' | 'crossfade' })}><option value="crossfade">Crossfade</option><option value="cut">Cut</option></select></div></div><div className="brief-frames">{brief.frames.map((frame, index) => <article key={index}><input aria-label={`Frame ${index + 1} title`} value={frame.title} onChange={e => setBrief({ ...brief, frames: brief.frames.map((f, i) => i === index ? { ...f, title: e.target.value } : f) })} /><textarea aria-label={`Frame ${index + 1} prompt`} rows={4} value={frame.prompt} onChange={e => setBrief({ ...brief, frames: brief.frames.map((f, i) => i === index ? { ...f, prompt: e.target.value } : f) })} /><small>{frame.mood} · {frame.tags.join(' · ')}</small></article>)}</div>{gm && <button className="accent" disabled={!!busy} onClick={() => void generate()}><SiteIcon name="generate" />{busy === 'generate' ? 'Submitting…' : `Generate ${brief.frames.length} images`}</button>}<p className="quiet">This is the exact frozen brief. Generation begins only when you press the button.</p></section>}
    {generation && <section className="visual-generation panel" aria-live="polite"><div className="visual-section-title"><div><span className="eyebrow">GENERATED IMAGES</span><h3>{generation.state === 'completed' ? 'Choose what joins the campaign' : generation.state === 'failed' ? 'Generation stopped' : 'Rendering the visual set'}</h3></div><span>{generation.state}</span></div>{generation.error && <Message error>{generation.error}</Message>}{!['completed', 'failed'].includes(generation.state) && <p role="status">Each completed image is saved immediately into Leaf Assets.</p>}<div className="candidate-grid">{generation.candidates.map(c => <CandidateCard key={c.id} candidate={c} busy={!!busy} promote={() => void promote(c)} />)}</div></section>}
    <div className="visuals-layout">
      <aside className="visual-sets"><div className="visual-section-title"><div><span className="eyebrow">CAMPAIGN</span><h3>Visual sets</h3></div></div>{gm && <form className="visual-set-create" onSubmit={createSet}><input value={newSetName} onChange={e => setNewSetName(e.target.value)} maxLength={160} placeholder="New visual set" aria-label="New visual set name" /><button disabled={!newSetName.trim() || !!busy}><SiteIcon name="plus" />Create</button></form>}<div className="visual-set-list">{sets.map(set => <article key={set.id} className={selectedSet === set.id ? 'is-selected' : ''} draggable={gm} onDragStart={e => drag(e, { kind: 'set', id: set.id, label: set.name })}><button onClick={() => setSelectedSet(set.id)}><SiteIcon name="images" /><span><strong>{set.name}</strong><small>{set.imageCount} images</small></span></button>{gm && <button className="icon-button" disabled={!set.imageCount || !!busy} aria-label={`Enqueue ${set.name}`} onClick={() => void enqueue({ setId: set.id }, set.name)}><SiteIcon name="queue" /></button>}</article>)}</div></aside>
      <section className="visual-library"><div className="visual-section-title"><div><span className="eyebrow">CAMPAIGN LIBRARY</span><h3>Atmosphere images</h3></div><span>{library.length}</span></div>{!library.length ? <div className="visual-empty"><SiteIcon name="images" size={32} /><strong>No visuals yet</strong><span>Build a visual set above, then save the images you want to keep.</span></div> : <div className="visual-grid">{library.map(v => <VisualCard key={v.id} visual={v} draggable={gm} onDragStart={e => drag(e, { kind: 'visual', id: v.id, label: v.name })} actions={gm && <><button aria-label={`Show ${v.name}`} onClick={() => void command('show', { visualId: v.id })}><SiteIcon name="projector" /></button><button aria-label={`Queue ${v.name}`} onClick={() => void enqueue({ visualId: v.id }, v.name)}><SiteIcon name="queue" /></button><button aria-label={`Add ${v.name} to selected set`} disabled={!selectedSet} onClick={() => void addToSet(v)}><SiteIcon name="plus" /></button></>} />)}</div>}</section>
    </div>
  </section>
}

export function LiveVisual({ campaignId, csrfToken, canControl, navigate, open, panelExpanded, toggleFoldout }: { campaignId: string; csrfToken: string; canControl: boolean; navigate: (path: string) => void; open: boolean; panelExpanded: boolean; toggleFoldout: () => void }) {
  const [session, setSession] = useState<VisualSession | null>(null)
  const [queue, setQueue] = useState<VisualQueueItem[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [draggingOver, setDraggingOver] = useState(false)
  async function read() {
    const [nextSession, nextQueue] = await Promise.all([api<VisualSession>(`/campaigns/${campaignId}/visuals/session`), api<VisualQueueItem[]>(`/campaigns/${campaignId}/visuals/queue`)])
    setSession(nextSession); setQueue(nextQueue)
  }
  useEffect(() => {
    let alive = true
    const refresh = () => void Promise.all([api<VisualSession>(`/campaigns/${campaignId}/visuals/session`), api<VisualQueueItem[]>(`/campaigns/${campaignId}/visuals/queue`)]).then(([nextSession, nextQueue]) => { if (alive) { setSession(nextSession); setQueue(nextQueue) } }).catch(() => {})
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ campaignId?: string }>).detail
      if (alive && (!detail?.campaignId || detail.campaignId === campaignId)) refresh()
    }
    refresh()
    const timer = window.setInterval(refresh, 3000)
    window.addEventListener('storyboard:visual-queue-changed', changed)
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('storyboard:visual-queue-changed', changed) }
  }, [campaignId])
  async function work(label: string, action: () => Promise<void>) {
    if (!canControl || busy) return
    setBusy(label); setError('')
    try { await action() }
    catch (cause) { setError(explain(cause)); if (cause instanceof ApiError && cause.code === 'visual_session_changed') await read().catch(() => {}) }
    finally { setBusy(''); setDraggingOver(false) }
  }
  async function enqueue(value: { visualId?: string; setId?: string }) {
    await work('enqueue', async () => setQueue(await api<VisualQueueItem[]>(`/campaigns/${campaignId}/visuals/queue`, csrfToken, 'POST', { ...value, operationId: operation() })))
  }
  async function command(action: string, extra: Record<string, unknown> = {}) {
    if (!session) return
    await work(action, async () => setSession(await api<VisualSession>(`/campaigns/${campaignId}/visuals/session/commands`, csrfToken, 'POST', { action, operationId: operation(), expectedRevision: session.revision, ...extra })))
  }
  function drop(event: React.DragEvent) {
    event.preventDefault(); setDraggingOver(false)
    if (!canControl) return
    try {
      const value = JSON.parse(event.dataTransfer.getData('application/x-storyboard-visual')) as { kind: 'visual' | 'set'; id: string }
      void enqueue(value.kind === 'visual' ? { visualId: value.id } : { setId: value.id })
    } catch { /* Ignore foreign drags. */ }
  }
  const title = session?.blackout ? 'Blackout' : session?.current?.name || 'Nothing showing'
  return <LiveFoldout module="visuals" label="Visuals" icon="projector" open={open} panelExpanded={panelExpanded} toggle={toggleFoldout} className={`live-visual${session?.blackout ? ' is-blackout' : ''}${draggingOver ? ' is-drop-target' : ''}`} aria-label="Live visuals" data-live-drop="visuals" onDragEnter={() => canControl && setDraggingOver(true)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraggingOver(false) }} onDragOver={event => { if (!canControl) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={drop} status={session?.playing && <i className="live-module-active" aria-label="Slideshow playing" />}>
    <button className="live-visual-preview" onClick={() => navigate(`/campaigns/${campaignId}/visuals`)} aria-label={`Open Visuals. ${title}`}>
      {session?.blackout ? <span className="live-visual-blank" /> : session?.current ? <img src={imageSource(session.current.imageUrl)} alt="" /> : <span className="live-visual-empty"><SiteIcon name="images" size={32} /></span>}
      <span><small>{session?.playing ? 'SLIDESHOW PLAYING' : 'NOW SHOWING'}</small><strong>{title}</strong></span>
    </button>
    {canControl && <div className="live-projection-controls"><button aria-label="Previous visual" disabled={!!busy || !queue.length} onClick={() => void command('previous')}><SiteIcon name="previous" /></button><button className="primary" aria-label={session?.playing ? 'Pause slideshow' : 'Play slideshow'} disabled={!!busy || !queue.length} onClick={() => void command(session?.playing ? 'pause' : 'play')}><SiteIcon name={session?.playing ? 'pause' : 'play'} /></button><button aria-label="Next visual" disabled={!!busy || !queue.length} onClick={() => void command('next')}><SiteIcon name="next" /></button><button className={session?.blackout ? 'is-active' : ''} aria-label="Toggle blackout" disabled={!!busy} onClick={() => void command('blackout')}><SiteIcon name="blackout" /></button></div>}
    <div className="live-queue-panel" aria-label="Projection queue">
      <div className="live-queue-heading"><strong>Projection queue</strong><span>{queue.length}</span></div>
      {error && <p className="live-module-error" role="alert">{error}</p>}
      {queue.length ? <ol className="live-visual-queue">{queue.map((item, index) => <li key={item.queueId} className={session?.currentQueueId === item.queueId ? 'is-current' : ''}><button disabled={!canControl || !!busy} onClick={() => void command('show', { visualId: item.visual.id })}><img src={imageSource(item.visual.imageUrl)} alt="" /><span><strong>{item.visual.name}</strong><small>{String(index + 1).padStart(2, '0')}</small></span></button>{canControl && <button className="icon-button" disabled={!!busy} aria-label={`Remove ${item.visual.name} from queue`} onClick={() => void work('remove', async () => setQueue(await api<VisualQueueItem[]>(`/campaigns/${campaignId}/visuals/queue/${item.queueId}/remove`, csrfToken, 'POST', {})))}><SiteIcon name="close" size={16} /></button>}</li>)}</ol> : <div className="live-drop-empty"><SiteIcon name="images" /><span>{canControl ? 'Drop an image or visual set here' : 'The projection queue is empty'}</span></div>}
      {canControl && queue.length > 0 && <button className="live-clear-queue" disabled={!!busy} onClick={() => void work('clear', async () => setQueue(await api<VisualQueueItem[]>(`/campaigns/${campaignId}/visuals/queue/clear`, csrfToken, 'POST', {})))}>Clear queue</button>}
    </div>
  </LiveFoldout>
}

export function ProjectionView({ campaignId }: { campaignId: string }) {
  const [session, setSession] = useState<VisualSession | null>(null)
  const [error, setError] = useState('')
  const [awake, setAwake] = useState(false)
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)
  useEffect(() => { let alive = true; const read = () => void api<VisualSession>(`/campaigns/${campaignId}/visuals/session`).then(v => { if (alive) { setSession(v); setError('') } }).catch(c => { if (alive) setError(explain(c)) }); read(); const timer = window.setInterval(read, 1500); return () => { alive = false; window.clearInterval(timer); void wakeLock.current?.release() } }, [campaignId])
  async function fullscreen() { await document.documentElement.requestFullscreen().catch(() => {}); try { const lock = await (navigator as Navigator & { wakeLock?: { request: (kind: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen'); if (lock) { wakeLock.current = lock; setAwake(true) } } catch { /* Fullscreen still works without wake lock. */ } }
  return <main className={`projection-view transition-${session?.transition || 'crossfade'}${session?.blackout ? ' is-blackout' : ''}`}>
    {session?.current && !session.blackout ? <img key={session.current.id} src={imageSource(session.current.imageUrl)} alt={session.current.name} /> : <div className="projection-blank">{error ? <span>{error}</span> : !session?.blackout && <><SiteIcon name="projector" size={32} /><span>Waiting for the first visual cue…</span></>}</div>}
    <button className="projection-fullscreen" onClick={() => void fullscreen()} aria-label="Enter fullscreen"><SiteIcon name="fullscreen" />{awake ? 'Screen awake' : 'Fullscreen'}</button>
  </main>
}
