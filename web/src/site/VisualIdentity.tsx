import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, explain, type ImageWorkflowIndex, type VisualProfile } from './api'
import { ArtworkGenerator } from './ArtworkGenerator'
import { SiteIcon } from './icons'

function sameProfile(left: VisualProfile | null, right: VisualProfile | null) {
  if (!left || !right) return left === right
  return JSON.stringify(left) === JSON.stringify(right)
}

export function VisualIdentity({ campaignId, csrfToken }: { campaignId: string; csrfToken: string }) {
  const [saved, setSaved] = useState<VisualProfile | null>(null)
  const [draft, setDraft] = useState<VisualProfile | null>(null)
  const [workflows, setWorkflows] = useState<ImageWorkflowIndex | null>(null)
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const dirty = useMemo(() => !sameProfile(saved, draft), [saved, draft])

  useEffect(() => {
    setExpanded(null)
    const controller = new AbortController()
    void Promise.all([
      api<VisualProfile>(`/campaigns/${campaignId}/visuals/profile`, '', 'GET', undefined, controller.signal),
      api<ImageWorkflowIndex>(`/campaigns/${campaignId}/visuals/workflows`, '', 'GET', undefined, controller.signal),
    ]).then(([profile, options]) => { setSaved(profile); setDraft(profile); setWorkflows(options) })
      .catch(cause => { if (!controller.signal.aborted) setError(explain(cause)) })
    return () => controller.abort()
  }, [campaignId])

  async function refine() {
    if (!draft || busy) return
    setBusy('refine'); setError(''); setNotice('')
    try {
      const result = await api<VisualProfile>(`/campaigns/${campaignId}/visuals/profile/refine`, csrfToken, 'POST', { direction: request })
      setDraft({ ...draft, artDirection: result.artDirection, portraitDirection: result.portraitDirection, sceneDirection: result.sceneDirection, negativePrompt: result.negativePrompt })
      setNotice('A campaign-specific visual identity is ready to review. Nothing has been saved yet.')
    } catch (cause) { setError(explain(cause)) }
    finally { setBusy('') }
  }

  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft || busy) return
    setBusy('save'); setError(''); setNotice('')
    try {
      const result = await api<VisualProfile>(`/campaigns/${campaignId}/visuals/profile`, csrfToken, 'PUT', draft)
      setSaved(result); setDraft(result); setNotice('Visual identity saved. New images will use it.')
    } catch (cause) { setError(explain(cause)) }
    finally { setBusy('') }
  }

  const workflowName = (slug: string) => workflows?.items.find(value => value.slug === slug)?.name || slug
  const fallbackName = workflows ? workflowName(workflows.defaultWorkflow) : 'Storyboard default'
  const select = (label: string, key: 'defaultWorkflow' | 'portraitWorkflow' | 'sceneWorkflow', fallback: string) => <label>{label}<select value={draft?.[key] || ''} onChange={event => draft && setDraft({ ...draft, [key]: event.target.value })} disabled={!!busy}>
    <option value="">{fallback}</option>
    {workflows?.items.map(workflow => <option key={workflow.id} value={workflow.slug}>{workflow.name}{workflow.license ? ` · ${workflow.license}` : ''}</option>)}
  </select></label>

  return <details className="visual-identity panel" open={expanded ?? (saved !== null && !saved.configured)} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><span><SiteIcon name="images" /><span><strong>Campaign visual identity</strong><small>{saved?.configured ? 'Applied to every new campaign image' : 'Set a coherent style before generating more images'}</small></span></span><span className={`visual-identity-state${dirty ? ' is-dirty' : ''}`}>{dirty ? 'UNSAVED' : saved?.configured ? 'READY' : 'NEEDS DIRECTION'}</span></summary>
    {!draft || !workflows ? <p role={error ? 'alert' : 'status'}>{error || 'Opening the campaign visual identity…'}</p> : <form onSubmit={save}>
      <section className="visual-identity-proposal">
        <div><span className="eyebrow">STYLE PROPOSAL</span><h3>Give the campaign one visual language</h3><p>Storyboard may read the campaign premise to choose genre and mood. The saved result contains only reusable image-making language, never lore or story details.</p></div>
        <label>What should this campaign look and feel like?<textarea rows={3} maxLength={3000} value={request} onChange={event => setRequest(event.target.value)} placeholder="Optional references, medium, mood, palette, or qualities you want to protect…" /></label>
        <button className="primary" type="button" disabled={!!busy} onClick={() => void refine()}><SiteIcon name="generate" />{busy === 'refine' ? 'Designing…' : draft.configured ? 'Refine visual identity' : 'Propose from campaign'}</button>
      </section>

      <div className="visual-identity-directions">
        <label>Overall art direction<textarea rows={6} maxLength={4000} value={draft.artDirection} onChange={event => setDraft({ ...draft, artDirection: event.target.value })} /></label>
        <label>Portraits and characters<textarea rows={5} maxLength={3000} value={draft.portraitDirection} onChange={event => setDraft({ ...draft, portraitDirection: event.target.value })} placeholder="Framing, facial treatment, pose, costume rendering, and character finish…" /></label>
        <label>Scenes and locations<textarea rows={5} maxLength={3000} value={draft.sceneDirection} onChange={event => setDraft({ ...draft, sceneDirection: event.target.value })} placeholder="Environment composition, depth, atmosphere, architecture, and landscape finish…" /></label>
        <label>Always avoid<textarea rows={4} maxLength={1200} value={draft.negativePrompt} onChange={event => setDraft({ ...draft, negativePrompt: event.target.value })} placeholder="lettering, interface, watermark…" /></label>
      </div>

      <section className="visual-identity-workflows">
        <div><span className="eyebrow">RENDERING</span><h3>Choose compatible image workflows</h3><p>Only text-to-image workflow entities with the inputs Storyboard needs are shown.</p></div>
        <div className="visual-workflow-grid">
          {select('Campaign default', 'defaultWorkflow', `Storyboard default · ${fallbackName}`)}
          {select('Portrait image workflow', 'portraitWorkflow', 'Use campaign default')}
          {select('Scene image workflow', 'sceneWorkflow', 'Use campaign default')}
        </div>
      </section>

      <section className="visual-projection-defaults">
        <span className="eyebrow">PROJECTION DEFAULTS</span>
        <div><label>Slide interval in seconds<input type="number" min={5} max={300} value={draft.defaultIntervalSeconds} onChange={event => setDraft({ ...draft, defaultIntervalSeconds: Number(event.target.value) })} /></label><label>Transition<select value={draft.transition} onChange={event => setDraft({ ...draft, transition: event.target.value as VisualProfile['transition'] })}><option value="crossfade">Crossfade</option><option value="cut">Cut</option></select></label></div>
      </section>

      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
      <div className="visual-identity-actions"><button className="accent" disabled={!!busy || !dirty || !draft.artDirection.trim()}>{busy === 'save' ? 'Saving…' : 'Save visual identity'}</button>{dirty && <button type="button" disabled={!!busy} onClick={() => saved && setDraft(saved)}>Discard changes</button>}</div>

      <section className="visual-identity-preview">
        <div><span className="eyebrow">STYLE TEST</span><h3>Preview it against a simple subject</h3><p>{dirty ? 'Save the identity before generating a preview so the render uses these exact directions.' : 'The preview is deliberately disposable. It tests the saved style without changing campaign artwork.'}</p></div>
        <ArtworkGenerator campaignId={campaignId} csrfToken={csrfToken} targetKind="profile" disabled={dirty || !saved?.configured} />
      </section>
    </form>}
  </details>
}
