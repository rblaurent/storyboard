import { useEffect, useState, type FormEvent } from 'react'
import { api, explain } from './api'
import { SiteIcon } from './icons'

interface Playbook {
  capability: string
  name: string
  enabled: boolean
  autoDrafts: boolean
  cooldownSeconds: number
  triggers: string[]
  direction: string
  avoid: string
  revision: number
  revisionHash: string
}
interface PlaybookIndex { revisionHash: string; items: Playbook[] }

function policy(capability: string) {
  if (capability === 'music') return 'The Agent may search the library and create draft candidates in play mode. Saving, queueing and playback stay with the GM.'
  if (capability === 'visuals') return 'In play mode, the Agent may generate reusable images and add, remove or immediately show them in the slideshow.'
  if (capability === 'planning') return 'The Agent may read campaign evidence and submit Cockpit proposals. Canon changes stay with the GM.'
  if (capability === 'information') return 'The Agent may review and organise its working understanding. Campaign records are never destructively rewritten.'
  return 'The Agent may draft material in its discussion. Publishing and canon changes stay with the GM.'
}

export function AgentDirection({ campaignId, capability, csrfToken, title }: { campaignId: string; capability: string; csrfToken: string; title?: string }) {
  const [value, setValue] = useState<Playbook | null>(null)
  const [triggers, setTriggers] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void api<PlaybookIndex>(`/campaigns/${campaignId}/agent/playbooks`, '', 'GET', undefined, controller.signal)
      .then(index => { const item = index.items.find(candidate => candidate.capability === capability); if (item) { setValue(item); setTriggers(item.triggers.join(', ')) } })
      .catch(cause => { if (!controller.signal.aborted) setError(explain(cause)) })
    return () => controller.abort()
  }, [campaignId, capability])
  async function save(event: FormEvent) {
    event.preventDefault(); if (!value || busy) return
    setBusy(true); setError(''); setSaved(false)
    try {
      const updated = await api<Playbook>(`/campaigns/${campaignId}/agent/playbooks/${capability}`, csrfToken, 'PUT', {
        enabled: value.enabled,
        autoDrafts: value.autoDrafts,
        cooldownSeconds: value.cooldownSeconds,
        triggers: triggers.split(',').map(item => item.trim()).filter(Boolean),
        direction: value.direction,
        avoid: value.avoid,
        expectedRevision: value.revision,
        operationId: crypto.randomUUID(),
      })
      setValue(updated); setTriggers(updated.triggers.join(', ')); setSaved(true)
    } catch (cause) { setError(explain(cause)) }
    finally { setBusy(false) }
  }
  return <details className="agent-direction panel">
    <summary><span><SiteIcon name="agent" /><strong>{title || value?.name || 'Agent direction'}</strong></span><small>{value?.enabled ? 'Enabled' : 'Paused'}{value ? ` · revision ${value.revision}` : ''}</small></summary>
    {!value ? <p role={error ? 'alert' : 'status'}>{error || 'Opening Agent direction…'}</p> : <form onSubmit={save}>
      <p className="agent-direction-policy"><SiteIcon name="info" />{policy(capability)}</p>
      <div className="agent-direction-controls">
        <label className="check"><input type="checkbox" checked={value.enabled} onChange={event => setValue({ ...value, enabled: event.target.checked })} />Agent may use this capability</label>
        {(capability === 'music' || capability === 'visuals') && <label className="check"><input type="checkbox" checked={value.autoDrafts} onChange={event => setValue({ ...value, autoDrafts: event.target.checked })} />{capability === 'visuals' ? 'Generate live visuals during play mode' : 'Create draft candidates during play mode'}</label>}
        <label>Cooldown in seconds<input type="number" min={15} max={3600} value={value.cooldownSeconds} onChange={event => setValue({ ...value, cooldownSeconds: Number(event.target.value) })} /></label>
      </div>
      <label>When to consider acting<input value={triggers} onChange={event => setTriggers(event.target.value)} placeholder="scene-change, mood-change, queue-low" /><small>Comma-separated structured signals. The Agent still decides whether useful work is needed.</small></label>
      <label>Creative and campaign direction<textarea rows={5} maxLength={8000} value={value.direction} onChange={event => setValue({ ...value, direction: event.target.value })} placeholder="Describe the campaign identity, motifs, pacing, references, and what good output should feel like." /></label>
      <label>Avoid<textarea rows={3} maxLength={2000} value={value.avoid} onChange={event => setValue({ ...value, avoid: event.target.value })} placeholder="Styles, clichés, behaviours, or content this capability should avoid." /></label>
      {error && <p className="error" role="alert">{error}</p>}{saved && <p className="notice" role="status">Agent direction saved.</p>}
      <div className="agent-direction-actions"><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save direction'}</button><code title={value.revisionHash}>{value.revisionHash.slice(0, 10)}</code></div>
    </form>}
  </details>
}
