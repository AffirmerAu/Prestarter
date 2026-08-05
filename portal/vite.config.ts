import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3001,
    proxy: {
      // QR/poster export and the manifest-link redirect need the Worker directly — everything
      // else the portal reads is via Supabase + RLS (see src/lib/supabase.ts). /w is proxied
      // too so the generated watch/embed links work as relative URLs in local dev; in
      // production this depends on spec section 19's still-open "one host or two" question.
      '/portal': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/m': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/w': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
})
