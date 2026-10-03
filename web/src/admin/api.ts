export class ManagementError extends Error { constructor(public code: string, public status: number) { super(code) } }
export async function hostApi<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', signal, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  const value = await response.json().catch(() => ({ error: 'invalid_response' }))
  if (!response.ok || value.error) throw new ManagementError(value.error || 'request_failed', response.status)
  return value as T
}
export const management = <T,>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) => hostApi<T>('/api/apps/storyboard' + path, method, body, signal)
export function managementMessage(cause: unknown) {
  if (cause instanceof ManagementError) {
    if (cause.code === 'extension_owner_required') return 'Only the Storyboard installation owner can manage it. If it has not been prepared, a Leaf administrator can prepare it below.'
    if (cause.code === 'leaf_administrator_required' || cause.status === 403) return 'A Leaf administrator or the Storyboard installation owner is required.'
    if (cause.status === 401) return 'Sign in to Leaf to manage Storyboard.'
    if (cause.code === 'https_origin_required') return 'Enter an HTTPS origin without a path, query or fragment.'
    if (cause.code === 'invalid_connection_key') return 'The site connection key must have at least 32 characters.'
    if (cause.code === 'owning_agent_required') return 'Select the Agent that owns this private installation, then prepare Storyboard.'
    if (cause.code === 'storyboard_not_configured') return 'Storyboard has not been prepared yet.'
  }
  return 'The request could not be completed. Check the connection and try again.'
}
