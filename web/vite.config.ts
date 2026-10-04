import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { federation } from '@module-federation/vite'
import path from 'node:path'

export default defineConfig({
  base: './',
  cacheDir: process.env.REDLEAF_SCRATCH_DIR ? path.join(process.env.REDLEAF_SCRATCH_DIR, 'storyboard-frontend/node_modules/.vite-plugin') : 'node_modules/.vite-plugin',
  plugins: [react(), tailwindcss(), federation({ name: 'storyboard', filename: 'remoteEntry.js', exposes: { '.': './src/index.ts' }, shared: { react: { singleton: true }, 'react/jsx-runtime': { singleton: true }, 'react-dom': { singleton: true }, 'react-dom/client': { singleton: true }, '@redbamboo/ui': { singleton: true, import: false } }, dts: false })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { outDir: process.env.STORYBOARD_PLUGIN_OUTPUT || 'dist', emptyOutDir: false, lib: { entry: path.resolve('src/index.ts'), formats: ['es'], fileName: () => 'plugin.js', cssFileName: 'plugin' }, rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: (asset: { names: string[] }) => asset.names.some((name: string) => name.endsWith('.css')) ? 'plugin.css' : '[name]-[hash][extname]' } } },
})
