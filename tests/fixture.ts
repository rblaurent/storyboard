// DISPOSABLE API FIXTURE: proves source UI mechanics, never live authenticated acceptance.
import type { Page } from '@playwright/test'
import type { Campaign, MusicPlayback, MusicPlaylist, MusicTrack, Operation, Player } from '../web/src/site/api'
export const cid = '11111111-1111-4111-8111-111111111111'
export const aid = '22222222-2222-4222-8222-222222222222'
export const mid = '33333333-3333-4333-8333-333333333333'
export const oid = '44444444-4444-4444-8444-444444444444'
export const second = '55555555-5555-4555-8555-555555555555'
export const candidate = '66666666-6666-4666-8666-666666666666'
export const csrf = 'b'.repeat(64)
export async function fixture(page: Page, options: { player?: boolean; canCreate?: boolean; signedOut?: boolean } = {}) {
  const campaign: Campaign = { id: cid, name: 'The Glass Observatory', description: 'Above the cloud line, a silent observatory watches a sky that no longer follows its charts. Your crew has one night to discover what the astronomers left behind.', summary: 'A missing astronomer. A map of impossible stars. A small crew on the edge of a discovery that could change their world.', summaryStale: false, image: `/api/campaigns/${cid}/media/cover`, archived: false, revision: 3, role: options.player ? 'player' : 'gm', playerCount: 3, players: [{ id: aid, name: 'Alex', avatar: '' }, { id: mid, name: 'Sam', avatar: '' }, { id: second, name: 'Jules', avatar: '' }] }
  const players: Player[] = [{ id: mid, accountId: aid, name: 'Alex', avatar: '', role: 'gm', characters: [] }, { id: second, accountId: second, name: 'Sam', avatar: '', role: 'player', characters: [{ id: second, name: 'Elian Vale', portrait: `/api/campaigns/${cid}/media/characters/${second}` }] }]
  const tracks: MusicTrack[] = [{ id: 'track-one', name: 'Lanterns Beneath the Tide', artist: 'The Quiet Cartographers', album: 'Submerged Halls', imageUrl: null, durationMs: 214000, uri: 'spotify:track:one' }, { id: 'track-two', name: 'The Orrery Turns', artist: 'North Window', album: 'Impossible Stars', imageUrl: null, durationMs: 187000, uri: 'spotify:track:two' }]
  const playlists: MusicPlaylist[] = [{ id: 'playlist-one', name: 'Shinsekai Atmospheres', imageUrl: null, trackCount: 2, uri: 'spotify:playlist:one' }, { id: 'playlist-two', name: 'Quiet before the storm', imageUrl: null, trackCount: 18, uri: 'spotify:playlist:two' }]
  const playback: MusicPlayback = { available: true, playing: true, track: tracks[0], progressMs: 42000, deviceId: 'device-one', deviceName: 'Salle TV', volumePercent: 28, error: null }
  const musicGeneration = { id: oid, state: 'completed', error: '', creditsConsumed: 12, candidates: [{ id: candidate, title: 'The Drowned Crown A', tags: 'dark cinematic ambient', durationSeconds: 150, audio: `/api/campaigns/${cid}/music/candidates/${candidate}/audio`, cover: null, promotedTrack: '' }] }
  const state = { campaign, players, tracks, playlists, playback, musicGeneration, operation: { id: oid, kind: 'image', state: 'generating', error: '', refinedPrompt: 'A quiet observatory above a vast cloud sea at dusk.', applied: false } as Operation, requests: [] as { path: string; method: string; body: Record<string, unknown> | null; csrf: string | undefined }[], conflict: false, createFail: false, generationFail: false, pollFail: false, signedOut: !!options.signedOut, meFail: false, lastGm: false }
  const art = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 560"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#48576e"/><stop offset="1" stop-color="#d8ac7c"/></linearGradient><linearGradient id="cloud" x2="1" y2="0"><stop stop-color="#9ca9b0"/><stop offset="1" stop-color="#ddd6bf"/></linearGradient></defs><rect width="900" height="560" fill="url(#sky)"/><circle cx="710" cy="115" r="44" fill="#f5d5a0"/><path d="M0 380Q120 290 240 370T500 350T900 350V560H0Z" fill="url(#cloud)"/><path d="M0 470Q160 370 330 450T670 440T900 420V560H0Z" fill="#c6cbd0"/><path d="M310 560L395 240 565 255 640 560Z" fill="#39474b"/><path d="M370 280L405 168H560L590 280Z" fill="#b8aa88"/><path d="M390 170A85 85 0 0 1 560 170Z" fill="#2a3c49"/><path d="M450 280V215H510V280" fill="#273741"/><path d="M465 170V95L590 70" fill="none" stroke="#293842" stroke-width="13"/><path d="M395 300H565" stroke="#d0ba94" stroke-width="6"/><circle cx="155" cy="84" r="2" fill="#fff3d8"/><circle cx="290" cy="120" r="2" fill="#fff3d8"/></svg>'
  await page.route('**/api/**', async route => {
    const req = route.request(); const u = new URL(req.url()); const p = u.pathname; const method = req.method(); const body = req.postDataJSON() as Record<string, unknown> | null
    state.requests.push({ path: p + u.search, method, body, csrf: req.headers()['x-csrf-token'] })
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (p.endsWith('/media/cover') || p.includes('/media/characters/') || p.endsWith(`/music/candidates/${candidate}/cover`)) return route.fulfill({ contentType: 'image/svg+xml', headers: { 'Cache-Control': 'no-store' }, body: art })
    if (p.endsWith(`/music/candidates/${candidate}/audio`)) return route.fulfill({ contentType: 'audio/mpeg', headers: { 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' }, body: Buffer.from([1, 2, 3, 4, 5, 6]) })
    if (p === '/api/me') return state.signedOut ? json({ error: 'sign_in_required' }, 401) : state.meFail ? json({ error: 'storyboard_not_configured' }, 503) : json({ id: aid, name: 'Alex Morgan', avatar: '', canCreate: options.canCreate !== false, csrfToken: csrf })
    if (p === '/api/logout') { state.signedOut = true; return json({ ok: true }) }
    if (method !== 'GET' && req.headers()['x-csrf-token'] !== csrf) return json({ error: 'request_origin_rejected' }, 403)
    if (p === '/api/campaigns' && method === 'GET') return json(state.campaign.archived && !u.search ? [] : [state.campaign, { ...state.campaign, id: second, name: 'Letters from the Coast', image: null, summary: 'A weathered lighthouse, a town full of secrets, and letters arriving from a ship lost thirty years ago.', role: 'player', archived: false }])
    if (p === '/api/campaigns' && method === 'POST') { if (state.createFail) { state.createFail = false; return json({ error: 'storyboard_unavailable' }, 503) }; state.campaign.name = String(body!.name); return json(state.campaign) }
    if (p === `/api/campaigns/${cid}`) { if (method === 'PUT') { if (state.conflict) return json({ error: 'campaign_changed' }, 409); Object.assign(state.campaign, { name: body!.name, description: body!.description, summary: body!.summary, revision: state.campaign.revision + 1 }) }; return json(state.campaign) }
    if (p.endsWith('/archive') || p.endsWith('/restore')) { state.campaign.archived = p.endsWith('/archive'); return json(state.campaign) }
    if (p.endsWith('/accounts')) return json([{ id: second, name: 'Sam', avatar: '' }])
    if (p.endsWith('/players')) { if (method === 'POST') { if (state.lastGm) return json({ error: 'last_game_master' }, 409); const player = state.players.find(p => p.accountId === body!.accountId); if (player) player.role = body!.role as 'gm' | 'player' }; return json(state.players) }
    if (p.endsWith('/remove')) { if (state.lastGm) return json({ error: 'last_game_master' }, 409); state.players = state.players.filter(p => !u.pathname.includes(p.id)); return json({ ok: true }) }
    if (p.endsWith('/music/status')) return json({ available: true, connected: true, displayName: 'Alex', error: null })
    if (p.endsWith('/music/playlists')) return json({ items: state.playlists, offset: 0, limit: 50, total: 78, hasMore: false })
    if (p.endsWith('/music/queue')) return json(state.tracks.slice(1))
    if (p.includes('/music/playlists/') && p.endsWith('/tracks')) return json({ items: state.tracks, offset: 0, limit: 100, total: state.tracks.length, hasMore: false })
    if (p.endsWith('/music/find')) return json({ query: 'submerged throne ambient tension', tracks: state.tracks })
    if (p.endsWith('/music/brief')) return json({ title: 'The Drowned Crown', prompt: 'A restrained orchestral descent into a flooded throne room, building toward the movement of an ancient creature below.', style: 'dark cinematic ambient, submerged stone resonance', negativeTags: 'vocals, pop drums, triumphant resolution', mood: 'dread and wonder', energy: 'medium', tempo: 'slow pulse', instruments: ['low strings', 'waterphone', 'bass clarinet'], narrativeArc: 'Still water, discovery, a vast movement underneath, unresolved suspension.', durationSeconds: 150, instrumental: true })
    if (p.endsWith('/music/generations')) return json(state.musicGeneration)
    if (p.includes('/music/generations/')) return json(state.musicGeneration)
    if (p.endsWith('/promote')) { state.musicGeneration.candidates[0].promotedTrack = '77777777-7777-4777-8777-777777777777'; return json({ id: state.musicGeneration.candidates[0].promotedTrack, name: state.musicGeneration.candidates[0].title, sourceKind: 'generated' }) }
    if (p.endsWith('/music/playback')) { if (method === 'POST') { if (body!.action === 'pause') state.playback.playing = false; if (body!.action === 'play') state.playback.playing = true }; return json(state.playback) }
    if (p.endsWith('/generate')) { if (state.generationFail) { state.generationFail = false; return json({ error: 'storyboard_unavailable' }, 503) }; state.operation.kind = body!.kind as 'image' | 'summary'; return json(state.operation) }
    if (p === `/api/campaigns/${cid}/operations/${oid}`) { if (state.pollFail) return json({ error: 'storyboard_unavailable' }, 503); return json(state.operation) }
    return json({ error: 'not_found' }, 404)
  })
  return state
}
