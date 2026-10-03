import { useEffect, useState } from 'react'
import { Button, Input, ProtectedValueField, SectionHeader, SettingRow, type ProtectedValueStatus } from '@redbamboo/ui'
import { hostApi, managementMessage } from './api'
import { EntityCardSelector } from './EntityCardSelector'
interface Field { key: string; path: string; label: string; type: string; value: string | null; configured: boolean; protection: ProtectedValueStatus['protection'] | null; constraints?: { target_type?: string } }
interface Section { id: string; name: string; fields: Field[] }
interface Descriptor { id: string; sections: Section[] }
const endpoint = '/api/extensions/storyboard/settings'
export function Settings() {
  const [descriptor, setDescriptor] = useState<Descriptor | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)
  const [protectedVersion, setProtectedVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); setBusy(true)
    hostApi<Descriptor>(endpoint, 'GET', undefined, controller.signal).then(d => { if (!controller.signal.aborted) { setDescriptor(d); setError('') } }).catch(c => { if (!controller.signal.aborted) { setDescriptor(null); setError(managementMessage(c)) } }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [version])
  async function write(section: string, values: Record<string, string>, validateOnly = false) {
    setBusy(true); setError(''); setNotice('')
    try {
      await hostApi(endpoint, 'PUT', { section, values, validateOnly })
      if (!validateOnly) { setDraft(d => { const next = { ...d }; for (const key of Object.keys(values)) delete next[key]; return next }); setProtectedVersion(v => v + 1); setVersion(v => v + 1) }
      setNotice(validateOnly ? 'Settings validated. Nothing has been saved.' : 'Settings saved.')
    } catch (c) { const message = managementMessage(c); setError(message); throw new Error(message) } finally { setBusy(false) }
  }
  return <div className="w-full min-w-0 space-y-6 text-foreground" data-ui-surface="storyboard-settings" aria-busy={busy}>
    <div className="flex flex-wrap items-start gap-2"><p className="min-w-0 flex-1 text-sm text-muted-foreground">Configure the public website, sign-in and campaign generation.</p><Button variant="ghost" size="sm" aria-label="Reload settings" disabled={busy} onClick={() => setVersion(v => v + 1)}><i className={`ph-bold ph-arrows-clockwise ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />Reload</Button></div>
    {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"><p className="min-w-0 flex-1">{error}</p><Button variant="outline" size="sm" disabled={busy} onClick={() => setVersion(v => v + 1)}>Try again</Button></div>}{notice && <p role="status" className="text-sm text-foreground">{notice}</p>}{busy && !descriptor && <p role="status" className="text-sm text-muted-foreground">Loading settings…</p>}
    {descriptor?.sections.map(section => <section key={section.id} aria-labelledby={`storyboard-settings-${section.id}`} className="space-y-3"><h2 id={`storyboard-settings-${section.id}`} className="sr-only">{section.name}</h2><SectionHeader>{section.name}</SectionHeader>{section.fields.map(field => <div key={field.key} data-setting-path={field.path}><SettingRow label={field.label} hint={field.type === 'secret' ? 'Leave the replacement blank or cancel to keep the saved value.' : undefined}>
      {field.type === 'secret' ? <ProtectedValueField key={`${field.key}-${protectedVersion}`} id={`storyboard-${field.key}`} label={field.label} kind="token" className="w-full min-w-0 sm:max-w-sm [&>label]:sr-only" status={{ configured: field.configured, protection: field.protection || 'unknown', verification: 'unverified' }} disabled={busy} allowClear={false} onReplace={value => write(section.id, { [field.key]: value })} /> : field.type === 'entity_ref' && field.constraints?.target_type ? <EntityCardSelector label={field.label} targetType={field.constraints.target_type} value={draft[field.key] ?? field.value ?? ''} disabled={busy} onChange={value => setDraft(d => ({ ...d, [field.key]: value }))} /> : <Input id={`storyboard-${field.key}`} aria-label={field.label} className="w-full min-w-0 sm:max-w-sm" value={draft[field.key] ?? field.value ?? ''} disabled={busy} maxLength={field.key === 'visual_brief' ? 4000 : 1000} onChange={e => setDraft(d => ({ ...d, [field.key]: e.target.value }))} />}
    </SettingRow></div>)}<div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" disabled={busy || !section.fields.some(f => f.type !== 'secret' && f.key in draft)} onClick={() => void write(section.id, Object.fromEntries(section.fields.filter(f => f.type !== 'secret' && f.key in draft).map(f => [f.key, draft[f.key]]))).catch(() => {})}>Save {section.name.toLowerCase()}</Button><Button variant="ghost" size="sm" disabled={busy || !section.fields.some(f => f.type !== 'secret' && f.key in draft)} onClick={() => void write(section.id, Object.fromEntries(section.fields.filter(f => f.type !== 'secret' && f.key in draft).map(f => [f.key, draft[f.key]])), true).catch(() => {})}>Validate</Button></div></section>)}
  </div>
}
