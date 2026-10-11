import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { api, ApiError, explain, imageSource, type Account, type MusicPlayback, type MusicQueueItem, type MusicTrack, type Visual, type VisualBrief, type VisualCandidate, type VisualGeneration, type VisualMatch, type VisualQueueItem, type VisualSession, type VisualSet } from './api'
import { SiteIcon } from './icons'
import { LiveFoldout } from './LiveFoldout'
import { AgentDirection } from './AgentDirection'
import { VisualIdentity } from './VisualIdentity'
import { spotifyWebPlaybackSdk, type SpotifyWebPlayer } from './spotify'

const operation = () => crypto.randomUUID()
type ProjectionFrame = { visual: Visual; source: string; motion: number; durationSeconds: number }
type ProjectionMotionStyle = CSSProperties & { '--projection-motion-duration': string }
type ProjectionFadeStyle = CSSProperties & { '--projection-fade-duration': string }

function projectionHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return hash >>> 0
}
function projectionFrame(visual: Visual): ProjectionFrame {
  const hash = projectionHash(visual.id)
  return { visual, source: imageSource(visual.imageUrl) || visual.imageUrl, motion: hash % 6, durationSeconds: 26 + ((hash >>> 8) % 9) }
}
function projectionFadeDuration(intervalSeconds: number) { return Math.min(2200, Math.max(1200, intervalSeconds * 90)) }
function ProjectionLayer({ frame, className, hidden = false }: { frame: ProjectionFrame; className: string; hidden?: boolean }) {
  const style = { '--projection-motion-duration': `${frame.durationSeconds}s` } as ProjectionMotionStyle
  return <div className={`projection-layer ${className}`} aria-hidden={hidden || undefined}>
    <img className={`projection-motion projection-motion-${frame.motion}`} style={style} src={frame.source} alt={hidden ? '' : frame.visual.name} data-motion={frame.motion} />
  </div>
}
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
    {gm && <VisualIdentity campaignId={id} csrfToken={me.csrfToken} />}
    {gm && <AgentDirection campaignId={id} capability="visuals" csrfToken={me.csrfToken} title="Visual Agent direction" />}
    {error && <Message error>{error}</Message>}{notice && <Message>{notice}</Message>}
    {gm && <form className="visual-scene panel" onSubmit={e => { e.preventDefault(); void find() }}><label htmlFor="visual-situation">What should the room look like?</label><textarea id="visual-situation" rows={3} maxLength={2000} value={situation} onChange={e => setSituation(e.target.value)} placeholder="The drowned throne room lies silent, moonlight filtering through black water above…" /><div className="scene-actions"><button className="primary" disabled={!situation.trim() || !!busy}><SiteIcon name="search" />{busy === 'find' ? 'Reading the scene…' : 'Cue image'}</button><button type="button" className="accent" disabled={!situation.trim() || !!busy} onClick={() => void buildSet()}><SiteIcon name="generate" />{busy === 'brief' ? 'Designing the set…' : 'Build visual set'}</button><span className="quiet">Cue uses Fast. Build uses Deep and stops before image generation.</span></div></form>}
    {suggestions.length > 0 && <section className="visual-suggestions"><div className="visual-section-title"><div><span className="eyebrow">MATCHED FROM THE LIBRARY</span><h3>Ready without rendering</h3></div></div><div className="visual-grid">{suggestions.map(v => <VisualCard key={v.id} visual={v} actions={gm && <><button onClick={() => void command('show', { visualId: v.id })}><SiteIcon name="projector" />Show</button><button onClick={() => void enqueue({ visualId: v.id }, v.name)}><SiteIcon name="queue" />Queue</button></>} />)}</div></section>}
    {brief && <section className="visual-brief panel"><div className="visual-section-title"><div><span className="eyebrow">GENERATION BRIEF</span><input aria-label="Visual set title" value={brief.title} onChange={e => setBrief({ ...brief, title: e.target.value })} /></div><div className="brief-controls"><span className="projection-format">16:9 projection · 1280×720</span><label>Every <input type="number" min={5} max={300} value={brief.intervalSeconds} onChange={e => setBrief({ ...brief, intervalSeconds: Number(e.target.value) })} /> sec</label><select aria-label="Transition" value={brief.transition} onChange={e => setBrief({ ...brief, transition: e.target.value as 'cut' | 'crossfade' })}><option value="crossfade">Crossfade</option><option value="cut">Cut</option></select></div></div><div className="brief-frames">{brief.frames.map((frame, index) => <article key={index}><input aria-label={`Frame ${index + 1} title`} value={frame.title} onChange={e => setBrief({ ...brief, frames: brief.frames.map((f, i) => i === index ? { ...f, title: e.target.value } : f) })} /><textarea aria-label={`Frame ${index + 1} prompt`} rows={4} value={frame.prompt} onChange={e => setBrief({ ...brief, frames: brief.frames.map((f, i) => i === index ? { ...f, prompt: e.target.value } : f) })} /><small>{frame.mood} · {frame.tags.join(' · ')}</small></article>)}</div>{gm && <button className="accent" disabled={!!busy} onClick={() => void generate()}><SiteIcon name="generate" />{busy === 'generate' ? 'Submitting…' : `Generate ${brief.frames.length} images`}</button>}<p className="quiet">This is the exact frozen brief. Generation begins only when you press the button.</p></section>}
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
  const [intervalDraft, setIntervalDraft] = useState('30')
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
  useEffect(() => { if (session) setIntervalDraft(String(session.intervalSeconds)) }, [session?.intervalSeconds])
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
  function launch() {
    if (!queue.length || !session || busy) return
    window.open(`/campaigns/${campaignId}/projection#autostart`, '_blank', 'noopener')
    if (!session.playing) void command('play')
  }
  function configureInterval() {
    const intervalSeconds = Math.min(300, Math.max(5, Math.round(Number(intervalDraft) || session?.intervalSeconds || 30)))
    setIntervalDraft(String(intervalSeconds))
    if (session && intervalSeconds !== session.intervalSeconds) void command('configure', { intervalSeconds })
  }
  const title = session?.blackout ? 'Blackout' : session?.current?.name || 'Nothing showing'
  return <LiveFoldout module="visuals" label="Visuals" icon="projector" open={open} panelExpanded={panelExpanded} toggle={toggleFoldout} className={`live-visual${session?.blackout ? ' is-blackout' : ''}${draggingOver ? ' is-drop-target' : ''}`} aria-label="Live visuals" data-live-drop="visuals" onDragEnter={() => canControl && setDraggingOver(true)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraggingOver(false) }} onDragOver={event => { if (!canControl) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={drop} status={session?.playing && <i className="live-module-active" aria-label="Slideshow playing" />}>
    <button className="live-visual-preview" onClick={() => navigate(`/campaigns/${campaignId}/visuals`)} aria-label={`Open Visuals. ${title}`}>
      {session?.blackout ? <span className="live-visual-blank" /> : session?.current ? <img src={imageSource(session.current.imageUrl)} alt="" /> : <span className="live-visual-empty"><SiteIcon name="images" size={32} /></span>}
      <span><small>{session?.playing ? 'SLIDESHOW PLAYING' : 'NOW SHOWING'}</small><strong>{title}</strong></span>
    </button>
    {canControl && <><div className="live-slideshow-launch"><button className="primary" disabled={!!busy || !queue.length} onClick={launch}><SiteIcon name="projector" />{session?.playing ? 'Open slideshow' : 'Start slideshow'}</button><label><span>Slide duration</span><span><input aria-label="Slide duration in seconds" type="number" min={5} max={300} value={intervalDraft} onChange={event => setIntervalDraft(event.target.value)} onBlur={configureInterval} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); configureInterval(); event.currentTarget.blur() } }} /> sec</span></label></div><div className="live-projection-controls"><button aria-label="Previous visual" disabled={!!busy || !queue.length} onClick={() => void command('previous')}><SiteIcon name="previous" /></button><button aria-label={session?.playing ? 'Pause slideshow' : 'Play slideshow'} disabled={!!busy || !queue.length} onClick={() => void command(session?.playing ? 'pause' : 'play')}><SiteIcon name={session?.playing ? 'pause' : 'play'} /></button><button aria-label="Next visual" disabled={!!busy || !queue.length} onClick={() => void command('next')}><SiteIcon name="next" /></button><button className={session?.blackout ? 'is-active' : ''} aria-label="Toggle blackout" disabled={!!busy} onClick={() => void command('blackout')}><SiteIcon name="blackout" /></button></div></>}
    <div className="live-queue-panel" aria-label="Projection queue">
      <div className="live-queue-heading"><strong>Projection queue</strong><span>{queue.length}</span></div>
      {error && <p className="live-module-error" role="alert">{error}</p>}
      {queue.length ? <ol className="live-visual-queue">{queue.map((item, index) => <li key={item.queueId} className={session?.currentQueueId === item.queueId ? 'is-current' : ''}><button disabled={!canControl || !!busy} onClick={() => void command('show', { visualId: item.visual.id })}><img src={imageSource(item.visual.imageUrl)} alt="" /><span><strong>{item.visual.name}</strong><small>{String(index + 1).padStart(2, '0')}</small></span></button>{canControl && <button className="icon-button" disabled={!!busy} aria-label={`Remove ${item.visual.name} from queue`} onClick={() => void work('remove', async () => setQueue(await api<VisualQueueItem[]>(`/campaigns/${campaignId}/visuals/queue/${item.queueId}/remove`, csrfToken, 'POST', {})))}><SiteIcon name="close" size={16} /></button>}</li>)}</ol> : <div className="live-drop-empty"><SiteIcon name="images" /><span>{canControl ? 'Drop an image or visual set here' : 'The projection queue is empty'}</span></div>}
      {canControl && queue.length > 0 && <button className="live-clear-queue" disabled={!!busy} onClick={() => void work('clear', async () => setQueue(await api<VisualQueueItem[]>(`/campaigns/${campaignId}/visuals/queue/clear`, csrfToken, 'POST', {})))}>Clear queue</button>}
    </div>
  </LiveFoldout>
}

function musicTime(ms: number) { const seconds = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }

function ProjectionMusic({ campaignId, csrfToken }: { campaignId: string; csrfToken: string }) {
  const [queue, setQueue] = useState<MusicQueueItem[]>([])
  const [track, setTrack] = useState<MusicTrack | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [coverFailed, setCoverFailed] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  const spotify = useRef<SpotifyWebPlayer | null>(null)
  const spotifyCreating = useRef<Promise<SpotifyWebPlayer> | null>(null)
  const spotifyDeviceId = useRef('')
  const disposed = useRef(false)
  const ownsPlayback = useRef(false)

  async function ensureSpotify() {
    if (spotify.current && spotifyDeviceId.current) return spotify.current
    if (spotifyCreating.current) return spotifyCreating.current
    spotifyCreating.current = spotifyWebPlaybackSdk().then(() => new Promise<SpotifyWebPlayer>((resolve, reject) => {
      if (disposed.current || !window.Spotify) { reject(new Error('spotify_sdk_unavailable')); return }
      const player = new window.Spotify.Player({
        name: 'Storyboard · Slideshow', volume: 0.72, enableMediaSession: true,
        getOAuthToken: callback => { void api<{ accessToken: string }>(`/campaigns/${campaignId}/music/browser-player`, csrfToken, 'POST', {}).then(value => callback(value.accessToken)).catch(() => callback('')) },
      })
      spotify.current = player
      let settled = false
      const timer = window.setTimeout(() => fail('Spotify took too long to connect.'), 12000)
      const fail = (message: string) => { setError(message); if (!settled) { settled = true; window.clearTimeout(timer); reject(new Error('spotify_player_unavailable')) } }
      player.addListener('ready', ({ device_id }: { device_id: string }) => { if (disposed.current) { player.disconnect(); return }; if (settled) return; settled = true; window.clearTimeout(timer); spotifyDeviceId.current = device_id; resolve(player) })
      player.addListener('not_ready', () => { spotifyDeviceId.current = ''; setPlaying(false); setError('The slideshow audio device went offline. Select Play to reconnect it.') })
      player.addListener('player_state_changed', state => { if (!state) return; setPlaying(!state.paused); setProgress(state.position || 0) })
      player.addListener('initialization_error', () => fail('This browser cannot start protected Spotify playback.'))
      player.addListener('authentication_error', () => fail('Reconnect Spotify in Smart Home settings to play it here.'))
      player.addListener('account_error', () => fail('Spotify playback here requires a Premium account.'))
      player.addListener('playback_error', () => setError('Spotify could not play this track.'))
      player.addListener('autoplay_failed', () => { setPlaying(false); setError('Select Play once to let this screen output audio.') })
      void player.connect().then(connected => { if (!connected) fail('Spotify could not connect the slideshow player.') }).catch(() => fail('Spotify could not connect the slideshow player.'))
    })).catch(cause => { spotify.current?.disconnect(); spotify.current = null; spotifyDeviceId.current = ''; throw cause }).finally(() => { spotifyCreating.current = null })
    return spotifyCreating.current
  }

  async function play(value: MusicTrack) {
    ownsPlayback.current = true; setTrack(value); setCoverFailed(false); setProgress(0); setError('')
    if (value.sourceKind === 'generated' && value.audioUrl) {
      void spotify.current?.pause(); if (!audio.current) return; audio.current.src = value.audioUrl; audio.current.currentTime = 0
      try { await audio.current.play(); setPlaying(true) } catch { setPlaying(false); setError('Select Play once to let this screen output audio.') }
      return
    }
    if (!value.uri) { setError('This track has no playable source.'); return }
    audio.current?.pause()
    try {
      const player = await ensureSpotify(); await player.activateElement()
      await api(`/campaigns/${campaignId}/music/playback`, csrfToken, 'POST', { action: 'play', trackUris: [value.uri], deviceId: spotifyDeviceId.current })
      setPlaying(true)
    } catch (cause) { setPlaying(false); setError(cause instanceof ApiError ? explain(cause) : 'Spotify could not play in this slideshow.') }
  }

  useEffect(() => {
    disposed.current = false
    let alive = true
    Promise.all([api<MusicQueueItem[]>(`/campaigns/${campaignId}/music/queue`), api<MusicPlayback>(`/campaigns/${campaignId}/music/playback`)]).then(([items, state]) => {
      if (!alive) return
      setQueue(items)
      const autostart = window.location.hash === '#autostart'
      if (autostart) history.replaceState(null, '', window.location.pathname + window.location.search)
      if (autostart && items.length) void play(items[0].track)
      else if (state.track) { setTrack(state.track); setPlaying(state.playing); setProgress(state.progressMs) }
      else if (items.length) setTrack(items[0].track)
    }).catch(cause => { if (alive) setError(explain(cause)) })
    return () => { alive = false; disposed.current = true; spotify.current?.disconnect(); spotify.current = null; spotifyDeviceId.current = ''; audio.current?.pause() }
  }, [campaignId, csrfToken])

  useEffect(() => {
    if (ownsPlayback.current) return
    let alive = true
    const read = () => void api<MusicPlayback>(`/campaigns/${campaignId}/music/playback`).then(state => { if (alive && state.track) { setTrack(state.track); setPlaying(state.playing); setProgress(state.progressMs) } }).catch(() => {})
    const timer = window.setInterval(read, 2000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [campaignId])

  async function toggle() {
    const value = track || queue[0]?.track
    if (!value) return
    if (!ownsPlayback.current) { await play(value); return }
    if (value.sourceKind === 'generated') {
      if (!audio.current) return
      if (playing) audio.current.pause(); else { try { await audio.current.play() } catch { setError('This screen needs one click before it can output audio.') } }
      return
    }
    try { const player = await ensureSpotify(); await player.activateElement(); await player.togglePlay() } catch { setError('Spotify could not change playback.') }
  }

  if (!track) return error ? <p className="projection-music-error" role="alert">{error}</p> : null
  const hash = projectionHash(track.id || `${track.name}:${track.artist}`)
  const heights = Array.from({ length: 64 }, (_, index) => 22 + ((hash >>> (index % 24)) + index * 17) % 70)
  const percentage = track.durationMs > 0 ? Math.min(100, progress / track.durationMs * 100) : 0
  const cover = imageSource(track.imageUrl)
  const wave = <>{heights.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</>
  return <section className={`projection-music${playing ? ' is-playing' : ''}`} aria-label="Projection music player">
    <audio ref={audio} hidden onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={event => setProgress(event.currentTarget.currentTime * 1000)} onEnded={() => setPlaying(false)} />
    {cover && !coverFailed ? <img src={cover} alt={`${track.name} cover`} onError={() => setCoverFailed(true)} /> : <span className="projection-music-cover"><SiteIcon name={track.sourceKind === 'spotify' ? 'spotify' : 'music'} size={32} /></span>}
    <div className="projection-music-copy"><small>{playing ? 'NOW PLAYING' : 'READY'}</small><strong>{track.name}</strong><span>{track.artist}</span></div>
    <button className="projection-music-toggle" aria-label={playing ? 'Pause slideshow music' : 'Play slideshow music'} onClick={() => void toggle()}><SiteIcon name={playing ? 'pause' : 'play'} /></button>
    <div className="projection-wave" aria-label={`${musicTime(progress)} of ${musicTime(track.durationMs)}`}><span className="projection-wave-base">{wave}</span><span className="projection-wave-played" style={{ clipPath: `inset(0 ${100 - percentage}% 0 0)` }}>{wave}</span></div>
    <span className="projection-music-time">{musicTime(progress)} / {musicTime(track.durationMs)}</span>
    {error && <p role="alert">{error}</p>}
  </section>
}

export function ProjectionView({ campaignId, csrfToken }: { campaignId: string; csrfToken: string }) {
  const [session, setSession] = useState<VisualSession | null>(null)
  const [error, setError] = useState('')
  const [awake, setAwake] = useState(false)
  const [current, setCurrent] = useState<ProjectionFrame | null>(null)
  const [previous, setPrevious] = useState<ProjectionFrame | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)
  const currentRef = useRef<ProjectionFrame | null>(null)
  const transitionTimer = useRef<number | null>(null)
  useEffect(() => { let alive = true; const read = () => void api<VisualSession>(`/campaigns/${campaignId}/visuals/session`).then(v => { if (alive) { setSession(v); setError('') } }).catch(c => { if (alive) setError(explain(c)) }); read(); const timer = window.setInterval(read, 1500); return () => { alive = false; window.clearInterval(timer); if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current); void wakeLock.current?.release() } }, [campaignId])
  useEffect(() => {
    const visual = session?.current
    if (!visual) { currentRef.current = null; setCurrent(null); setPrevious(null); setTransitioning(false); return }
    const next = projectionFrame(visual)
    if (currentRef.current?.visual.id === next.visual.id && currentRef.current.source === next.source) return
    let cancelled = false
    const preload = new Image()
    const commit = () => {
      if (cancelled) return
      const outgoing = currentRef.current
      const crossfade = !!outgoing && session?.transition !== 'cut'
      currentRef.current = next; setCurrent(next)
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current)
      if (!crossfade) { setPrevious(null); setTransitioning(false); return }
      setPrevious(outgoing); setTransitioning(true)
      transitionTimer.current = window.setTimeout(() => { setPrevious(null); setTransitioning(false); transitionTimer.current = null }, projectionFadeDuration(session?.intervalSeconds ?? 30) + 80)
    }
    preload.src = next.source
    void preload.decode().catch(() => undefined).then(commit)
    return () => { cancelled = true }
  }, [session?.current?.id, session?.current?.imageUrl])
  async function fullscreen() { await document.documentElement.requestFullscreen().catch(() => {}); try { const lock = await (navigator as Navigator & { wakeLock?: { request: (kind: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen'); if (lock) { wakeLock.current = lock; setAwake(true) } } catch { /* Fullscreen still works without wake lock. */ } }
  const fadeStyle = { '--projection-fade-duration': `${projectionFadeDuration(session?.intervalSeconds ?? 30)}ms` } as ProjectionFadeStyle
  return <main className={`projection-view transition-${session?.transition || 'crossfade'}${session?.blackout ? ' is-blackout' : ''}`} style={fadeStyle}>
    {previous && <ProjectionLayer key={previous.visual.id} frame={previous} className="is-outgoing" hidden />}
    {current && <ProjectionLayer key={current.visual.id} frame={current} className={transitioning ? 'is-incoming' : 'is-current'} />}
    {!current && <div className="projection-blank">{error ? <span>{error}</span> : !session?.blackout && <><SiteIcon name="projector" size={32} /><span>Waiting for the first visual cue…</span></>}</div>}
    <ProjectionMusic campaignId={campaignId} csrfToken={csrfToken} />
    <div className="projection-blackout" aria-hidden="true" />
    <button className="projection-fullscreen" onClick={() => void fullscreen()} aria-label="Enter fullscreen"><SiteIcon name="fullscreen" />{awake ? 'Screen awake' : 'Fullscreen'}</button>
  </main>
}
