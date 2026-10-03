import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
const fixtures = !!process.env.STORYBOARD_UI_FIXTURE
export default defineConfig({
  base: '/',
  plugins: [react(), ...(fixtures ? [tailwindcss()] : [])],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: fixtures ? { hmr: false } : undefined,
  optimizeDeps: fixtures ? { entries: ['index.html', 'admin.fixture.html'], include: ['@redbamboo/ui'] } : undefined,
  cacheDir: process.env.REDLEAF_SCRATCH_DIR ? path.join(process.env.REDLEAF_SCRATCH_DIR, 'storyboard-frontend/node_modules', fixtures ? '.vite-fixtures' : '.vite-site') : 'node_modules/.vite-site',
  build: { outDir: process.env.STORYBOARD_SITE_OUTPUT || 'site-dist', emptyOutDir: false },
})
