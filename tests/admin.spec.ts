import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { cid, aid, oid } from './fixture'
const evidence = path.join(process.env.REDLEAF_SCRATCH_DIR!, 'storyboard-frontend')
async function harness(page: Page) {
  const state = { unconfigured: false, denied: false, requireAgent: false, canCreate: false, requests: [] as { path: string; method: string; body: unknown }[] }
  await page.route('**/api/**', async r => {
    const req = r.request(); const p = new URL(req.url()).pathname; const method = req.method(); const body = req.postDataJSON(); state.requests.push({ path: p, method, body })
    const json = (data: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (p.endsWith('/provision/agents')) return json([{ id: aid, name: 'Disposable Agent' }])
    if (p.endsWith('/provision')) { if (state.requireAgent && !body.ownerAgentId) return json({ error: 'owning_agent_required' }, 400); state.unconfigured = false; return json({ ok: true }) }
    if (p.endsWith('/manage/status')) return state.unconfigured ? json({ error: 'extension_owner_required' }, 403) : json({ publicUrl: 'https://storyboard.minititine.cc', googleConfigured: true, workspace: cid, version: '0.1.0' })
    if (p.endsWith('/eligibility')) { state.canCreate = body.canCreate; return json({ id: aid, canCreate: state.canCreate }) }
    if (p.endsWith('/manage/accounts')) return json([{ id: aid, name: 'Disposable account', email: 'fixture@example.com', enabled: true, canCreate: state.canCreate }])
    if (p.endsWith('/manage/campaigns')) return json([{ id: cid, name: 'Disposable campaign', state: 'ready', archived: false, workspace: cid }])
    if (p.endsWith('/manage/operations')) return json([{ id: oid, kind: 'image', state: 'completed', error: '', applied: false }])
    if (p.endsWith('/manage/audit')) return json([{ id: 1, createdAt: '2026-10-03T12:00:00Z', data: { action: 'campaign.update', actor: aid, target: cid } }])
    if (p === '/api/entities') {
      const type = new URL(req.url()).searchParams.get('type')
      if (type === 'quality-tier') return json({ items: [{ id: 'tier-fast', typeSlug: 'quality-tier', name: 'Fast', slug: 'fast', data: { icon: 'ph-bold ph-rabbit', color: '#22d3ee', sort_order: 0 } }, { id: 'tier-standard', typeSlug: 'quality-tier', name: 'Standard', slug: 'standard', data: { icon: 'ph-bold ph-lightning', color: '#a78bfa', sort_order: 1 } }, { id: 'tier-deep', typeSlug: 'quality-tier', name: 'Deep', slug: 'deep', data: { icon: 'ph-bold ph-brain', color: '#fb923c', sort_order: 2 } }], total: 3 })
      if (type === 'comfyui-workflow') return json({ items: [{ id: 'workflow-z', typeSlug: 'comfyui-workflow', name: 'Z-Image Turbo', slug: 'z_turbo', data: { description: 'Fast campaign image generation.' } }, { id: 'workflow-sdxl', typeSlug: 'comfyui-workflow', name: 'SDXL', slug: 'sdxl', data: { description: 'Detailed campaign image generation.' } }], total: 2 })
    }
    if (p === '/api/extensions/storyboard/settings') {
      if (state.denied) return json({ id: 'storyboard', sections: [], error: 'extension_owner_required' })
      if (method === 'PUT') return json({ ok: true, validateOnly: body.validateOnly })
      return json({ id: 'storyboard', sections: [{ id: 'access', name: 'Public access', fields: [{ key: 'public_url', path: 'public_url', label: 'Public website', type: 'string', value: 'https://storyboard.minititine.cc', configured: true, protection: null }, { key: 'google_client_secret', path: 'google_client_secret', label: 'Google client secret', type: 'secret', value: null, configured: true, protection: 'encrypted' }, { key: 'proxy_secret', path: 'proxy_secret', label: 'Site connection key', type: 'secret', value: null, configured: true, protection: 'encrypted' }] }, { id: 'generation', name: 'Generation', fields: [{ key: 'fast_quality_mode', path: 'fast_quality_mode', label: 'Fast inference', type: 'entity_ref', value: 'fast', configured: true, protection: null, constraints: { target_type: 'quality-tier' } }, { key: 'quality_mode', path: 'quality_mode', label: 'Proper inference', type: 'entity_ref', value: 'deep', configured: true, protection: null, constraints: { target_type: 'quality-tier' } }, { key: 'workflow', path: 'workflow', label: 'Image workflow', type: 'entity_ref', value: 'z_turbo', configured: true, protection: null, constraints: { target_type: 'comfyui-workflow' } }, { key: 'visual_brief', path: 'visual_brief', label: 'Default visual brief', type: 'string', value: 'Clear composition, no lettering.', configured: true, protection: null }] }] })
    }
    return json({ error: 'fixture_route_missing' }, 404)
  })
  return state
}
test('admin fixture: preparation, projections, eligibility and actual inspector links', async ({ page }) => {
  const s = await harness(page); s.unconfigured = true; await page.goto('/admin.fixture.html?surface=manage'); await expect(page.getByRole('alert')).toContainText('installation owner'); await page.getByRole('button', { name: 'Prepare Storyboard' }).click(); await expect(page.getByRole('heading', { name: 'Your service is configured' })).toBeVisible(); await page.getByRole('tab', { name: /^Accounts/ }).click(); await page.getByRole('switch', { name: 'Allow Disposable account to create campaigns' }).click(); await expect(page.getByRole('switch')).toBeChecked(); expect(s.requests.find(r => r.path.endsWith('/eligibility'))?.body).toEqual({ canCreate: true }); await page.getByRole('tab', { name: /^Campaigns/ }).click(); await expect(page.getByRole('link', { name: 'Disposable campaign' })).toHaveAttribute('href', `/database/entities/storyboard-campaign/${cid}`); await page.getByRole('tab', { name: 'Activity', exact: true }).click(); await expect(page.getByText('Newer changes retained')).toBeVisible(); await expect(page.getByText('Not supplied')).toBeVisible()
})
test('settings fixture: standard endpoint, validate-only, masked explicit secret replacement and denied state', async ({ page }) => {
  const s = await harness(page); await page.goto('/admin.fixture.html?surface=settings'); const settings = page.locator('[data-ui-surface="storyboard-settings"]'); await expect(settings).not.toHaveClass(/storyboard-admin/); await expect(settings.locator('[data-slot="section-header"]')).toHaveText(['Public access', 'Generation']); await expect(page.getByRole('button', { name: 'Reload settings' })).toContainText('Reload'); await expect(page.getByLabel('Public website', { exact: true })).toHaveValue('https://storyboard.minititine.cc'); await page.getByLabel('Public website', { exact: true }).fill('https://proposed.example.com'); await page.getByRole('button', { name: 'Validate', exact: true }).first().click(); await expect(page.getByRole('status').filter({ hasText: /^Settings/ })).toContainText('Nothing has been saved'); expect(s.requests.filter(r => r.method === 'PUT').at(-1)?.body).toEqual({ section: 'access', values: { public_url: 'https://proposed.example.com' }, validateOnly: true }); await page.getByRole('button', { name: 'Save public access' }).click(); await expect(page.getByRole('status').filter({ hasText: /^Settings/ })).toContainText('Settings saved.')
  const secret = page.locator('[data-setting-path="google_client_secret"]'); await expect(secret.getByText('Stored securely', { exact: true })).toBeVisible(); await secret.getByRole('button', { name: /Replace/ }).click(); await secret.locator('input').fill('disposable-replacement-secret'); await secret.getByRole('button', { name: /Save/ }).click(); await expect(page.getByRole('status').filter({ hasText: /^Settings/ })).toContainText('Settings saved.'); expect(s.requests.filter(r => r.method === 'PUT').at(-1)?.body).toEqual({ section: 'access', values: { google_client_secret: 'disposable-replacement-secret' }, validateOnly: false }); await expect(page.locator('body')).not.toContainText('disposable-replacement-secret'); s.denied = true; await page.getByRole('button', { name: 'Reload settings' }).click(); await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByLabel('Public website', { exact: true })).toHaveCount(0)
})
for (const theme of ['light', 'dark']) test(`shared Leaf components fixture screenshot · ${theme}`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await harness(page); await page.goto(`/admin.fixture.html?surface=manage&theme=${theme}`); await expect(page.getByRole('heading', { name: 'Your service is configured' })).toBeVisible(); await page.screenshot({ path: path.join(evidence, `fixture-management-${theme}.png`), fullPage: true }); await page.goto(`/admin.fixture.html?surface=settings&theme=${theme}`); await expect(page.getByLabel('Public website', { exact: true })).toBeVisible(); await page.screenshot({ path: path.join(evidence, `fixture-settings-${theme}.png`), fullPage: true }); expect(errors).toEqual([])
})
test('settings fixture: entity references use cards and save canonical slugs', async ({ page }) => {
  const s = await harness(page); await page.goto('/admin.fixture.html?surface=settings'); await expect(page.locator('[data-setting-path="fast_quality_mode"] [data-slot="entity-card"]')).toHaveAttribute('data-entity-name', 'Fast'); await expect(page.locator('[data-setting-path="quality_mode"] [data-slot="entity-card"]')).toHaveAttribute('data-entity-name', 'Deep'); await expect(page.locator('[data-setting-path="workflow"] [data-slot="entity-card"]')).toHaveAttribute('data-entity-name', 'Z-Image Turbo'); await page.getByRole('button', { name: 'Change Proper inference' }).click(); await expect(page.getByRole('dialog')).toContainText('Select Proper inference'); await page.getByRole('button', { name: 'Select Standard' }).click(); await expect(page.locator('[data-setting-path="quality_mode"] [data-slot="entity-card"]')).toHaveAttribute('data-entity-name', 'Standard'); await page.getByRole('button', { name: 'Save generation' }).click(); expect(s.requests.filter(r => r.method === 'PUT').at(-1)?.body).toEqual({ section: 'generation', values: { quality_mode: 'standard' }, validateOnly: false })
})

test('management dashboard stays usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await harness(page)
  await page.goto('/admin.fixture.html?surface=manage')
  await expect(page.getByRole('heading', { name: 'Your service is configured' })).toBeVisible()
  await page.screenshot({ path: path.join(evidence, 'fixture-management-phone-overview.png'), fullPage: true })
  for (const name of [/^Overview/, /^Accounts/, /^Campaigns/, /^Activity/]) {
    const tab = page.getByRole('tab', { name })
    await expect(tab).toBeVisible()
    await tab.click()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    const tableOverflow = await page.locator('[data-slot="table-container"]').evaluateAll(tables => tables.map(table => table.scrollWidth - table.clientWidth))
    expect(Math.max(0, ...tableOverflow)).toBeLessThanOrEqual(1)
  }
  await expect(page.getByRole('heading', { name: 'Recent audit activity' })).toBeVisible()
  const dashboard = page.locator('[data-ui-surface="storyboard-management"]')
  await dashboard.evaluate(element => { (element.querySelector('.storyboard-admin-inner') as HTMLElement).style.minHeight = '1600px' })
  const before = await dashboard.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, content: element.scrollHeight }))
  expect(before.content).toBeGreaterThan(before.height)
  await dashboard.hover()
  await page.mouse.wheel(0, 600)
  await expect.poll(() => dashboard.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.screenshot({ path: path.join(evidence, 'fixture-management-phone-activity.png'), fullPage: true })
})

test('settings panel follows the Leaf extension template at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await harness(page)
  await page.goto('/admin.fixture.html?surface=settings')
  const settings = page.locator('[data-ui-surface="storyboard-settings"]')
  await expect(settings).toBeVisible()
  await expect(settings).not.toHaveClass(/storyboard-admin/)
  await expect(settings.locator('[data-slot="setting-row"]')).toHaveCount(7)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.screenshot({ path: path.join(evidence, 'fixture-settings-phone.png'), fullPage: true })
  await page.getByRole('button', { name: 'Change Fast inference' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const pickerOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(pickerOverflow).toBeLessThanOrEqual(1)
  await page.screenshot({ path: path.join(evidence, 'fixture-settings-phone-picker.png'), fullPage: true })
})

test('admin fixture: ambiguous owning Agent is selected explicitly before retrying preparation', async ({ page }) => {
 const s = await harness(page); s.unconfigured = true; s.requireAgent = true; await page.goto('/admin.fixture.html?surface=manage'); await page.getByRole('button', { name: 'Prepare Storyboard' }).click(); await expect(page.getByRole('alert')).toContainText('Select the Agent'); await page.getByLabel('Owning Agent', { exact: true }).selectOption(aid); await page.getByRole('button', { name: 'Prepare Storyboard' }).click(); await expect(page.getByRole('heading', { name: 'Your service is configured' })).toBeVisible(); expect(s.requests.filter(r => r.path.endsWith('/provision')).at(-1)?.body).toEqual({ ownerAgentId: aid })
})
