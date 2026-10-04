// Transport boundary only. Leaf owns identity, membership, operations and storage.
export interface Env { STORYBOARD_PROXY_KEY: string; STORYBOARD_PUBLIC_ORIGIN?: string }
const upstream = 'https://redleaf.minititine.cc'
const mount = '/api/public/storyboard'
const id = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const cookies = new Set(['__Host-storyboard', '__Host-storyboard-login'])
const csp = "default-src 'none'; script-src 'self' 'unsafe-eval' https://open.spotify.com https://embed-cdn.spotifycdn.com; style-src 'self'; img-src 'self' blob: https://lh3.googleusercontent.com https://lh4.googleusercontent.com https://lh5.googleusercontent.com https://lh6.googleusercontent.com https://i.scdn.co; font-src 'self'; connect-src 'self'; frame-src https://open.spotify.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"

interface Route { target: string; static: boolean; immutable: boolean }
export function route(url: URL, method: string): Route | null {
  const p = url.pathname
  // Reject every encoded path, duplicate slash and ambiguous separator. IDs/assets need none.
  if (p.includes('%') || p.includes('\\') || p.includes('//') || p.split('/').some(s => s === '.' || s === '..')) return null
  const keys = [...url.searchParams.keys()]
  if (new Set(keys).size !== keys.length) return null
  const query = (allowed: string[]) => keys.every(k => allowed.includes(k))
  const match = (pattern: string) => new RegExp(`^${pattern}$`).test(p)
  if (p === '/' || match(`/campaigns/${id}/(?:description|players|music)`)) {
    return method === 'GET' && query([]) ? { target: mount + '/site' + p, static: true, immutable: false } : null
  }
  if (/^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2|svg|png|webp|jpg)$/.test(p)) {
    return method === 'GET' && query([]) ? { target: mount + '/site' + p, static: true, immutable: true } : null
  }
  if (p === '/auth/google' && method === 'GET' && query([])) return { target: mount + p, static: false, immutable: false }
  if (p === '/auth/callback' && method === 'GET' && query(['code', 'state', 'error', 'error_description', 'scope', 'authuser', 'prompt', 'iss']) && keys.length > 0) return { target: mount + p, static: false, immutable: false }
  let allowed = false
  if (p === '/api/me') allowed = method === 'GET' && query([])
  if (p === '/api/logout') allowed = method === 'POST' && query([])
  if (p === '/api/campaigns') allowed = (method === 'GET' && query(['archived']) && (!keys.length || url.searchParams.get('archived') === 'true')) || (method === 'POST' && query([]))
  if (match(`/api/campaigns/${id}`)) allowed = ['GET', 'PUT'].includes(method) && query([])
  if (match(`/api/campaigns/${id}/(?:archive|restore|generate)`)) allowed = method === 'POST' && query([])
  if (match(`/api/campaigns/${id}/players`)) allowed = ['GET', 'POST'].includes(method) && query([])
  if (match(`/api/campaigns/${id}/players/${id}/remove`)) allowed = method === 'POST' && query([])
  if (match(`/api/campaigns/${id}/accounts`)) allowed = method === 'GET' && query(['email']) && keys.length === 1 && (url.searchParams.get('email')?.length ?? 0) <= 254 && /^[^\s@]+@[^\s@]+$/.test(url.searchParams.get('email') ?? '')
  if (match(`/api/campaigns/${id}/operations/${id}`) || match(`/api/campaigns/${id}/media/(?:cover|characters/${id})`)) allowed = method === 'GET' && query([])
  if (match(`/api/campaigns/${id}/music/status`)) allowed = method === 'GET' && query([])
  if (match(`/api/campaigns/${id}/music/playback`)) allowed = ['GET', 'POST'].includes(method) && query([])
  if (match(`/api/campaigns/${id}/music/queue`)) allowed = ['GET', 'POST'].includes(method) && query([])
  if (match(`/api/campaigns/${id}/music/queue/(?:clear|${id}/remove)`)) allowed = method === 'POST' && query([])
  if (match(`/api/campaigns/${id}/music/(?:find|brief|search|generations)`)) allowed = method === 'POST' && query([])
  if (match(`/api/campaigns/${id}/music/tracks`)) allowed = ['GET', 'POST'].includes(method) && query([])
  if (match(`/api/campaigns/${id}/music/playlists`)) allowed = method === 'POST' && query([]) || method === 'GET' && query(['offset', 'limit']) && keys.every(k => /^\d{1,3}$/.test(url.searchParams.get(k) || ''))
  if (match(`/api/campaigns/${id}/music/playlists/${id}/tracks`)) allowed = method === 'POST' && query([]) || method === 'GET' && query(['offset', 'limit']) && keys.every(k => /^\d{1,3}$/.test(url.searchParams.get(k) || ''))
  if (match(`/api/campaigns/${id}/music/playlists/${id}/tracks/${id}/remove`)) allowed = method === 'POST' && query([])
  if (match(`/api/campaigns/${id}/music/generations/${id}`)) allowed = method === 'GET' && query([])
  if (match(`/api/campaigns/${id}/music/candidates/${id}/promote`)) allowed = method === 'POST' && query([])
  if (match(`/api/campaigns/${id}/music/candidates/${id}/(?:audio|cover)`) || match(`/api/campaigns/${id}/music/tracks/${id}/(?:audio|cover)`)) allowed = method === 'GET' && query([])
  return allowed ? { target: mount + p.slice(4), static: false, immutable: false } : null
}

export function productCookies(raw: string): string {
  const values = new Map<string, string[]>()
  for (const part of raw.split(';')) {
    const m = /^\s*([^=\s]+)=([A-Za-z0-9_-]{43})\s*$/.exec(part)
    if (m && cookies.has(m[1])) values.set(m[1], [...values.get(m[1]) ?? [], m[2]])
  }
  return [...values].filter(([, v]) => v.length === 1).map(([k, v]) => `${k}=${v[0]}`).join('; ')
}
export function safeSetCookie(raw: string): boolean {
  const parts = raw.split(';').map(s => s.trim())
  const m = /^([^=]+)=([A-Za-z0-9_-]{43}|)$/.exec(parts[0])
  if (!m || !cookies.has(m[1])) return false
  const attrs = parts.slice(1).map(s => s.toLowerCase())
  // ASP.NET cookie deletion may omit SameSite; Secure + HttpOnly + exact host/path remain mandatory.
  return attrs.includes('secure') && attrs.includes('httponly') && attrs.filter(s => s.startsWith('path=')).length === 1 && attrs.includes('path=/') && !attrs.some(s => /^domain\s*=/.test(s)) && attrs.filter(s => s.startsWith('samesite=')).length === 1 && attrs.includes('samesite=lax')
}
export function safeRedirect(location: string, path: string, origin: string): string | null {
  if (location === '/' && path === '/auth/callback') return '/'
  if (path !== '/auth/google') return null
  try {
    const u = new URL(location)
    if (u.origin !== 'https://accounts.google.com' || u.pathname !== '/o/oauth2/v2/auth' || u.username || u.password || u.hash || u.searchParams.get('redirect_uri') !== origin + '/auth/callback') return null
    return u.href
  } catch { return null }
}
function security(headers: Headers) {
  headers.set('Content-Security-Policy', csp)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  headers.set('Strict-Transport-Security', 'max-age=31536000')
}
function error(code: string, status: number) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); security(headers)
  return new Response(JSON.stringify({ error: code }), { status, headers })
}
export async function proof(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const imported = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(message)))].map(n => n.toString(16).padStart(2, '0')).join('')
}
// Injectable fetch/clock allow tests to prove the actual forwarded boundary, without a service.
export async function relay(request: Request, env: Env, send: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  // Check the incoming representation before URL normalization can erase dot segments.
  const rawPath = request.url.replace(/^https?:\/\/[^/]+/, '').split(/[?#]/, 1)[0]
  if (rawPath.includes('%') || rawPath.includes('\\') || rawPath.includes('//') || rawPath.split('/').some(p => p === '.' || p === '..')) return error('route_not_allowed', 404)
  const url = new URL(request.url)
  const origin = env.STORYBOARD_PUBLIC_ORIGIN || 'https://storyboard.minititine.cc'
  if (url.origin !== origin) return error('site_origin_rejected', 403)
  const chosen = route(url, request.method)
  if (!chosen) return error('route_not_allowed', 404)
  if (!env.STORYBOARD_PROXY_KEY || env.STORYBOARD_PROXY_KEY.length < 32) return error('site_connection_unavailable', 503)
  const mutation = request.method !== 'GET'
  if (mutation && (request.headers.get('Origin') !== origin || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || ''))) return error('request_origin_rejected', 403)
  // Do not relay the incoming request stream across the public-to-origin hop. Mobile clients can
  // leave that stream coupled to the client connection, which makes an otherwise valid mutation
  // fail while the origin is reading it. Storyboard commands are deliberately small JSON payloads.
  let body: ArrayBuffer | undefined
  if (mutation) {
    const declared = Number(request.headers.get('Content-Length') || 0)
    if (!Number.isFinite(declared) || declared < 0 || declared > 65536) return error('request_too_large', 413)
    body = await request.arrayBuffer()
    if (body.byteLength > 65536) return error('request_too_large', 413)
  }
  const headers = new Headers({ Accept: chosen.static ? '*/*' : 'application/json' })
  if (!chosen.static) {
    const cookie = productCookies(request.headers.get('Cookie') || '')
    if (cookie) headers.set('Cookie', cookie)
  }
  if (mutation) {
    headers.set('Content-Type', 'application/json')
    headers.set('Origin', origin)
    const csrf = request.headers.get('X-CSRF-Token')
    if (csrf && /^[a-f0-9]{64}$/i.test(csrf)) headers.set('X-CSRF-Token', csrf)
  }
  const media = /\/music\/(?:candidates|tracks)\/.+\/(?:audio|cover)$/.test(url.pathname)
  const range = request.headers.get('Range')
  if (media) {
    headers.set('Accept', '*/*')
    if (range && /^bytes=\d*-\d*$/.test(range)) headers.set('Range', range)
  }
  const seconds = Math.floor(now / 1000).toString()
  headers.set('X-Storyboard-Time', seconds); headers.set('X-Storyboard-Origin', origin)
  headers.set('X-Storyboard-Proof', await proof(env.STORYBOARD_PROXY_KEY, `${request.method}\n${chosen.target}${url.search}\n${seconds}\n${origin}`))
  let response: Response
  try { response = await send(upstream + chosen.target + url.search, { method: request.method, headers, body, redirect: 'manual' }) }
  catch { return error('storyboard_unavailable', 502) }
  const out = new Headers()
  security(out); out.set('Cache-Control', chosen.immutable && response.ok ? 'public, max-age=31536000, immutable' : 'no-store')
  if (response.status >= 300 && response.status < 400) {
    const location = safeRedirect(response.headers.get('Location') || '', url.pathname, origin)
    if (!location) return error('upstream_redirect_rejected', 502)
    out.set('Location', location)
  } else {
    out.set('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream')
    if (media) for (const name of ['Accept-Ranges', 'Content-Range', 'Content-Length']) { const value = response.headers.get(name); if (value) out.set(name, value) }
  }
  if (!chosen.static) {
    // Workers exposes getAll for separate Set-Cookie lines (Expires contains a comma).
    const source = response.headers as Headers & { getSetCookie?: () => string[]; getAll?: (name: string) => string[] }
    const lines = source.getSetCookie ? source.getSetCookie() : source.getAll ? source.getAll('Set-Cookie') : []
    for (const cookie of lines) if (safeSetCookie(cookie)) out.append('Set-Cookie', cookie)
  }
  if (url.pathname.startsWith('/auth/') && response.status >= 400) {
    out.set('Content-Type', 'text/html; charset=utf-8')
    // Fixed recovery copy; never reflect upstream errors, code, state or account data.
    return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Storyboard · Sign-in interrupted</title><main><h1>Sign-in interrupted</h1><p>Your sign-in may have expired, or Storyboard may be unavailable. Please try again.</p><p><a href="/auth/google">Sign in with Google</a></p><p><a href="/">Back to Storyboard</a></p></main></html>', { status: response.status, headers: out })
  }
  return new Response(response.body, { status: response.status, headers: out })
}
export default { fetch: (request: Request, env: Env) => relay(request, env) }
