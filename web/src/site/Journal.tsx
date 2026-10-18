import { useCallback, useEffect, useRef, useState } from 'react'
import { api, explain, imageSource } from './api'
import { SiteIcon } from './icons'
import { useCampaignTopic } from './Changes'

export interface JournalField { key: string; name: string; fieldType: string; value: unknown }
export interface JournalEntity { id: string; typeSlug: string; typeName: string; title: string; description: string; fields: JournalField[]; imageUrl: string | null; updatedAt: string; revealedAt: string }
export interface JournalSnapshot { items: JournalEntity[]; latestRevealAt: string }

export function Journal({ campaignId }: { campaignId: string }) {
  const [snapshot, setSnapshot] = useState<JournalSnapshot | null>(null)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const load = useCallback(async () => {
    try { const value = await api<JournalSnapshot>(`/campaigns/${campaignId}/journal`); if (mounted.current) { setSnapshot(value); setError('') } }
    catch (cause) { if (mounted.current) setError(explain(cause)) }
  }, [campaignId])
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false } }, [load])
  useCampaignTopic(campaignId, 'journal', () => { void load() })
  return <section className="journal-page">
    <header className="campaign-page-header"><div><h2>Journal</h2><p>People, places, clues, and discoveries that have become part of your story.</p></div></header>
    {error && <p className="error" role="alert">{error}</p>}
    {!snapshot ? <p role="status">Opening the journal…</p> : snapshot.items.length === 0 ? <div className="journal-empty"><SiteIcon name="notebook" size={32} /><h3>Nothing revealed yet</h3><p>New discoveries will appear here when they enter the story.</p></div> : <div className="journal-grid">{snapshot.items.map(item => <JournalCard item={item} key={item.id} />)}</div>}
  </section>
}

function JournalCard({ item }: { item: JournalEntity }) {
  const image = imageSource(item.imageUrl)
  return <article className="journal-card">
    {image && <img src={image} alt="" />}
    <div><span>{item.typeName}</span><h3>{item.title}</h3>{item.description && <p>{item.description}</p>}{item.fields.length > 0 && <dl>{item.fields.map(field => <div key={field.key}><dt>{field.name}</dt><dd>{render(field.value)}</dd></div>)}</dl>}<small>Discovered {new Date(item.revealedAt).toLocaleString()}</small></div>
  </article>
}

function render(value: unknown) { if (Array.isArray(value)) return value.map(String).join(' · '); if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).filter(item => typeof item === 'string' || typeof item === 'number').join(' · '); return String(value ?? '') }
