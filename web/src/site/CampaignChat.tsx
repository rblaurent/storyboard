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

export function CampaignChat({ campaignId, csrfToken }: { campaignId: string; csrfToken: string }) {
  const base = `/campaigns/${campaignId}/agent/chat`
  const records = useRef(new Map<string, AgentMessage>())
  const cursor = useRef<AgentCursor | null>(null)
  const loading = useRef(false)
  const mounted = useRef(true)
  const end = useRef<HTMLDivElement | null>(null)
  const [revision, setRevision] = useState(0)
  const [agentName, setAgentName] = useState('Campaign Copilot')
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
        setAgentName(page.agent.name)
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
  }, [campaignId, load])

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
      const admission = await api<AgentAdmission>(base, csrfToken, 'POST', { content, operationId: id })
      if (!mounted.current) return
      setPending(values => values.map(value => value.id === id ? { ...value, messageUid: admission.messageUid } : value))
      setQuiescent(false)
      await load(false)
    } catch (cause) {
      if (!mounted.current) return
      setPending(values => values.filter(value => value.id !== id))
      setDraft(content)
      setError(explain(cause))
    }
  }

  return <section className="campaign-agent-chat" aria-label={`Chat with ${agentName}`}>
    <header><div><span className="eyebrow">CAMPAIGN AGENT</span><h3>{agentName}</h3></div><span className={`campaign-agent-state${quiescent ? '' : ' is-working'}`}><i />{quiescent ? 'Ready' : 'Working'}</span></header>
    <div className="campaign-agent-messages" aria-live="polite">
      {messages.length === 0 && pending.length === 0 && <p className="campaign-agent-empty">Ask for preparation, challenge a plan, or work through what the table may need next.</p>}
      {messages.map(message => <ChatBlock key={message.id} message={message} />)}
      {pending.map(message => <article className="campaign-agent-message is-user is-pending" key={message.id}><p>{message.content}</p><small>{message.messageUid ? 'Saved, waiting for the Agent' : 'Sending'}</small></article>)}
      {!quiescent && <p className="campaign-agent-working"><i />{agentName} is working</p>}
      <div ref={end} aria-hidden="true" />
    </div>
    {error && <p className="campaign-agent-error" role="alert"><SiteIcon name="warning" />{error}</p>}
    <form className="campaign-agent-composer" onSubmit={send}>
      <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder={`Message ${agentName}…`} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
      <button aria-label="Send message" disabled={!draft.trim()}><SiteIcon name="send" /></button>
    </form>
  </section>
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
