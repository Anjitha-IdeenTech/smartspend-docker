import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../site',
    emptyOutDir: true,
    // Disable CSS minification only (JS is still minified). esbuild's CSS
    // minifier drops the unprefixed `backdrop-filter` whenever `-webkit-`
    // covers an old-Safari target, which would break frosted glass in Firefox
    // (no `-webkit-` support). The CSS is tiny and gzips almost identically,
    // so keeping it unminified costs nothing and preserves both prefixes.
    cssMinify: false,
  }
})
