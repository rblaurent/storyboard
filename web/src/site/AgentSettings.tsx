import { useEffect, useState, type FormEvent } from 'react'
import { AgentDirection } from './AgentDirection'
import { ArtworkGenerator, type ArtworkCandidate } from './ArtworkGenerator'
import { api, explain } from './api'
import { SiteIcon } from './icons'

interface AgentSettingsValue {
  agent: { id: string; name: string; avatar: string }
  direction: string
  responseStyle: 'concise' | 'balanced' | 'detailed'
  initiative: 'reactive' | 'collaborative' | 'proactive'
  revision: number
  boundaries: string[]
}

const playbooks = [
  ['planning', 'Scenario planning'],
  ['information', 'Information and player model'],
  ['music', 'Music'],
  ['visuals', 'Visuals'],
] as const

export function AgentSettings({ campaignId, csrfToken, onChanged }: { campaignId: string; csrfToken: string; onChanged: (agent: AgentSettingsValue['agent']) => void }) {
  const [value, setValue] = useState<AgentSettingsValue | null>(null)
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const path = `/campaigns/${campaignId}/agent/settings`

  useEffect(() => {
    const controller = new AbortController()
    void api<AgentSettingsValue>(path, '', 'GET', undefined, controller.signal).then(setValue).catch(cause => { if (!controller.signal.aborted) setError(explain(cause)) })
    return () => controller.abort()
  }, [path])

  async function save(event: FormEvent) {
    event.preventDefault(); if (!value || busy) return
    setBusy(true); setError(''); setSaved(false)
    try {
      const updated = await api<AgentSettingsValue>(path, csrfToken, 'PUT', {
        name: value.agent.name, direction: value.direction, responseStyle: value.responseStyle, initiative: value.initiative,
        expectedRevision: value.revision, operationId: crypto.randomUUID(),
      })
      setValue(updated); onChanged(updated.agent); setSaved(true)
    } catch (cause) { setError(explain(cause)) }
    finally { setBusy(false) }
  }

  async function avatar(candidate: ArtworkCandidate) {
    if (!value || avatarBusy) return
    setAvatarBusy(true); setError(''); setSaved(false)
    try {
      const updated = await api<AgentSettingsValue>(`/campaigns/${campaignId}/agent/avatar`, csrfToken, 'PUT', {
        candidateId: candidate.id, expectedRevision: value.revision, operationId: crypto.randomUUID(),
      })
      setValue(updated); onChanged(updated.agent); setSaved(true)
    } catch (cause) { setError(explain(cause)) }
    finally { setAvatarBusy(false) }
  }

  if (!value) return <div className="campaign-agent-settings-loading" role={error ? 'alert' : 'status'}>{error || 'Opening Agent settings…'}</div>
  return <div className="campaign-agent-settings">
    <header className="campaign-agent-settings-heading"><div><small>CAMPAIGN AGENT</small><h2>Shape how your Agent works</h2><p>Set its identity and working style here. Use the capability directions below for specialised behaviour.</p></div></header>
    <form className="campaign-agent-settings-form" onSubmit={save}>
      <section className="campaign-agent-profile">
        <div className="campaign-agent-avatar-editor">
          {value.agent.avatar ? <img src={value.agent.avatar} alt={`${value.agent.name} avatar`} /> : <i><SiteIcon name="agent" size={32} /></i>}
          <div><strong>Portrait</strong><span>Describe it, refine the prompt, generate candidates, then choose.</span></div>
        </div>
        <ArtworkGenerator campaignId={campaignId} csrfToken={csrfToken} targetKind="agent" disabled={avatarBusy} onSelect={avatar} />
        <label>Agent name<input maxLength={120} value={value.agent.name} onChange={event => setValue({ ...value, agent: { ...value.agent, name: event.target.value } })} /></label>
      </section>
      <section className="campaign-agent-behaviour">
        <div><h3>Working style</h3><p>This direction applies across preparation, discussion and play mode. Capability rules remain more specific.</p></div>
        <label>Campaign-wide direction<textarea rows={7} maxLength={12000} value={value.direction} onChange={event => setValue({ ...value, direction: event.target.value })} placeholder="Describe how this Agent should collaborate with you, what it should protect, and what excellent support looks like for this campaign." /></label>
        <div className="campaign-agent-choice-grid">
          <label>Response style<select value={value.responseStyle} onChange={event => setValue({ ...value, responseStyle: event.target.value as AgentSettingsValue['responseStyle'] })}><option value="concise">Concise</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></select></label>
          <label>Initiative<select value={value.initiative} onChange={event => setValue({ ...value, initiative: event.target.value as AgentSettingsValue['initiative'] })}><option value="reactive">Reactive</option><option value="collaborative">Collaborative</option><option value="proactive">Proactive</option></select></label>
        </div>
      </section>
      {error && <p className="error" role="alert">{error}</p>}{saved && <p className="notice" role="status">Agent settings saved.</p>}
      <div className="campaign-agent-settings-save"><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save Agent settings'}</button><span>Revision {value.revision}</span></div>
    </form>
    <section className="campaign-agent-capabilities"><div><small>CAPABILITY PLAYBOOKS</small><h3>Tell it when and how to act</h3><p>Each playbook has its own triggers, creative direction and safety boundary.</p></div>{playbooks.map(([capability, title]) => <AgentDirection key={capability} campaignId={campaignId} capability={capability} csrfToken={csrfToken} title={title} />)}</section>
    <section className="campaign-agent-boundaries"><div><small>EFFECTIVE ACCESS</small><h3>What this Agent can actually do</h3><p>Your directions shape its judgement. They never widen these fixed permissions.</p></div><ul>{value.boundaries.map(boundary => <li key={boundary}><SiteIcon name="check" />{boundary}</li>)}</ul></section>
  </div>
}
