import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { relay, route, productCookies, safeSetCookie, safeRedirect } from '../src/index'

const origin = 'https://storyboard.minititine.cc'
const campaign = '11111111-1111-4111-8111-111111111111'
const member = '22222222-2222-4222-8222-222222222222'
const key = 'a-disposable-test-key-with-at-least-32-characters'
const token = 'a'.repeat(43)
const env = { STORYBOARD_PROXY_KEY: key }
const url = (p: string) => new URL(origin + p)

test('narrow route/method/query matrix includes only the frozen product boundary', () => {
  const routes: [string, string[]][] = [
    ['/', ['GET']], [`/campaigns/${campaign}/description`, ['GET']], [`/campaigns/${campaign}/players`, ['GET']], [`/campaigns/${campaign}/music`, ['GET']], [`/campaigns/${campaign}/visuals`, ['GET']], [`/campaigns/${campaign}/workspace`, ['GET']], [`/campaigns/${campaign}/projection`, ['GET']],
    ['/auth/google', ['GET']], ['/auth/callback?code=code&state=state&scope=openid&authuser=0&prompt=none', ['GET']], ['/api/me', ['GET']], ['/api/logout', ['POST']],
    ['/api/campaigns', ['GET', 'POST']], ['/api/campaigns?archived=true', ['GET']], [`/api/campaigns/${campaign}`, ['GET', 'PUT']], [`/api/campaigns/${campaign}/players`, ['GET', 'POST']],
    [`/api/campaigns/${campaign}/accounts?email=someone%40example.com`, ['GET']], [`/api/campaigns/${campaign}/archive`, ['POST']], [`/api/campaigns/${campaign}/restore`, ['POST']], [`/api/campaigns/${campaign}/generate`, ['POST']],
    [`/api/campaigns/${campaign}/players/${member}/presence`, ['POST']], [`/api/campaigns/${campaign}/players/${member}/remove`, ['POST']], [`/api/campaigns/${campaign}/operations/${member}`, ['GET']], [`/api/campaigns/${campaign}/media/cover`, ['GET']], [`/api/campaigns/${campaign}/media/characters/${member}`, ['GET']],
    [`/api/campaigns/${campaign}/music/status`, ['GET']], [`/api/campaigns/${campaign}/music/playlists?offset=0&limit=50`, ['GET']], [`/api/campaigns/${campaign}/music/playlists`, ['GET', 'POST']],
    [`/api/campaigns/${campaign}/music/playlists/${member}/tracks?offset=0&limit=100`, ['GET']], [`/api/campaigns/${campaign}/music/playlists/${member}/tracks`, ['GET', 'POST']], [`/api/campaigns/${campaign}/music/playlists/${member}/tracks/${member}/remove`, ['POST']],
    [`/api/campaigns/${campaign}/music/tracks`, ['GET', 'POST']], [`/api/campaigns/${campaign}/music/search`, ['POST']], [`/api/campaigns/${campaign}/music/find`, ['POST']], [`/api/campaigns/${campaign}/music/brief`, ['POST']],
    [`/api/campaigns/${campaign}/music/playback`, ['GET', 'POST']], [`/api/campaigns/${campaign}/music/browser-player`, ['POST']], [`/api/campaigns/${campaign}/music/queue`, ['GET', 'POST']], [`/api/campaigns/${campaign}/music/queue/clear`, ['POST']], [`/api/campaigns/${campaign}/music/queue/${member}/remove`, ['POST']],
    [`/api/campaigns/${campaign}/music/generations`, ['POST']], [`/api/campaigns/${campaign}/music/generations/${member}`, ['GET']], [`/api/campaigns/${campaign}/music/candidates/${member}/promote`, ['POST']],
    [`/api/campaigns/${campaign}/music/candidates/${member}/audio`, ['GET']], [`/api/campaigns/${campaign}/music/candidates/${member}/cover`, ['GET']], [`/api/campaigns/${campaign}/music/tracks/${member}/audio`, ['GET']], [`/api/campaigns/${campaign}/music/tracks/${member}/cover`, ['GET']],
    [`/api/campaigns/${campaign}/visuals/profile`, ['GET', 'PUT']], [`/api/campaigns/${campaign}/visuals/library`, ['GET']], [`/api/campaigns/${campaign}/visuals/match`, ['POST']], [`/api/campaigns/${campaign}/visuals/brief`, ['POST']],
    [`/api/campaigns/${campaign}/visuals/generations`, ['POST']], [`/api/campaigns/${campaign}/visuals/generations/${member}`, ['GET']], [`/api/campaigns/${campaign}/visuals/candidates/${member}/promote`, ['POST']], [`/api/campaigns/${campaign}/visuals/candidates/${member}/image`, ['GET']], [`/api/campaigns/${campaign}/visuals/images/${member}`, ['GET']],
    [`/api/campaigns/${campaign}/visuals/sets`, ['GET', 'POST']], [`/api/campaigns/${campaign}/visuals/sets/${member}`, ['GET']], [`/api/campaigns/${campaign}/visuals/sets/${member}/items`, ['POST']], [`/api/campaigns/${campaign}/visuals/queue`, ['GET', 'POST']], [`/api/campaigns/${campaign}/visuals/queue/clear`, ['POST']], [`/api/campaigns/${campaign}/visuals/queue/${member}/remove`, ['POST']], [`/api/campaigns/${campaign}/visuals/session`, ['GET']], [`/api/campaigns/${campaign}/visuals/session/commands`, ['POST']],
    [`/api/campaigns/${campaign}/workspace`, ['GET']], [`/api/campaigns/${campaign}/workspace/entities`, ['POST']], [`/api/campaigns/${campaign}/workspace/entities/${member}`, ['PUT']], [`/api/campaigns/${campaign}/workspace/entities/${member}/delete`, ['POST']],
    ['/assets/index-abcdefgh.js', ['GET']],
  ]
  for (const [path, methods] of routes) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(!!route(url(path), method), methods.includes(method), `${method} ${path}`)
  }
  for (const path of ['/', `/campaigns/${campaign}/description`, `/campaigns/${campaign}/players`, `/campaigns/${campaign}/music`, `/campaigns/${campaign}/visuals`, `/campaigns/${campaign}/workspace`, `/campaigns/${campaign}/projection`]) {
    assert.equal(route(url(path), 'GET')?.target, '/api/public/storyboard/site/', path)
  }
  for (const path of ['/api/entities', '/api/apps/storyboard/manage/accounts', '/api/settings', '/api/campaigns?archived=false', '/api/campaigns?archived=true&archived=true', '/api/me?token=x', `/api/campaigns/${campaign}/accounts?email=a%40b&all=true`, `/api/campaigns/${campaign}/accounts`, '/assets/index.js', '/assets/index-abcdefgh.js?bypass=1', '/assets/%2e%2e%2fsecret.js', '/api//me', '/auth/google?return=https://evil.test', '/api/public/storyboard/me', `/api/campaigns/${campaign}/delete`, '/campaigns/not-an-id/description']) assert.equal(route(url(path), 'GET'), null, path)
  assert.ok(route(url(`/api/campaigns/${campaign}/music/queue`), 'GET'))
})
test('request cookies are product only and ambiguous duplicate product values are removed', () => {
  assert.equal(productCookies(`leaf=secret; __Host-storyboard=${token}; Agent=secret; __Host-storyboard-login=${token}; __Host-storyboard-evil=${token}`), `__Host-storyboard=${token}; __Host-storyboard-login=${token}`)
  assert.equal(productCookies(`__Host-storyboard=${token}; __Host-storyboard=${token}`), '')
  assert.equal(productCookies('__Host-storyboard=invalid'), '')
})
test('Set-Cookie requires exact product name and secure HttpOnly host-only scope, including expiration', () => {
  assert.equal(safeSetCookie(`__Host-storyboard=${token}; path=/; secure; httponly; samesite=lax`), true)
  assert.equal(safeSetCookie('__Host-storyboard=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure; httponly; samesite=lax'), true)
  assert.equal(safeSetCookie('__Host-storyboard-login=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure; httponly; samesite=lax'), true)
  for (const c of [`Leaf=${token}; Path=/; Secure; HttpOnly; SameSite=Lax`, `__Host-storyboard=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Domain=.minititine.cc`, `__Host-storyboard=${token}; Path=/; HttpOnly; SameSite=Lax`, `__Host-storyboard=${token}; Path=/; Secure; SameSite=Lax`, `__Host-storyboard=${token}; Path=/other; Secure; HttpOnly; SameSite=Lax`, `__Host-storyboard=${token}; Path=/; Path=/other; Secure; HttpOnly; SameSite=Lax`]) assert.equal(safeSetCookie(c), false)
})
test('relay constructs fresh headers and exact HMAC proof; bearer and provenance never cross', async () => {
  const query = '?email=someone%40example.com'
  let calls = 0
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++
    assert.equal(String(input), `https://redleaf.minititine.cc/api/public/storyboard/campaigns/${campaign}/accounts${query}`)
    const h = new Headers(init?.headers)
    assert.deepEqual([...h.keys()].sort(), ['accept', 'cookie', 'x-storyboard-origin', 'x-storyboard-proof', 'x-storyboard-time'])
    assert.equal(h.get('Cookie'), `__Host-storyboard=${token}`)
    assert.equal(h.get('X-Storyboard-Time'), '1700000000')
    assert.equal(h.get('X-Storyboard-Proof'), createHmac('sha256', key).update(`GET\n/api/public/storyboard/campaigns/${campaign}/accounts${query}\n1700000000\n${origin}`).digest('hex'))
    assert.equal(init?.redirect, 'manual')
    return new Response('[]', { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Leak': 'private' } })
  }) as typeof fetch
  const res = await relay(new Request(origin + `/api/campaigns/${campaign}/accounts` + query, { headers: { Cookie: `Leaf=secret; __Host-storyboard=${token}`, Authorization: 'Bearer secret', 'X-Compute-Provenance': 'secret', 'X-Storyboard-Proof': 'forged', 'X-Forwarded-Host': 'evil.test' } }), env, send, 1700000000000)
  assert.equal(calls, 1); assert.equal(res.status, 200); assert.equal(res.headers.get('Cache-Control'), 'no-store'); assert.equal(res.headers.get('X-Leak'), null); assert.equal(res.headers.get('Access-Control-Allow-Origin'), null)
})
test('generated audio preserves one bounded byte range and the upstream partial response contract', async () => {
  const path = `/api/campaigns/${campaign}/music/candidates/${member}/audio`
  const send = (async (_: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers); assert.equal(headers.get('Range'), 'bytes=10-19'); assert.equal(headers.get('Accept'), '*/*')
    return new Response(new Uint8Array(10), { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes 10-19/100', 'Content-Length': '10', 'X-Private': 'no' } })
  }) as typeof fetch
  const response = await relay(new Request(origin + path, { headers: { Range: 'bytes=10-19', Cookie: `__Host-storyboard=${token}` } }), env, send)
  assert.equal(response.status, 206); assert.equal(response.headers.get('Accept-Ranges'), 'bytes'); assert.equal(response.headers.get('Content-Range'), 'bytes 10-19/100'); assert.equal(response.headers.get('Content-Length'), '10'); assert.equal(response.headers.get('X-Private'), null)
})
test('mutation requires same-origin JSON, buffers its body, and forwards CSRF exactly; rejected routes never fetch', async () => {
  let calls = 0
  const send = (async (_: unknown, init?: RequestInit) => { calls++; const h = new Headers(init?.headers); assert.equal(h.get('Origin'), origin); assert.equal(h.get('X-CSRF-Token'), 'b'.repeat(64)); assert.equal(h.get('Content-Type'), 'application/json'); assert.equal(h.get('Authorization'), null); assert.ok(init?.body instanceof ArrayBuffer); assert.equal(new TextDecoder().decode(init.body), '{}'); return new Response('{}') }) as typeof fetch
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': 'b'.repeat(64), Authorization: 'Bearer secret' }
  assert.equal((await relay(new Request(origin + '/api/campaigns', { method: 'POST', headers, body: '{}' }), env, send)).status, 200)
  assert.equal((await relay(new Request(origin + '/api/campaigns', { method: 'POST', headers: { ...headers, Origin: 'https://evil.test' }, body: '{}' }), env, send)).status, 403)
  assert.equal((await relay(new Request(origin + '/api/entities'), env, send)).status, 404)
  assert.equal((await relay(new Request('https://evil.test/api/me'), env, send)).status, 403)
  assert.equal(calls, 1)
})

test('mutation body is bounded before the origin fetch', async () => {
  let calls = 0
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': 'b'.repeat(64) }
  const response = await relay(new Request(origin + '/api/campaigns', { method: 'POST', headers, body: JSON.stringify({ value: 'x'.repeat(65536) }) }), env, (async () => { calls++; return new Response('{}') }) as typeof fetch)
  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { error: 'request_too_large' })
  assert.equal(calls, 0)
})
test('redirects restricted to exact Google auth endpoint and callback root', async () => {
  const google = 'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=' + encodeURIComponent(origin + '/auth/callback') + '&state=bound'
  assert.equal(safeRedirect(google, '/auth/google', origin), google)
  for (const dest of ['https://evil.test/', 'https://accounts.google.com.evil.test/o/oauth2/v2/auth', 'https://accounts.google.com/other', '//evil.test/', '/api/entities', origin + '/', google.replace('storyboard', 'evil')]) assert.equal(safeRedirect(dest, '/auth/google', origin), null)
  assert.equal(safeRedirect('/', '/auth/callback', origin), '/')
  assert.equal(safeRedirect('/', '/api/me', origin), null)
  const res = await relay(new Request(origin + '/api/me'), env, (async () => new Response(null, { status: 302, headers: { Location: 'https://evil.test' } })) as typeof fetch)
  assert.equal(res.status, 502); assert.equal(res.headers.get('Location'), null)
})
test('cookie response isolation and no-store for API/auth/media; only hashed static is immutable', async () => {
  const send = (async () => {
    const h = new Headers({ 'Content-Type': 'application/json' })
    h.append('Set-Cookie', `__Host-storyboard=${token}; Path=/; Secure; HttpOnly; SameSite=Lax`)
    h.append('Set-Cookie', `Leaf=${token}; Path=/; Secure; HttpOnly; SameSite=Lax`)
    return new Response('{}', { headers: h })
  }) as typeof fetch
  for (const path of ['/api/me', `/api/campaigns/${campaign}/media/cover`, '/', `/campaigns/${campaign}/players`]) {
    const res = await relay(new Request(origin + path), env, send)
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    assert.equal((res.headers.get('Set-Cookie') || '').includes('Leaf='), false)
    if (path.startsWith('/api/')) assert.match(res.headers.get('Set-Cookie')!, /__Host-storyboard=/)
    else assert.equal(res.headers.get('Set-Cookie'), null)
    assert.match(res.headers.get('Content-Security-Policy')!, /https:\/\/lh3.googleusercontent.com/)
  }
  const staticResponse = await relay(new Request(origin + '/assets/index-abcdefgh.js', { headers: { Cookie: `__Host-storyboard=${token}` } }), env, (async (_: unknown, init?: RequestInit) => { assert.equal(new Headers(init?.headers).get('Cookie'), null); return new Response('code') }) as typeof fetch)
  assert.equal(staticResponse.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
  const missing = await relay(new Request(origin + '/assets/index-abcdefgh.js'), env, (async () => new Response('missing', { status: 404 })) as typeof fetch)
  assert.equal(missing.headers.get('Cache-Control'), 'no-store')
})
test('OAuth error recovery never reflects upstream errors and missing key fails closed', async () => {
  const response = await relay(new Request(origin + '/auth/callback?error=access_denied&state=x'), env, (async () => new Response('secret upstream debug', { status: 401 })) as typeof fetch)
  assert.equal(response.status, 401); const html = await response.text(); assert.match(html, /Sign in with Google/); assert.doesNotMatch(html, /secret upstream debug/); assert.equal(response.headers.get('Cache-Control'), 'no-store')
  const missing = await relay(new Request(origin + '/api/me'), { STORYBOARD_PROXY_KEY: '' }, (async () => { throw Error('must not fetch') }) as typeof fetch)
  assert.equal(missing.status, 503)
})
test('raw traversal is rejected before URL normalization and Workers getAll cookie lines stay separate', async () => {
  let calls = 0
  const send = (async () => { calls++; return new Response('{}') }) as typeof fetch
  for (const path of ['/assets/../api/me', '/assets/%2e%2e/api/me', '/assets/%2E%2E%2Fsecret', '/api//me']) {
    // Models the raw incoming URL, before the WHATWG Request constructor normalizes it.
    const raw = { url: origin + path, method: 'GET', headers: new Headers() } as Request
    assert.equal((await relay(raw, env, send)).status, 404)
  }
  assert.equal(calls, 0)
  const headers = new Headers()
  Object.defineProperty(headers, 'getSetCookie', { value: undefined })
  Object.defineProperty(headers, 'getAll', { value: () => ['__Host-storyboard=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure; httponly; samesite=lax', 'Leaf=private; Path=/; Secure; HttpOnly'] })
  const upstream = { headers, status: 200, ok: true, body: null } as Response
  const res = await relay(new Request(origin + '/api/me'), env, (async () => upstream) as typeof fetch)
  assert.match(res.headers.get('Set-Cookie')!, /expires=Thu, 01 Jan 1970/)
  assert.doesNotMatch(res.headers.get('Set-Cookie')!, /Leaf=private/)
})

// Exact ASP.NET-emitted headers, captured by the backend suite; no cookie literals.
test('actual Access issue/login-cleanup/logout headers propagate through relay', async () => {
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const file = join(process.env.REDLEAF_SCRATCH_DIR!, 'storyboard-backend', 'access-cookie-headers.json')
  const cookies: string[] = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(cookies.length, 3)
  for (const cookie of cookies) {
    assert.equal(safeSetCookie(cookie), true)
    const upstream = new Response('{}', { headers: { 'Set-Cookie': cookie } })
    const response = await relay(new Request(origin + '/auth/callback?code=fixture&state=fixture'), env, (async () => upstream) as typeof fetch)
    assert.deepEqual(response.headers.getSetCookie(), [cookie])
  }
})
test('CSP permits blobs only for scoped images/media and rejects missing/ambiguous cookie SameSite', async () => {
  const response = await relay(new Request(origin + '/'), env, (async () => new Response('<html></html>')) as typeof fetch)
  const directives = response.headers.get('Content-Security-Policy')!.split(';').map(s => s.trim())
  assert.match(directives.find(d => d.startsWith('img-src '))!, /(?:^| )blob:(?: |$)/)
  assert.deepEqual(directives.filter(d => d.includes('blob:')).map(d => d.split(' ')[0]), ['img-src', 'media-src'])
  assert.equal(directives.find(d => d.startsWith('script-src ')), "script-src 'self' 'unsafe-eval' https://sdk.scdn.co")
  assert.equal(directives.find(d => d.startsWith('connect-src ')), "connect-src 'self' https://*.spotify.com wss://*.spotify.com https://*.scdn.co")
  assert.equal(directives.find(d => d.startsWith('media-src ')), "media-src 'self' blob: https://*.scdn.co")
  assert.equal(directives.find(d => d.startsWith('frame-src ')), 'frame-src https://sdk.scdn.co')
  for (const suffix of ['', '; SameSite=Strict', '; SameSite=None', '; SameSite=Lax; SameSite=Lax']) assert.equal(safeSetCookie(`__Host-storyboard=${token}; Path=/; Secure; HttpOnly${suffix}`), false)
})
