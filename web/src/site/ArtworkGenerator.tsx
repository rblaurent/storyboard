import { useEffect, useRef, useState } from 'react'
import { api, explain } from './api'
import { SiteIcon } from './icons'

export interface ArtworkCandidate { id: string; assetId: string; title: string; prompt: string; imageUrl: string }
interface ArtworkBrief { targetKind: 'agent' | 'entity'; entityId: string | null; field: string | null; prompt: string; title: string; refinedPrompt: string; negativePrompt: string; candidateCount: number }
interface ArtworkGeneration { id: string; state: 'pending' | 'generating' | 'ingesting' | 'completed' | 'failed'; error: string; sourcePrompt: string; refinedPrompt: string; candidates: ArtworkCandidate[] }

export function ArtworkGenerator({ campaignId, csrfToken, targetKind, entityId, field, disabled = false, onSelect }: {
  campaignId: string
  csrfToken: string
  targetKind: 'agent' | 'entity'
  entityId?: string
  field?: string
  disabled?: boolean
  onSelect(candidate: ArtworkCandidate): Promise<void> | void
}) {
  const [prompt, setPrompt] = useState('')
  const [brief, setBrief] = useState<ArtworkBrief | null>(null)
  const [generation, setGeneration] = useState<ArtworkGeneration | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const base = `/campaigns/${campaignId}/artwork`

  useEffect(() => () => { mounted.current = false }, [])
  useEffect(() => {
    if (!generation || ['completed', 'failed'].includes(generation.state)) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void api<ArtworkGeneration>(`${base}/generations/${generation.id}`, '', 'GET', undefined, controller.signal)
        .then(value => { if (mounted.current) setGeneration(value) })
        .catch(cause => { if (!controller.signal.aborted && mounted.current) setError(explain(cause)) })
    }, 1000)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [base, generation])

  async function refine() {
    if (!prompt.trim() || busy || disabled) return
    setBusy('refine'); setError(''); setGeneration(null)
    try {
      const value = await api<ArtworkBrief>(`${base}/brief`, csrfToken, 'POST', { targetKind, entityId: entityId || null, field: field || null, prompt: prompt.trim(), candidateCount: 3 })
      if (mounted.current) setBrief(value)
    } catch (cause) { if (mounted.current) setError(explain(cause)) }
    finally { if (mounted.current) setBusy('') }
  }

  async function generate() {
    if (!brief || busy || disabled) return
    setBusy('generate'); setError('')
    try {
      const value = await api<ArtworkGeneration>(`${base}/generations`, csrfToken, 'POST', {
        operationId: crypto.randomUUID(), targetKind, entityId: entityId || null, field: field || null,
        prompt: brief.prompt, refinedPrompt: brief.refinedPrompt, negativePrompt: brief.negativePrompt,
        title: brief.title, candidateCount: brief.candidateCount, confirmed: true,
      })
      if (mounted.current) setGeneration(value)
    } catch (cause) { if (mounted.current) setError(explain(cause)) }
    finally { if (mounted.current) setBusy('') }
  }

  async function choose(candidate: ArtworkCandidate) {
    if (busy || disabled) return
    setBusy(candidate.id); setError('')
    try { await onSelect(candidate) }
    catch (cause) { if (mounted.current) setError(explain(cause)) }
    finally { if (mounted.current) setBusy('') }
  }

  return <section className="artwork-generator" aria-label="Image generator">
    <div className="artwork-generator-brief">
      <label>Describe the image<textarea rows={4} maxLength={4000} value={prompt} onChange={event => { setPrompt(event.target.value); setBrief(null); setGeneration(null) }} placeholder={targetKind === 'agent' ? 'A poised occult archivist with ember-lit eyes, practical field clothes, painted fantasy concept art…' : 'Describe the subject, composition, mood, lighting, materials, and details that must remain true…'} disabled={disabled || !!busy} /></label>
      <button className="primary" type="button" onClick={() => void refine()} disabled={disabled || !!busy || !prompt.trim()}><SiteIcon name="generate" />{busy === 'refine' ? 'Refining…' : brief ? 'Refine again' : 'Refine prompt'}</button>
    </div>
    {brief && <div className="artwork-refinement"><label>Refined prompt<textarea rows={7} maxLength={4000} value={brief.refinedPrompt} onChange={event => setBrief({ ...brief, refinedPrompt: event.target.value })} disabled={disabled || !!busy} /></label><details><summary>What to avoid</summary><textarea aria-label="Negative prompt" rows={3} maxLength={1200} value={brief.negativePrompt} onChange={event => setBrief({ ...brief, negativePrompt: event.target.value })} disabled={disabled || !!busy} /></details><button className="accent" type="button" onClick={() => void generate()} disabled={disabled || !!busy || !brief.refinedPrompt.trim()}><SiteIcon name="generate" />{busy === 'generate' ? 'Starting…' : `Generate ${brief.candidateCount} images`}</button></div>}
    {generation && <div className="artwork-generation" aria-live="polite">{!['completed', 'failed'].includes(generation.state) && <p role="status">{generation.state === 'ingesting' ? 'Saving the candidates…' : 'Generating image candidates…'}</p>}{generation.state === 'failed' && <p className="error" role="alert">{generation.error || 'Image generation failed. Your existing image was kept.'}</p>}{generation.candidates.length > 0 && <div className="artwork-candidates">{generation.candidates.map(candidate => <article key={candidate.id}><img src={candidate.imageUrl} alt={candidate.title} /><button type="button" disabled={disabled || !!busy} onClick={() => void choose(candidate)}>{busy === candidate.id ? 'Selecting…' : 'Use this image'}</button></article>)}</div>}</div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}
