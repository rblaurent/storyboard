import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fixture, cid, mid, oid, second, csrf } from './fixture'
const evidence = path.join(process.env.REDLEAF_SCRATCH_DIR!, 'storyboard-frontend')

test('401 shows real sign-in link; session uses no browser credentials', async ({ page }) => {
  await fixture(page, { signedOut: true }); await page.goto('/')
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/auth/google')
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual({ local: {}, session: {} })
})
test('service errors are explicit and user-provided image hosts are refused', async ({ page }) => {
  const s = await fixture(page); s.meFail = true; await page.goto('/'); await expect(page.getByRole('alert')).toContainText('being prepared'); await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible()
  s.meFail = false; s.campaign.image = 'https://untrusted.example/track.svg'; s.campaign.players[0].avatar = 'https://untrusted.example/track.svg'; await page.reload(); await expect(page.getByRole('heading', { name: 'The Glass Observatory' })).toBeVisible(); await expect(page.locator('img[src^="https://untrusted.example"]')).toHaveCount(0)
})
test('picker preference, creation permission, retry UUID and campaign tabs', async ({ page }) => {
  const s = await fixture(page); await page.goto('/'); await expect(page.getByRole('heading', { name: 'Your campaigns.' })).toBeVisible()
  await page.getByLabel('Show archived').check(); await expect.poll(() => s.requests.some(r => r.path === '/api/campaigns?archived=true')).toBe(true)
  await page.reload(); await expect(page.getByLabel('Show archived')).toBeChecked()
  await page.getByRole('button', { name: 'Create campaign' }).click(); await page.getByLabel('Campaign name').fill('A new chapter'); s.createFail = true
  await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible(); await page.getByRole('button', { name: 'Retry creation' }).click()
  await expect(page).toHaveURL(new RegExp(`/campaigns/${cid}/description`)); await expect(page.getByRole('navigation', { name: 'Campaign tabs' }).getByRole('link')).toHaveCount(3)
  const commands = s.requests.filter(r => r.method === 'POST' && r.path === '/api/campaigns'); expect(commands).toHaveLength(2); expect(commands[0].body).toEqual(commands[1].body); expect(commands[0].body?.operationId).toMatch(/^[a-f0-9-]{36}$/); expect(commands[0].csrf).toBe(csrf)
  const stored = await page.evaluate(() => ({ ...localStorage })); expect(stored).toEqual({ 'storyboard:show-archived': 'true' })
})
test('player is read-only and ineligible account cannot create', async ({ page }) => {
  await fixture(page, { player: true, canCreate: false }); await page.goto('/'); await expect(page.getByRole('button', { name: 'Create campaign' })).toBeDisabled()
  await page.goto(`/campaigns/${cid}/description`); await expect(page.getByRole('heading', { name: 'The Glass Observatory' }).first()).toBeVisible(); await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Generate artwork' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Players', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Elian Vale' })).toHaveCount(0); await expect(page.getByText('Elian Vale')).toBeVisible(); await expect(page.getByRole('button', { name: /Remove/ })).toHaveCount(0); await expect(page.getByLabel('Add an existing account')).toHaveCount(0)
})
test('edit preserves conflict draft and explicitly rebases only after reviewing latest', async ({ page }) => {
  const s = await fixture(page); await page.goto(`/campaigns/${cid}/description`); await page.getByLabel('Description', { exact: true }).fill('My unsaved scene'); s.conflict = true; s.campaign.revision = 5; s.campaign.description = 'A newer saved scene'
  await page.getByRole('button', { name: 'Save changes' }).click(); await expect(page.getByRole('alert')).toContainText('Your draft is kept'); await expect(page.getByLabel('Description', { exact: true })).toHaveValue('My unsaved scene')
  await page.getByText('Review latest saved version', { exact: true }).click(); await page.getByRole('button', { name: 'Refresh saved version' }).click(); await expect(page.getByText('A newer saved scene', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Keep draft against latest revision' }).click(); s.conflict = false
  await page.getByRole('button', { name: 'Save changes' }).click(); await expect(page.getByRole('status')).toContainText('Campaign saved.'); expect(s.campaign.description).toBe('My unsaved scene'); const writes = s.requests.filter(r => r.method === 'PUT'); expect(writes.at(-1)?.body?.expectedRevision).toBe(5)
})
test('archive changes visibility, direct link stays usable and restore works', async ({ page }) => {
  const s = await fixture(page); await page.goto(`/campaigns/${cid}/description`); await page.getByLabel('Campaign menu for The Glass Observatory').click(); const archive = page.getByRole('menuitem', { name: 'Archive campaign', exact: true }); const back = page.getByRole('menuitem', { name: 'Back to campaigns' }); await expect(archive).toBeVisible(); await expect(archive).toHaveClass(/menu-row/); await expect(back).toHaveClass(/menu-row/); await page.getByRole('heading', { name: 'The Glass Observatory' }).click(); await expect(archive).toHaveCount(0); await page.getByLabel('Campaign menu for The Glass Observatory').click(); await page.getByRole('menuitem', { name: 'Archive campaign', exact: true }).click(); await expect(page.getByRole('status')).toContainText('Campaign archived')
  await page.getByLabel('Campaign menu for The Glass Observatory').click(); await page.getByRole('menuitem', { name: 'Back to campaigns' }).click(); await expect(page.getByText('Your next story is waiting')).toBeVisible(); await page.getByLabel('Show archived').check(); await expect(page.getByRole('heading', { name: 'The Glass Observatory' })).toBeVisible()
  await page.goto(`/campaigns/${cid}/description`); await page.getByLabel('Campaign menu for The Glass Observatory').click(); await page.getByRole('menuitem', { name: 'Restore campaign' }).click(); await expect(page.getByRole('status')).toContainText('Campaign restored.'); expect(s.campaign.archived).toBe(false)
})
test('roster exact lookup, role change, last-GM error and membership-only removal', async ({ page }) => {
  const s = await fixture(page); await page.goto(`/campaigns/${cid}/players`); await page.getByLabel('Add an existing account').fill('sam@example.com'); await page.getByRole('button', { name: 'Find account' }).click(); await page.getByRole('button', { name: 'Add to campaign' }).click(); expect(s.requests.some(r => r.path.endsWith('/accounts?email=sam%40example.com'))).toBe(true)
  s.lastGm = true; await page.getByLabel('Role for Alex').click(); await page.getByRole('option', { name: 'Player' }).click(); await expect(page.getByRole('alert')).toContainText('at least one Game Master'); await expect(page.getByLabel('Role for Alex')).toContainText('Game Master')
  s.lastGm = false; await page.getByLabel('Role for Sam').click(); await page.getByRole('option', { name: 'Game Master' }).click(); await expect(page.getByLabel('Role for Sam')).toContainText('Game Master'); await page.getByRole('button', { name: 'Remove Sam', exact: true }).click(); await expect(page.getByText('Their account and characters are retained.', { exact: false })).toBeVisible(); await page.getByRole('button', { name: 'Remove membership', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Sam', exact: true })).toHaveCount(0)
  expect(s.requests.find(r => r.path === `/api/campaigns/${cid}/players/${second}/remove`)?.body).toEqual({})
})
test('exact operation survives refresh; saves and duplicates disabled; completion keeps draft', async ({ page }) => {
  const s = await fixture(page); await page.goto(`/campaigns/${cid}/description`); await page.getByLabel('A quick image idea').fill('An observatory in the clouds'); await page.getByRole('button', { name: 'Generate artwork' }).click(); await expect(page.getByText('Creating the artwork…')).toBeVisible(); await expect(page.getByRole('button', { name: 'Generate artwork' })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  await page.reload(); await expect(page.getByText('Creating the artwork…')).toBeVisible(); const imageReads = s.requests.filter(r => r.path.endsWith('/media/cover')).length; await page.getByLabel('Description', { exact: true }).fill('Keep this unsaved draft'); s.operation.state = 'completed'; s.operation.applied = true; s.campaign.revision++
  await expect(page.getByText(/Your unsaved draft is kept/)).toBeVisible(); await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Keep this unsaved draft'); expect(s.requests.filter(r => r.path.includes('/operations/')).every(r => r.path === `/api/campaigns/${cid}/operations/${oid}`)).toBe(true)
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('storyboard:operation:')).length)).toBe(0)
  await expect.poll(() => s.requests.filter(r => r.path.endsWith('/media/cover')).length).toBeGreaterThan(imageReads)
})
test('uncertain generation retries same command, status errors resume exact ID, failure keeps old art', async ({ page }) => {
  const s = await fixture(page); await page.goto(`/campaigns/${cid}/description`); await expect(page.getByRole('img', { name: 'The Glass Observatory artwork' })).toBeVisible(); const oldArt = await page.getByRole('img', { name: 'The Glass Observatory artwork' }).getAttribute('src'); await page.getByLabel('A quick image idea').fill('Clouds'); s.generationFail = true; await page.getByRole('button', { name: 'Generate artwork' }).click(); await expect(page.getByRole('button', { name: 'Retry same request' })).toBeVisible(); s.pollFail = true; await page.getByRole('button', { name: 'Retry same request' }).click(); await expect(page.getByRole('button', { name: 'Resume status' })).toBeVisible()
  const commands = s.requests.filter(r => r.path.endsWith('/generate')); expect(commands[0].body).toEqual(commands[1].body)
  s.pollFail = false; s.operation.state = 'failed'; s.operation.error = 'Artwork unavailable. Try again.'; await page.getByRole('button', { name: 'Resume status' }).click(); await expect(page.getByText('Artwork unavailable. Try again.')).toBeVisible(); await expect(page.getByRole('img', { name: 'The Glass Observatory artwork' })).toHaveAttribute('src', oldArt!); await expect(page.getByRole('button', { name: 'Generate artwork' })).toBeEnabled()
})
test('summary uses saved source and completed unapplied explains retained changes', async ({ page }) => {
  const s = await fixture(page); s.operation.state = 'completed'; s.operation.applied = false; await page.goto(`/campaigns/${cid}/description`); await page.getByRole('button', { name: 'Generate summary' }).click(); await expect(page.getByText('The result is ready, but newer campaign changes were retained. It was not applied.')).toBeVisible(); expect(s.requests.find(r => r.path.endsWith('/generate'))?.body).toMatchObject({ kind: 'summary', prompt: '', expectedRevision: 3 })
})
test('navigation stops polling, resumes same receipt; sign-out cancels timers', async ({ page }) => {
  const s = await fixture(page); await page.goto(`/campaigns/${cid}/description`); await page.getByLabel('A quick image idea').fill('Clouds'); await page.getByRole('button', { name: 'Generate artwork' }).click(); await expect(page.getByText('Creating the artwork…')).toBeVisible(); await page.getByLabel('Campaign menu for The Glass Observatory').click(); await page.getByRole('menuitem', { name: 'Back to campaigns' }).click(); const before = s.requests.filter(r => r.path.includes('/operations/')).length
  // A bounded quiet period specifically checks timer cancellation.
  await page.waitForTimeout(1900); expect(s.requests.filter(r => r.path.includes('/operations/')).length).toBe(before)
  await page.goto(`/campaigns/${cid}/description`); await expect(page.getByText('Creating the artwork…')).toBeVisible(); await page.getByLabel('Campaign menu for The Glass Observatory').click(); await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible(); const after = s.requests.filter(r => r.path.includes('/operations/')).length; await page.waitForTimeout(1900); expect(s.requests.filter(r => r.path.includes('/operations/')).length).toBe(after)
})
test('music browses real pages, finds a scene match, prepares an uncharged brief and keeps the player across tabs', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { loaded: '', plays: 0, pauses: 0 }
    ;(window as unknown as { __spotifyFixture: typeof state }).__spotifyFixture = state
    ;(window as unknown as { __storyboardSpotifyIframeApi: unknown }).__storyboardSpotifyIframeApi = { createController(element: HTMLElement, options: { uri: string }, ready: (controller: unknown) => void) { const iframe = document.createElement('iframe'); iframe.title = 'Spotify browser playback fixture'; element.appendChild(iframe); state.loaded = options.uri; const listeners = new Map<string, (event: unknown) => void>(); ready({ loadEntity(uri: string) { state.loaded = uri }, play() { state.plays++; listeners.get('playback_started')?.({ data: {} }); listeners.get('playback_update')?.({ data: { isPaused: false, position: 1200 } }) }, pause() { state.pauses++; listeners.get('playback_update')?.({ data: { isPaused: true, position: 1200 } }) }, addListener(name: string, listener: (event: unknown) => void) { listeners.set(name, listener) }, destroy() {} }) } }
  })
  const s = await fixture(page); await page.goto(`/campaigns/${cid}/music`)
  await expect(page.getByRole('heading', { name: 'Music', exact: true })).toBeVisible(); await expect(page.getByText('Spotify catalogue connected')).toBeVisible(); await expect(page.getByRole('button', { name: 'Shinsekai Atmospheres 2 tracks' })).toBeVisible()
  await page.getByRole('button', { name: 'Shinsekai Atmospheres 2 tracks' }).click(); await expect(page.locator('.music-tracks').getByText('The Orrery Turns')).toBeVisible()
  await page.getByLabel('What is happening right now?').fill('The party enters a drowned throne room while something moves below the water.')
  await page.getByRole('button', { name: 'Find music' }).click(); await expect(page.getByText(/submerged throne ambient tension/)).toBeVisible(); await page.getByRole('button', { name: 'Enqueue The Orrery Turns' }).click(); await expect(page.getByRole('status')).toContainText('added to the session queue')
  await page.getByRole('button', { name: 'Compose new' }).click(); await expect(page.getByRole('heading', { name: 'The Drowned Crown' })).toBeVisible(); await expect(page.getByText('No credits have been spent.')).toBeVisible(); await page.getByRole('button', { name: 'Generate candidates' }).click(); await expect(page.getByText('This submits paid music generation.')).toBeVisible(); await page.getByRole('button', { name: 'Confirm and generate' }).click(); await expect(page.getByText('The Drowned Crown A')).toBeVisible(); await expect(page.getByText('Credits recorded: 12')).toBeVisible(); await page.reload(); await expect(page.getByText('The Drowned Crown A')).toBeVisible(); await page.getByRole('button', { name: 'Save to pool' }).click(); await expect(page.getByRole('button', { name: 'Saved to pool' })).toBeDisabled()
  expect(s.requests.find(r => r.path.endsWith('/music/find'))?.csrf).toBe(csrf); expect(s.requests.find(r => r.path.endsWith('/music/brief'))?.body).toEqual({ situation: 'The party enters a drowned throne room while something moves below the water.' }); expect(s.requests.find(r => r.path.endsWith('/music/generations'))?.body).toMatchObject({ confirmed: true, situation: 'The party enters a drowned throne room while something moves below the water.' })
  await page.getByRole('button', { name: 'Play Lanterns Beneath the Tide' }).click(); await expect(page.getByLabel('Browser campaign player')).toContainText('Lanterns Beneath the Tide'); await expect(page.getByLabel('Browser campaign player')).toContainText('This browser'); await expect(page.getByTitle('Spotify browser playback fixture')).toBeVisible()
  await page.getByRole('link', { name: 'Description', exact: true }).click(); await expect(page.getByLabel('Browser campaign player')).toContainText('Lanterns Beneath the Tide'); expect(await page.evaluate(() => (window as unknown as { __spotifyFixture: { loaded: string; plays: number } }).__spotifyFixture)).toMatchObject({ loaded: 'spotify:track:1234567890123456789012', plays: 1 }); expect(s.requests.some(r => r.path.endsWith('/music/playback'))).toBe(false)
})
test('campaign playlists and tracks drag into the durable queue; broken covers fall back cleanly', async ({ page }) => {
  const s = await fixture(page); s.tracks[0].imageUrl = 'https://i.scdn.co/image/missing-cover'; await page.route('https://i.scdn.co/**', route => route.abort()); await page.goto(`/campaigns/${cid}/music`)
  await page.getByRole('button', { name: 'Track pool 2 mixed-source tracks' }).click(); await expect(page.locator('.music-art-empty').first()).toBeVisible()
  const target = page.locator('.live-queue'); await page.locator('.track-row').filter({ hasText: 'Lanterns Beneath the Tide' }).dragTo(target); await expect.poll(() => s.requests.some(request => request.method === 'POST' && request.path.endsWith('/music/queue') && request.body?.trackId === s.tracks[0].id)).toBe(true)
  await page.locator('.playlist-row').filter({ hasText: 'Shinsekai Atmospheres' }).dragTo(target); await expect.poll(() => s.requests.some(request => request.method === 'POST' && request.path.endsWith('/music/queue') && request.body?.playlistId === s.playlists[0].id)).toBe(true)
  await expect(page.locator('.live-queue')).toContainText('Lanterns Beneath the Tide')
})
for (const viewport of [{ name: 'desktop', width: 1440, height: 1040 }, { name: 'tablet', width: 834, height: 1112 }, { name: 'phone', width: 390, height: 844 }]) {
  test(`disposable fixture layout and keyboard evidence · ${viewport.name}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await page.setViewportSize(viewport); await fixture(page); await page.goto('/'); await expect(page.getByRole('heading', { name: 'The Glass Observatory' })).toBeVisible(); await expect(page.getByRole('img', { name: 'The Glass Observatory artwork' })).toBeVisible(); await page.screenshot({ path: path.join(evidence, `fixture-picker-${viewport.name}.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
    const accountTarget = await page.getByLabel('Account menu for Alex Morgan', { exact: true }).boundingBox()
    expect(accountTarget!.width).toBeGreaterThanOrEqual(44); expect(accountTarget!.height).toBeGreaterThanOrEqual(44)
    await page.getByLabel('Account menu for Alex Morgan', { exact: true }).click(); await expect(page.getByText('Storyboard account', { exact: true })).toBeVisible(); await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toHaveClass(/menu-row/); await page.mouse.click(10, Math.min(viewport.height - 20, 300)); await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toHaveCount(0)
    await page.goto(`/campaigns/${cid}/description`); await expect(page.getByLabel('Campaign name')).toBeVisible(); await expect(page.getByRole('img', { name: 'The Glass Observatory artwork' })).toBeVisible(); await expect(page.locator('.masthead')).toHaveCount(0)
    const campaignHeader = page.locator('[data-ui-region="campaign-header"]'); await expect(campaignHeader.getByRole('heading', { name: 'The Glass Observatory' })).toBeVisible(); await expect(campaignHeader.getByRole('navigation', { name: 'Campaign tabs' })).toBeVisible(); await expect(campaignHeader.getByLabel('Campaign menu for The Glass Observatory', { exact: true })).toBeVisible(); await expect(campaignHeader.locator('.menu-trigger')).toHaveCount(1)
    const headerBox = await campaignHeader.boundingBox(); expect(headerBox!.height).toBeLessThanOrEqual(viewport.name === 'phone' ? 180 : 190)
    if (viewport.name === 'phone') { const fieldBox = await page.getByLabel('Campaign name').boundingBox(); expect(fieldBox!.y).toBeLessThan(330) }
    await page.screenshot({ path: path.join(evidence, `fixture-description-${viewport.name}.png`), fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('link', { name: 'Players', exact: true }).click(); await expect(page.getByText('Elian Vale')).toBeVisible(); await page.screenshot({ path: path.join(evidence, `fixture-players-${viewport.name}.png`), fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([])
    await page.getByRole('link', { name: 'Music', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Music', exact: true })).toBeVisible(); await page.screenshot({ path: path.join(evidence, `fixture-music-${viewport.name}.png`), fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([])
  })
}

// Built application + actual Worker response CSP, disposable API data only.
test('authorized blob artwork loads under the production Worker CSP', async ({ page }) => {
  const { readFile } = await import('node:fs/promises')
  const { relay } = await import('../worker/src/index')
  const site = path.join(evidence, 'csp-site')
  await fixture(page)
  const violations: string[] = []
  await page.exposeFunction('recordCspViolation', (value: string) => violations.push(value))
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => (window as unknown as { recordCspViolation(v: string): void }).recordCspViolation(event.violatedDirective + ':' + event.blockedURI)))
  await page.route('**/*', async r => {
    const u = new URL(r.request().url())
    if (u.pathname !== '/' && !u.pathname.startsWith('/assets/')) return r.fallback()
    const file = u.pathname === '/' ? 'index.html' : 'assets/' + path.basename(u.pathname)
    const body = await readFile(path.join(site, file))
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'
    const response = await relay(new Request('https://storyboard.minititine.cc' + u.pathname), { STORYBOARD_PROXY_KEY: 'disposable-fixture-relay-key-for-csp-test' }, (async () => new Response(body, { headers: { 'Content-Type': type } })) as typeof fetch)
    await r.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
  })
  await page.goto('/')
  const artwork = page.locator('img[src^="blob:"]').first()
  await expect(artwork).toBeVisible()
  await expect.poll(() => artwork.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  expect(violations).toEqual([])
  await page.screenshot({ path: path.join(evidence, 'fixture-worker-csp-artwork.png'), fullPage: true })
})
