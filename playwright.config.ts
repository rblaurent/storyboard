import { defineConfig } from '@playwright/test'
import path from 'node:path'
if (!process.env.REDLEAF_SCRATCH_DIR) throw new Error('REDLEAF_SCRATCH_DIR is required for browser evidence')
const evidence = path.join(process.env.REDLEAF_SCRATCH_DIR, 'storyboard-frontend')
const port = Number(process.env.STORYBOARD_PLAYWRIGHT_PORT || 4197)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('STORYBOARD_PLAYWRIGHT_PORT must be a valid unprivileged port')
const baseURL = `http://127.0.0.1:${port}`
export default defineConfig({ testDir: './tests', outputDir: path.join(evidence, 'playwright'), fullyParallel: false, workers: 1, reporter: [['list'], ['json', { outputFile: path.join(evidence, 'playwright-results.json') }]], use: { baseURL, channel: process.env.STORYBOARD_BROWSER_CHANNEL || 'chrome', headless: true, viewport: { width: 1440, height: 1040 }, trace: 'retain-on-failure' }, webServer: { command: `pnpm --filter storyboard-web build:site && pnpm --filter storyboard-web exec vite --config vite.site.config.ts --host 127.0.0.1 --port ${port}`, env: { STORYBOARD_UI_FIXTURE: '1', STORYBOARD_SITE_OUTPUT: path.join(evidence, 'csp-site') }, url: baseURL, reuseExistingServer: false }, timeout: 30000 })
