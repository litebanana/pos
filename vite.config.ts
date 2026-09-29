import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { commonSecurityHeaders, nginxSecurityHeaders, offlineContentSecurityPolicy, securityHeaders, staticHostHeaders } from './security/headers'

function productionSecurity(): Plugin {
  return {
    name: 'tindahan-production-security',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: offlineContentSecurityPolicy }, injectTo: 'head-prepend' }]
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: staticHostHeaders() })
      this.emitFile({ type: 'asset', fileName: 'security-headers.nginx.conf', source: nginxSecurityHeaders() })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    productionSecurity(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        id: '/',
        name: 'Tindahan — Point of sale',
        short_name: 'Tindahan',
        description: 'Offline checkout, receipts, and stock tracking.',
        theme_color: '#185c45',
        background_color: '#f5f6f5',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'en-PH',
        categories: ['business', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
  // Development keeps Vite's refresh bootstrap working; strict CSP is tested in preview.
  server: { host: '127.0.0.1', headers: commonSecurityHeaders },
  preview: { host: '127.0.0.1', strictPort: true, headers: securityHeaders },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'local-storage': ['dexie', 'dexie-react-hooks'],
          'pdf-vendor': ['jspdf'],
        },
      },
    },
  },
})
