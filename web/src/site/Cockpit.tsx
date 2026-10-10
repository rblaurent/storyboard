import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { presentWorkspaceEntity, type WorkspaceEntity } from '@redbamboo/workspace'
import { api, explain } from './api'
import { SiteIcon } from './icons'

type Phase='played'|'now'|'prepared'
type Lens='beat'|'discovery'|'belief'
interface CockpitSession{id:string;name:string;state:string;roleplayAnchor:string}
interface CockpitItem{id:string;phase:Phase;lens:Lens;position:number;typeName:string;entity:WorkspaceEntity}
interface CockpitSuggestion{id:string;title:string;summary:string;entityId:string;evidence:string[];confidence:string;state:string}
interface CockpitEvent{id:string;kind:string;channel:string;text:string;actor?:{name?:string;type?:string};occurredAt:string}
interface CockpitSnapshot{session:CockpitSession|null;items:CockpitItem[];suggestions:CockpitSuggestion[];events:CockpitEvent[];observationCursor:string|null}
interface CockpitSearch{items:WorkspaceEntity[]}

const phaseCopy:Record<Phase,{title:string;description:string}>={
  played:{title:'What happened',description:'Beats already crossed at the table.'},
  now:{title:'Now',description:'The context immediately in play.'},
  prepared:{title:'What was supposed to happen',description:'Prepared material still available.'},
}

export function Cockpit({campaignId,csrfToken}:{campaignId:string;csrfToken:string}){
  const base=`/campaigns/${campaignId}/cockpit`
  const [snapshot,setSnapshot]=useState<CockpitSnapshot|null>(null)
  const [error,setError]=useState('')
  const [query,setQuery]=useState('')
  const [results,setResults]=useState<WorkspaceEntity[]>([])
  const [busy,setBusy]=useState('')
  const mounted=useRef(true)
  const load=useCallback(async()=>{try{const value=await api<CockpitSnapshot>(base);if(mounted.current){setSnapshot(value);setError('')}}catch(cause){if(mounted.current)setError(explain(cause))}},[base])
  useEffect(()=>{mounted.current=true;void load();const timer=window.setInterval(()=>void load(),4000);return()=>{mounted.current=false;window.clearInterval(timer)}},[load])
  async function search(event:FormEvent){event.preventDefault();setBusy('search');setError('');try{const value=await api<CockpitSearch>(`${base}/entities?query=${encodeURIComponent(query.trim())}`);if(mounted.current)setResults(value.items)}catch(cause){if(mounted.current)setError(explain(cause))}finally{if(mounted.current)setBusy('')}}
  async function pin(entityId:string,phase:Phase='prepared'){setBusy(`pin:${entityId}`);setError('');try{await api(`${base}/items`,csrfToken,'POST',{entityId,phase,operationId:crypto.randomUUID()});setResults(values=>values.filter(value=>value.id!==entityId));await load()}catch(cause){if(mounted.current)setError(explain(cause))}finally{if(mounted.current)setBusy('')}}
  async function move(item:CockpitItem,phase:Phase,lens:Lens){if(item.phase===phase&&item.lens===lens)return;setBusy(`move:${item.id}`);try{await api(`${base}/items/${item.id}/move`,csrfToken,'POST',{phase,lens,operationId:crypto.randomUUID()});await load()}catch(cause){if(mounted.current)setError(explain(cause))}finally{if(mounted.current)setBusy('')}}
  async function decide(suggestion:CockpitSuggestion,decision:'accept'|'dismiss'){setBusy(`suggestion:${suggestion.id}`);try{const value=await api<CockpitSnapshot>(`${base}/suggestions/${suggestion.id}/decide`,csrfToken,'POST',{decision,operationId:crypto.randomUUID()});if(mounted.current)setSnapshot(value)}catch(cause){if(mounted.current)setError(explain(cause))}finally{if(mounted.current)setBusy('')}}
  return <section className="cockpit" aria-label="Game Master cockpit">
    <header className="cockpit-status"><div><span className="eyebrow">TABLE STATE</span><h2>{snapshot?.session?.name||'Preparation board'}</h2><p>{snapshot?.session?`Live · ${snapshot.session.roleplayAnchor}`:'No active transcript session. Prepare the board now; it will become live when the session starts.'}</p></div><div className={`cockpit-pulse${snapshot?.session?' is-live':''}`}><i/>{snapshot?.session?'Listening to the table':'Prep mode'}</div></header>
    {error&&<p className="cockpit-error" role="alert"><SiteIcon name="warning"/><span>{error}</span></p>}
    <div className="cockpit-workspace">
      <section className="cockpit-board" aria-label="Cockpit timeline">
        {(Object.keys(phaseCopy) as Phase[]).map(phase=><section className={`cockpit-lane is-${phase}`} key={phase} aria-labelledby={`cockpit-${phase}`}><header><div><span className="eyebrow">{phase==='now'?'LIVE CONTEXT':phase==='played'?'TABLE HISTORY':'NEXT IF NEEDED'}</span><h3 id={`cockpit-${phase}`}>{phaseCopy[phase].title}</h3><p>{phaseCopy[phase].description}</p></div><b>{snapshot?.items.filter(item=>item.phase===phase).length||0}</b></header><div className="cockpit-cards">{snapshot?.items.filter(item=>item.phase===phase).map(item=><EntityCard item={item} key={item.id} busy={busy===`move:${item.id}`} move={(nextPhase,nextLens)=>void move(item,nextPhase,nextLens)}/>)}{!snapshot?.items.some(item=>item.phase===phase)&&<p className="cockpit-lane-empty">{phase==='now'?'Pin what matters in this moment.':'Nothing here yet.'}</p>}</div></section>)}
      </section>
      <aside className="cockpit-context" aria-label="Campaign context">
        <section className="cockpit-context-section"><header><span className="eyebrow">AI COPILOT</span><h3>What you might need next</h3></header>{snapshot?.suggestions.length?snapshot.suggestions.map(suggestion=><article className="cockpit-suggestion" key={suggestion.id}><span><SiteIcon name="agent"/>{suggestion.confidence} confidence</span><h4>{suggestion.title}</h4><p>{suggestion.summary}</p><small>{suggestion.evidence.length} transcript {suggestion.evidence.length===1?'signal':'signals'}</small><div><button className="cockpit-accept" disabled={busy===`suggestion:${suggestion.id}`} onClick={()=>void decide(suggestion,'accept')}>Pin to Now</button><button disabled={busy===`suggestion:${suggestion.id}`} onClick={()=>void decide(suggestion,'dismiss')}>Dismiss</button></div></article>):<p className="cockpit-context-empty">I’ll surface grounded campaign context when the live transcript gives me a reason.</p>}</section>
        <section className="cockpit-context-section"><header><span className="eyebrow">TABLE SIGNAL</span><h3>What is happening</h3></header><ol className="cockpit-events">{snapshot?.events.slice(0,6).map(event=><li key={event.id}><span>{event.actor?.name||event.actor?.type||event.channel}</span><p>{event.text}</p></li>)}{!snapshot?.events.length&&<li className="cockpit-context-empty">Transcript events will appear here.</li>}</ol></section>
        <Knowledge title="What players have discovered" empty="No discoveries marked yet." items={snapshot?.items.filter(item=>item.lens==='discovery')||[]}/>
        <Knowledge title="What they believe" empty="No player beliefs marked yet." items={snapshot?.items.filter(item=>item.lens==='belief')||[]}/>
        <section className="cockpit-context-section"><header><span className="eyebrow">CANON</span><h3>Bring in campaign context</h3></header><form className="cockpit-search" onSubmit={search}><input value={query} onChange={event=>setQuery(event.target.value)} aria-label="Search campaign workspace" placeholder="NPC, clue, belief, location…"/><button aria-label="Search campaign workspace" disabled={busy==='search'}><SiteIcon name={busy==='search'?'busy':'search'} className={busy==='search'?'is-spinning':''}/></button></form><div className="cockpit-search-results">{results.map(entity=><SearchCard entity={entity} key={entity.id} busy={busy===`pin:${entity.id}`} pin={()=>void pin(entity.id)}/>)}</div></section>
      </aside>
    </div>
  </section>
}

function EntityCard({item,busy,move}:{item:CockpitItem;busy:boolean;move:(phase:Phase,lens:Lens)=>void}){
  const card=presentWorkspaceEntity(item.entity,undefined,'timeline')
  return <article className="cockpit-entity-card" style={{'--entity-color':card.color||'#dca68b'} as CSSProperties}><span>{item.typeName||card.eyebrow}</span><h4>{card.title}</h4>{card.summary&&<p>{card.summary}</p>}{card.fields.length>0&&<dl>{card.fields.slice(0,2).map(field=><div key={field.key}><dt>{field.name}</dt><dd>{renderValue(field.value)}</dd></div>)}</dl>}<div className="cockpit-card-state"><label>Story state<select aria-label={`Story state for ${card.title}`} value={item.phase} disabled={busy} onChange={event=>move(event.target.value as Phase,item.lens)}><option value="played">What happened</option><option value="now">Now</option><option value="prepared">Prepared</option></select></label><label>Player knowledge<select aria-label={`Player knowledge for ${card.title}`} value={item.lens} disabled={busy} onChange={event=>move(item.phase,event.target.value as Lens)}><option value="beat">GM context</option><option value="discovery">Discovered fact</option><option value="belief">Player belief</option></select></label></div></article>
}
function Knowledge({title,empty,items}:{title:string;empty:string;items:CockpitItem[]}){return <section className="cockpit-context-section cockpit-knowledge"><header><span className="eyebrow">PLAYER MODEL</span><h3>{title}</h3></header>{items.length?<ul>{items.map(item=><li key={item.id}><span>{item.typeName}</span><strong>{item.entity.name}</strong></li>)}</ul>:<p className="cockpit-context-empty">{empty}</p>}</section>}
function SearchCard({entity,busy,pin}:{entity:WorkspaceEntity;busy:boolean;pin:()=>void}){const card=presentWorkspaceEntity(entity,undefined,'compact');return <article className="cockpit-search-card"><div><span>{card.eyebrow}</span><strong>{card.title}</strong>{card.summary&&<small>{card.summary}</small>}</div><button disabled={busy} onClick={pin}><SiteIcon name={busy?'busy':'plus'} className={busy?'is-spinning':''}/>Prepare</button></article>}
function renderValue(value:unknown){if(Array.isArray(value))return value.map(String).join(' · ');if(value&&typeof value==='object')return Object.values(value as Record<string,unknown>).filter(item=>typeof item==='string').slice(0,3).join(' · ');return String(value)}
