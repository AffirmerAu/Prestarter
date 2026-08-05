import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/internal': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      // The review player (VideoDetail) embeds the Worker's real /w/ player in an iframe —
      // that route only exists on the Worker, not this dev server.
      '/w': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
})
