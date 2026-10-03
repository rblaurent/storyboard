export interface Account { id: string; name: string; avatar: string; canCreate: boolean; csrfToken: string }
export interface Person { id: string; name: string; avatar: string }
export interface Campaign { id: string; name: string; description: string; summary: string; summaryStale: boolean; image: string | null; archived: boolean; revision: number; role: 'gm' | 'player'; playerCount: number; players: Person[] }
export interface Player extends Person { accountId: string; role: 'gm' | 'player'; characters: { id: string; name: string; portrait: string | null }[] }
export interface Operation { id: string; kind: 'image' | 'summary'; state: 'pending' | 'refining' | 'generating' | 'saving' | 'completed' | 'failed'; error: string; refinedPrompt: string; applied: boolean }
export class ApiError extends Error { constructor(public code: string, public status: number) { super(code) } }
const messages: Record<string, string> = {
  campaign_changed: 'This campaign changed elsewhere. Your draft is kept. Review the latest saved version before trying again.',
  write_conflict: 'This campaign changed elsewhere. Your draft is kept. Review the latest saved version before trying again.',
  last_game_master: 'A campaign must keep at least one Game Master. Add another GM before changing this membership.',
  game_master_required: 'Only a Game Master can make this change.',
  campaign_access_denied: 'You do not have access to this campaign. Ask its Game Master for access.',
  campaign_creation_not_enabled: 'Campaign creation has not been enabled for your account.',
  generation_queue_full: 'There are already several requests in progress. Please try again shortly.',
  account_disabled: 'This account is disabled. Contact the Storyboard administrator.',
  not_found: 'This item is unavailable, or you no longer have access.',
  storyboard_not_configured: 'Storyboard is still being prepared. Please try again later.',
  site_connection_rejected: 'Storyboard’s connection needs attention. Please try again later.',
  site_connection_unavailable: 'Storyboard’s connection is unavailable. Please try again later.',
  request_origin_rejected: 'Your session could not confirm this change. Reload and sign in again if needed.',
}
export function explain(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Your session expired. Sign in with Google to continue.'
    if (messages[cause.code]) return messages[cause.code]
    if (cause.status === 403) return 'Your account does not have permission to do this.'
    if (cause.status === 409) return 'The saved information changed. Your draft is kept; review the latest version.'
    if (cause.status >= 500) return 'Storyboard is temporarily unavailable. Your draft is kept. Please try again.'
  }
  return 'The connection was interrupted. Your draft is kept. Please try again.'
}
export async function api<T>(path: string, csrf = '', method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, { method, credentials: 'same-origin', cache: 'no-store', signal, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  const json = await response.json().catch(() => ({ error: 'storyboard_unavailable' }))
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('storyboard:signout'))
    throw new ApiError(json.error || 'request_failed', response.status)
  }
  return json as T
}
// Remote images are limited to Google's verified avatar hosts. Campaign artwork is scoped media.
export function imageSource(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  if (/^\/api\/campaigns\/[0-9a-f-]{36}\/media\/(?:cover|characters\/[0-9a-f-]{36})$/i.test(value)) return value
  try { const u = new URL(value); if (u.protocol === 'https:' && /^lh[3-6]\.googleusercontent\.com$/.test(u.hostname) && !u.username && !u.password && !u.port) return u.href } catch { /* Untrusted image URL. */ }
  return undefined
}
