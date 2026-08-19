import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'

// Allow the local dev server to load an alternative Wrangler config via
// WRANGLER_DEV_CONFIG (e.g. wrangler.dev.json, which omits the remote-only `ai`
// binding so `getPlatformProxy` doesn't require Cloudflare credentials to boot).
// When the variable is unset, behaviour is unchanged (Wrangler auto-discovers
// wrangler.json).
const wranglerDevConfig = process.env.WRANGLER_DEV_CONFIG

export default defineConfig({
  plugins: [
    build(),
    devServer({
      adapter: wranglerDevConfig
        ? () => adapter({ proxy: { configPath: wranglerDevConfig } })
        : adapter,
      entry: 'src/index.tsx'
    })
  ]
})
