import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 5000,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5002',
        changeOrigin: true,
        // Keep SSE subscription fetch streaming (no proxy buffering)
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req) => {
            if (req.url?.includes('fetch-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache'
              proxyRes.headers['connection'] = 'keep-alive'
              proxyRes.headers['x-accel-buffering'] = 'no'
            }
          })
        },
      }
    }
  },
})
