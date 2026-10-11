import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { rebuildBlocks, type MessageBlock, type PersistedMessage } from '@redbamboo/chat'
import { api, explain } from './api'
import { SiteIcon } from './icons'

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
interface AgentDiscussion { id: string; title: string; sessionId: string; status: string; lastActivity: string; messageCount: number }
interface AgentDiscussionIndex { agent: { id: string; name: string }; discussions: AgentDiscussion[]; defaultDiscussionId: string }

export function CampaignChat({ campaignId, csrfToken }: { campaignId: string; csrfToken: string }) {
  const base = `/campaigns/${campaignId}/agent/discussions`
  const [index, setIndex] = useState<AgentDiscussionIndex | null>(null)
  const [selected, setSelected] = useState('')
  const [showList, setShowList] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setIndex(null); setSelected(''); setError('')
    void api<AgentDiscussionIndex>(base).then(value => {
      if (!alive) return
      let remembered: string | null = null
      try { remembered = localStorage.getItem(`storyboard:${campaignId}:agent-discussion`) } catch { /* selection persistence is optional */ }
      const chosen = value.discussions.some(item => item.id === remembered)
        ? remembered! : value.defaultDiscussionId || value.discussions[0]?.id || ''
      setIndex(value); setSelected(chosen)
    }).catch(cause => { if (alive) setError(explain(cause)) })
    return () => { alive = false }
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
  return <section className={`campaign-agent-workspace${showList ? ' is-list' : ' is-chat'}`} aria-label="Campaign Agent discussions">
    <aside className="campaign-agent-discussions" aria-label="Discussions">
      <div className="campaign-agent-discussions-bar"><strong>Discussions</strong><button onClick={() => void create()} disabled={creating}><SiteIcon name="plus" />{creating ? 'Creating…' : 'New'}</button></div>
      {index?.discussions.length ? <nav>{index.discussions.map(discussion => <button key={discussion.id} className={discussion.id === selected ? 'is-selected' : ''} aria-current={discussion.id === selected ? 'true' : undefined} onClick={() => choose(discussion.id)}><strong>{discussion.title || 'New discussion'}</strong><span>{relative(discussion.lastActivity)}</span></button>)}</nav> : index ? <p>No discussions yet.</p> : <p role="status">Opening discussions…</p>}
    </aside>
    <div className="campaign-agent-detail">
      <button className="campaign-agent-mobile-discussions" onClick={() => setShowList(true)}><SiteIcon name="back" />Discussions</button>
      {active ? <CampaignDiscussion key={active.id} campaignId={campaignId} discussion={active} csrfToken={csrfToken} onTouched={touched} /> : index && <p className="campaign-agent-empty">Choose or start a discussion.</p>}
    </div>
    {error && <p className="campaign-agent-index-error" role="alert"><SiteIcon name="warning" />{error}</p>}
  </section>
}

function CampaignDiscussion({ campaignId, discussion, csrfToken, onTouched }: { campaignId: string; discussion: AgentDiscussion; csrfToken: string; onTouched: (id: string, title: string) => void }) {
  const base = `/campaigns/${campaignId}/agent/discussions/${encodeURIComponent(discussion.id)}/chat`
  const records = useRef(new Map<string, AgentMessage>())
  const cursor = useRef<AgentCursor | null>(null)
  const loading = useRef(false)
  const mounted = useRef(true)
  const end = useRef<HTMLDivElement | null>(null)
  const [revision, setRevision] = useState(0)
  const [quiescent, setQuiescent] = useState(true)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async (fresh = false) => {
    if (loading.current) return
    loading.current = true
    try {
      const after = fresh ? null : cursor.current
      const query = after ? `?afterEpoch=${encodeURIComponent(after.epoch)}&afterSequence=${after.sequence}` : ''
      let page = await api<AgentChatPage>(base + query)
      if (fresh) records.current.clear()
      while (true) {
        const previousEpoch = cursor.current?.epoch
        const nextEpoch = page.messages[0]?.cursor.epoch
        if (!fresh && previousEpoch && nextEpoch && previousEpoch !== nextEpoch) records.current.clear()
        for (const message of page.messages) records.current.set(`${message.cursor.epoch}:${message.cursor.sequence}`, message)
        cursor.current = page.cursor
        setQuiescent(page.isQuiescent)
        if (!page.hasMore || !page.cursor) break
        page = await api<AgentChatPage>(`${base}?afterEpoch=${encodeURIComponent(page.cursor.epoch)}&afterSequence=${page.cursor.sequence}`)
      }
      const canonical = new Set([...records.current.values()].map(message => message.messageUid))
      setPending(values => values.filter(value => !value.messageUid || !canonical.has(value.messageUid)))
      setError('')
      setRevision(value => value + 1)
    } catch (cause) {
      if (mounted.current) setError(explain(cause))
    } finally {
      loading.current = false
    }
  }, [base])

  useEffect(() => {
    mounted.current = true
    records.current.clear(); cursor.current = null
    void load(true)
    return () => { mounted.current = false }
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => void load(false), quiescent ? 3000 : 900)
    return () => window.clearInterval(timer)
  }, [load, quiescent])

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [revision, pending.length, quiescent])

  const messages = useMemo(() => {
    const persisted: PersistedMessage[] = [...records.current.values()].map(message => ({
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

  async function send(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content) return
    const id = crypto.randomUUID()
    setDraft(''); setError(''); setPending(values => [...values, { id, content }])
    try {
      const admission = await api<AgentAdmission & { title?: string }>(base, csrfToken, 'POST', { content, operationId: id })
      if (!mounted.current) return
      setPending(values => values.map(value => value.id === id ? { ...value, messageUid: admission.messageUid } : value))
      setQuiescent(false)
      onTouched(discussion.id, admission.title || discussion.title)
      await load(false)
    } catch (cause) {
      if (!mounted.current) return
      setPending(values => values.filter(value => value.id !== id))
      setDraft(content)
      setError(explain(cause))
    }
  }

  return <section className="campaign-agent-chat" aria-label={`Discussion: ${discussion.title || 'New discussion'}`}>
    <div className="campaign-agent-messages" aria-live="polite">
      {messages.length === 0 && pending.length === 0 && <p className="campaign-agent-empty">Ask for preparation, challenge a plan, or work through what the table may need next.</p>}
      {messages.map(message => <ChatBlock key={message.id} message={message} />)}
      {pending.map(message => <article className="campaign-agent-message is-user is-pending" key={message.id}><p>{message.content}</p><small>{message.messageUid ? 'Saved, waiting for the Agent' : 'Sending'}</small></article>)}
      {!quiescent && <p className="campaign-agent-working"><i />Agent is working</p>}
      <div ref={end} aria-hidden="true" />
    </div>
    {error && <p className="campaign-agent-error" role="alert"><SiteIcon name="warning" />{error}</p>}
    <form className="campaign-agent-composer" onSubmit={send}>
      <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Message the Agent…" rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
      <button aria-label="Send message" disabled={!draft.trim()}><SiteIcon name="send" /></button>
    </form>
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
  const visible = message.parts.filter(part => part.type !== 'thinking')
  if (visible.length === 0) return null
  return <article className={`campaign-agent-message is-${message.role}`}>
    {visible.map((part, index) => {
      if (part.type === 'text') return <p className={part.phase === 'commentary' ? 'is-commentary' : ''} key={index}>{part.content}</p>
      if (part.type === 'tool_use') return <details className="campaign-agent-tool" key={index}><summary><SiteIcon name="tool" />{humanizeTool(part.toolName)}</summary><p>Campaign-scoped action requested.</p></details>
      if (part.type === 'tool_result') return <p className="campaign-agent-tool-result" key={index}><SiteIcon name="check" />Action completed</p>
      if (part.type === 'error') return <p className="campaign-agent-part-error" key={index}>{part.content}</p>
      return null
    })}
  </article>
}

function humanizeTool(value?: string) {
  if (!value) return 'Using a campaign tool'
  return value.replace(/^mcp__/, '').replaceAll('__', ' · ').replaceAll('_', ' ')
}
