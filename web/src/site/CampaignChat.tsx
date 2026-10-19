import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { getEffectiveToolName, getPartColor, isInspectablePart, MarkdownRenderer, projectActivityTimeline, rebuildBlocks, squarePosition, squareSequence, stepSquare, type MessageBlock, type MessagePart, type PersistedMessage, type SquareRef, type SquareRow } from '@redbamboo/chat'
import { api, explain } from './api'
import { SiteIcon } from './icons'
import { AgentSettings } from './AgentSettings'

interface AgentCursor { epoch: string; sequence: number }
interface AgentMessage {
  cursor: AgentCursor
  messageUid: string
  role: string
  kind: string
  content: string | null
  timestamp: string
  metadata?: { phase?: 'commentary' | 'final_answer' | null } | null
  toolName?: string | null
  toolInput?: string | null
  toolResult?: string | null
  payloadRef?: Record<string, unknown> | null
  attachmentsJson?: string | null
}
interface AgentChatPage {
  agent: { id: string; name: string }
  discussionId: string
  sessionId: string
  messages: AgentMessage[]
  cursor: AgentCursor | null
  isQuiescent: boolean
  hasMore: boolean
}
interface AgentAdmission { messageUid: string; disposition: string }
interface PendingMessage { id: string; content: string; messageUid?: string }
interface AgentDiscussion { id: string; title: string; sessionId: string; status: string; lastActivity: string; messageCount: number; kind?: 'chat' | 'heartbeat'; readOnly?: boolean }
interface AgentDiscussionIndex { agent: { id: string; name: string; avatar?: string }; discussions: AgentDiscussion[]; defaultDiscussionId: string }
interface DiscussionTranscript { records: Map<string, AgentMessage>; cursor: AgentCursor | null; quiescent: boolean }
const campaignTranscripts = new Map<string, Map<string, DiscussionTranscript>>()
window.addEventListener('storyboard:signout', () => campaignTranscripts.clear())

export function CampaignChat({ campaignId, csrfToken }: { campaignId: string; csrfToken: string }) {
  const base = `/campaigns/${campaignId}/agent/discussions`
  const [index, setIndex] = useState<AgentDiscussionIndex | null>(null)
  const [selected, setSelected] = useState('')
  const [showList, setShowList] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const transcripts = useMemo(() => { let value = campaignTranscripts.get(campaignId); if (!value) { value = new Map(); campaignTranscripts.set(campaignId, value) }; return value }, [campaignId])

  useEffect(() => {
    let alive = true
    setIndex(null); setSelected(''); setError('')
    void api<AgentDiscussionIndex>(base).then(value => {
      if (!alive) return
      let remembered: string | null = null
      try { remembered = localStorage.getItem(`storyboard:${campaignId}:agent-discussion`) } catch { /* selection persistence is optional */ }
      const chosen = remembered === '__settings__' || value.discussions.some(item => item.id === remembered)
        ? remembered! : value.defaultDiscussionId || value.discussions[0]?.id || ''
      setIndex(value); setSelected(chosen)
    }).catch(cause => { if (alive) setError(explain(cause)) })
    return () => { alive = false }
  }, [base, campaignId])

  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ campaignId?: string }>).detail
      if (detail?.campaignId !== campaignId) return
      void api<AgentDiscussionIndex>(base).then(value => {
        setIndex(value)
        setSelected(current => value.discussions.some(item => item.id === current) ? current : value.defaultDiscussionId || value.discussions[0]?.id || '')
      }).catch(cause => setError(explain(cause)))
    }
    window.addEventListener('storyboard:play-mode-changed', changed)
    return () => window.removeEventListener('storyboard:play-mode-changed', changed)
  }, [base, campaignId])

  function choose(id: string) {
    setSelected(id); setShowList(false); setError('')
    try { localStorage.setItem(`storyboard:${campaignId}:agent-discussion`, id) } catch { /* selection persistence is optional */ }
  }

  async function create() {
    if (creating) return
    setCreating(true); setError('')
    try {
      const discussion = await api<AgentDiscussion>(base, csrfToken, 'POST', { operationId: crypto.randomUUID() })
      setIndex(value => value ? { ...value, discussions: [discussion, ...value.discussions.filter(item => item.id !== discussion.id)] } : value)
      choose(discussion.id)
    } catch (cause) { setError(explain(cause)) }
    finally { setCreating(false) }
  }

  function touched(id: string, title: string) {
    setIndex(value => {
      if (!value) return value
      const current = value.discussions.find(item => item.id === id)
      if (!current) return value
      const next = { ...current, title, lastActivity: new Date().toISOString(), messageCount: current.messageCount + 1 }
      return { ...value, discussions: [next, ...value.discussions.filter(item => item.id !== id)] }
    })
  }

  const active = index?.discussions.find(item => item.id === selected) ?? null
  let transcript: DiscussionTranscript | null = null
  if (active) { transcript = transcripts.get(active.id) || { records: new Map(), cursor: null, quiescent: true }; transcripts.set(active.id, transcript) }
  const settings = selected === '__settings__'
  function agentChanged(agent: AgentDiscussionIndex['agent']) { setIndex(value => value ? { ...value, agent } : value) }
  return <section className={`campaign-agent-workspace${showList ? ' is-list' : ' is-chat'}`} aria-label="Campaign Agent discussions">
    <aside className="campaign-agent-discussions" aria-label="Discussions">
      <div className="campaign-agent-discussions-bar"><span className="campaign-agent-identity">{index?.agent.avatar ? <img src={index.agent.avatar} alt="" /> : <i><SiteIcon name="agent" /></i>}<span><small>CAMPAIGN AGENT</small><strong>{index?.agent.name || 'Agent'}</strong></span></span><button onClick={() => void create()} disabled={creating}><SiteIcon name="plus" />{creating ? 'Creating…' : 'New'}</button></div>
      {index ? <nav><button className={`campaign-agent-settings-link${settings ? ' is-selected' : ''}`} aria-current={settings ? 'page' : undefined} onClick={() => choose('__settings__')}><strong><SiteIcon name="tool" size={16} /><span>Agent settings</span></strong><span>Identity, behaviour and playbooks</span></button>{index.discussions.map(discussion => <button key={discussion.id} className={discussion.id === selected ? 'is-selected' : ''} aria-current={discussion.id === selected ? 'true' : undefined} onClick={() => choose(discussion.id)}><strong><span>{discussion.title || 'New discussion'}</span>{discussion.kind === 'heartbeat' && <small>PLAY MODE</small>}</strong><span>{relative(discussion.lastActivity)}</span></button>)}</nav> : <p role="status">Opening discussions…</p>}
    </aside>
    <div className="campaign-agent-detail">
      <button className="campaign-agent-mobile-discussions" onClick={() => setShowList(true)}><SiteIcon name="back" />Discussions</button>
      {settings && index ? <AgentSettings campaignId={campaignId} csrfToken={csrfToken} onChanged={agentChanged} /> : active && transcript ? <CampaignDiscussion key={active.id} campaignId={campaignId} discussion={active} transcript={transcript} csrfToken={csrfToken} onTouched={touched} /> : index && <p className="campaign-agent-empty">Choose or start a discussion.</p>}
    </div>
    {error && <p className="campaign-agent-index-error" role="alert"><SiteIcon name="warning" />{error}</p>}
  </section>
}

function CampaignDiscussion({ campaignId, discussion, transcript, csrfToken, onTouched }: { campaignId: string; discussion: AgentDiscussion; transcript: DiscussionTranscript; csrfToken: string; onTouched: (id: string, title: string) => void }) {
  const base = `/campaigns/${campaignId}/agent/discussions/${encodeURIComponent(discussion.id)}/chat`
  const loading = useRef(false)
  const mounted = useRef(true)
  const end = useRef<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)
  const [revision, setRevision] = useState(0)
  const [quiescent, setQuiescent] = useState(transcript.quiescent)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (loading.current) return
    loading.current = true
    try {
      const after = transcript.cursor
      const query = after ? `?afterEpoch=${encodeURIComponent(after.epoch)}&afterSequence=${after.sequence}` : ''
      let page = await api<AgentChatPage>(base + query)
      while (true) {
        const previousEpoch = transcript.cursor?.epoch
        const nextEpoch = page.messages[0]?.cursor.epoch
        if (previousEpoch && nextEpoch && previousEpoch !== nextEpoch) transcript.records.clear()
        for (const message of page.messages) transcript.records.set(`${message.cursor.epoch}:${message.cursor.sequence}`, message)
        transcript.cursor = page.cursor
        transcript.quiescent = page.isQuiescent
        setQuiescent(transcript.quiescent)
        if (!page.hasMore || !page.cursor) break
        page = await api<AgentChatPage>(`${base}?afterEpoch=${encodeURIComponent(page.cursor.epoch)}&afterSequence=${page.cursor.sequence}`)
      }
      const canonical = new Set([...transcript.records.values()].map(message => message.messageUid))
      setPending(values => values.filter(value => !value.messageUid || !canonical.has(value.messageUid)))
      setError('')
      const node = scroller.current
      stickToBottom.current = !node || node.scrollHeight - node.scrollTop - node.clientHeight < 80
      setRevision(value => value + 1)
    } catch (cause) {
      if (mounted.current) setError(explain(cause))
    } finally {
      loading.current = false
    }
  }, [base, transcript])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false }
  }, [load])

  useEffect(() => {
    let timer: number | undefined
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(tick, quiescent ? 3000 : 900) }
    const tick = () => { if (!document.hidden) void load().finally(schedule); else schedule() }
    const visibility = () => { if (!document.hidden) void load() }
    schedule(); document.addEventListener('visibilitychange', visibility)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [load, quiescent])

  useEffect(() => {
    if (stickToBottom.current) end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [revision, pending.length, quiescent])

  const messages = useMemo(() => {
    const persisted: PersistedMessage[] = [...transcript.records.values()].map(message => ({
      id: `${message.cursor.epoch}:${message.cursor.sequence}`,
      role: message.role,
      eventType: message.kind === 'commentary' ? 'text' : message.kind,
      content: message.content,
      toolName: message.toolName,
      toolInput: message.toolInput,
      toolResult: message.toolResult,
      messageUid: message.messageUid,
      phase: message.kind === 'commentary' ? 'commentary' : message.metadata?.phase ?? undefined,
      timestamp: message.timestamp,
      attachmentsJson: message.attachmentsJson,
      epoch: message.cursor.epoch,
      sequence: message.cursor.sequence,
    }))
    return rebuildBlocks(persisted)
  }, [revision])
  const timeline = useMemo(() => projectActivityTimeline(messages), [messages])
  const lastActivity = timeline.reduce((last, row, index) => row.kind === 'activity' ? index : last, -1)
  // One dialog for the whole discussion, so its arrows can step past commentary
  // into the neighbouring activity rows.
  const squareRows = useMemo<SquareRow[]>(() => timeline.filter(row => row.kind === 'activity').map(row => ({ id: row.key, parts: row.block.parts })), [timeline])
  const [inspected, setInspected] = useState<SquareRef | null>(null)

  async function send(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content) return
    const id = crypto.randomUUID()
    stickToBottom.current = true
    setDraft(''); setError(''); setPending(values => [...values, { id, content }])
    try {
      const admission = await api<AgentAdmission & { title?: string }>(base, csrfToken, 'POST', { content, operationId: id })
      if (!mounted.current) return
      setPending(values => values.map(value => value.id === id ? { ...value, messageUid: admission.messageUid } : value))
      setQuiescent(false)
      onTouched(discussion.id, admission.title || discussion.title)
      stickToBottom.current = true
      await load()
    } catch (cause) {
      if (!mounted.current) return
      setPending(values => values.filter(value => value.id !== id))
      setDraft(content)
      setError(explain(cause))
    }
  }

  return <section className="campaign-agent-chat" aria-label={`Discussion: ${discussion.title || 'New discussion'}`}>
    <div className="campaign-agent-messages" aria-live="polite" ref={scroller}>
      {messages.length === 0 && pending.length === 0 && <p className="campaign-agent-empty">{discussion.readOnly ? 'Play-mode work will appear here when the campaign heartbeat runs.' : 'Ask for preparation, challenge a plan, or work through what the table may need next.'}</p>}
      {timeline.map((row, index) => row.kind === 'activity'
        ? <AgentActivityRow key={row.key} parts={row.block.parts} active={!quiescent && index === lastActivity} inspect={partIndex => setInspected({ rowId: row.key, index: partIndex })} />
        : <ChatBlock key={row.key} message={row.block} />)}
      {pending.map(message => <article className="campaign-agent-message is-user is-pending" key={message.id}><p>{message.content}</p><small>{message.messageUid ? 'Saved, waiting for the Agent' : 'Sending'}</small></article>)}
      {!quiescent && <p className="campaign-agent-working"><i />Agent is working</p>}
      <div ref={end} aria-hidden="true" />
    </div>
    {inspected && <AgentActivityDialog rows={squareRows} square={inspected} step={setInspected} close={() => setInspected(null)} />}
    {error && <p className="campaign-agent-error" role="alert"><SiteIcon name="warning" />{error}</p>}
    {discussion.readOnly ? <div className="campaign-agent-heartbeat-note"><SiteIcon name="agent" />The Agent works here while play mode is active.</div> : <form className="campaign-agent-composer" onSubmit={send}>
      <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Message the Agent…" rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
      <button aria-label="Send message" disabled={!draft.trim()}><SiteIcon name="send" /></button>
    </form>}
  </section>
}

function relative(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function ChatBlock({ message }: { message: MessageBlock }) {
  if (message.parts.length === 0) return null
  return <article className={`campaign-agent-message is-${message.role}`}>
    {message.parts.map((part, index) => {
      if (part.type === 'text') return <div className={part.phase === 'commentary' ? 'is-commentary markdown-body' : 'markdown-body'} key={index}><MarkdownRenderer content={part.content || ''} /></div>
      return null
    })}
  </article>
}

function AgentActivityRow({ parts, active, inspect }: { parts: MessagePart[]; active: boolean; inspect: (index: number) => void }) {
  // Keep each square's index into `parts`: its paired result is looked up there.
  const squares = parts.flatMap((part, index) => isInspectablePart(part) ? [index] : [])
  return <div className="campaign-agent-activity" role="group" aria-label="Agent activity">
    {squares.map((partIndex, position) => {
      const part = parts[partIndex]
      const label = activityLabel(part)
      return <button
        type="button"
        className={`campaign-agent-activity-square${active && position === squares.length - 1 ? ' is-active' : ''}`}
        style={{ '--activity-color': getPartColor(part) } as CSSProperties}
        aria-label={label}
        title={label}
        key={`${part.messageId || part.toolName || part.type}:${partIndex}`}
        onClick={() => inspect(partIndex)}
      />
    })}
  </div>
}

function AgentActivityDialog({ rows, square, step, close }: { rows: SquareRow[]; square: SquareRef; step: (square: SquareRef) => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  // The dialog is centred, so a shorter activity would pull the arrows out from
  // under the pointer. Hold the tallest height reached while stepping.
  const [minHeight, setMinHeight] = useState(0)
  useEffect(() => { const node = dialog.current; if (node && !node.open) node.showModal(); return () => { if (node?.open) node.close() } }, [])
  const parts = rows.find(row => row.id === square.rowId)?.parts
  const part = parts?.[square.index]
  const sequence = squareSequence(rows)
  const position = squarePosition(sequence, square)
  useEffect(() => { if (!part) dialog.current?.close() }, [part])
  if (!parts || !part) return null
  const result = part.type === 'tool_use' ? pairedResult(parts, square.index) : undefined
  const label = activityLabel(part)
  const move = (direction: -1 | 1) => {
    const next = stepSquare(rows, square, direction)
    if (!next) return
    setMinHeight(height => Math.max(height, dialog.current?.offsetHeight ?? 0))
    step(next)
  }
  const atStart = position <= 0
  const atEnd = position === sequence.length - 1
  return <dialog
    className="campaign-agent-activity-dialog"
    ref={dialog}
    aria-labelledby={titleId}
    style={minHeight ? { minHeight: `min(${minHeight}px, 76dvh)` } : undefined}
    onClose={close}
    onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close() }}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      move(event.key === 'ArrowLeft' ? -1 : 1)
    }}
  >
    <div>
      <header>
        <i style={{ '--activity-color': getPartColor(part) } as CSSProperties} />
        <h2 id={titleId}>{label}</h2>
        {sequence.length > 1 && position !== -1 && <div className="campaign-agent-activity-nav" role="group" aria-label="Activity navigation">
          {/* aria-disabled keeps focus, and the arrow keys, inside the dialog at either end. */}
          <button type="button" aria-label="Previous activity" title="Previous (←)" aria-disabled={atStart || undefined} onClick={() => { if (!atStart) move(-1) }}><SiteIcon name="previousItem" /></button>
          <span>{position + 1} / {sequence.length}</span>
          <button type="button" aria-label="Next activity" title="Next (→)" aria-disabled={atEnd || undefined} onClick={() => { if (!atEnd) move(1) }}><SiteIcon name="nextItem" /></button>
        </div>}
        <button type="button" aria-label="Close activity details" onClick={() => dialog.current?.close()}><SiteIcon name="close" /></button>
      </header>
      {part.type === 'thinking' && <section><span>PUBLIC REASONING</span><p>{part.content || 'No public summary was emitted.'}</p></section>}
      {part.type === 'tool_use' && <><section><span>REQUEST</span><pre>{formatPayload(part.toolInput)}</pre></section>{result && <section><span>RESULT</span><pre>{formatPayload(result.content)}</pre></section>}</>}
      {part.type === 'error' && <section><span>ERROR</span><p>{part.content || 'The action failed.'}</p></section>}
    </div>
  </dialog>
}

function pairedResult(parts: readonly MessagePart[], index: number) {
  for (let cursor = index + 1; cursor < parts.length; cursor++) {
    if (parts[cursor].type === 'tool_result') return parts[cursor]
    if (parts[cursor].type === 'tool_use') return undefined
  }
  return undefined
}

function activityLabel(part: MessagePart) {
  if (part.type === 'thinking') return 'Thinking'
  if (part.type === 'error') return 'Error'
  if (part.type === 'tool_use') return humanizeTool(getEffectiveToolName(part.toolName, part.toolInput))
  return 'Activity'
}

function formatPayload(value?: string) {
  if (!value) return 'No details.'
  try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
}

function humanizeTool(value?: string) {
  if (!value) return 'Using a campaign tool'
  return value.replace(/^mcp__/, '').replaceAll('__', ' · ').replaceAll('_', ' ')
}
