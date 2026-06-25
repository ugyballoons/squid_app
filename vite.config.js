import { defineConfig } from 'vite';

// Frontend build config for Squid Set Lists.
//
// Sources live in python/static/src/ as native ES modules. We bundle them into
// a single file at python/static/build/app.js, which FastAPI serves as a plain
// static asset. The bundle is committed to git so the cPanel/Passenger host
// needs no Node/npm build step — deploying changes is still just `git pull`.
//
// index.html is hand-served by FastAPI (not processed by Vite), so we emit a
// stable, unhashed filename and keep the manual `?v=` cache-bust query in the
// HTML, matching how the app worked before modularization.

const STATIC = new URL('./python/static/', import.meta.url).pathname;

export default defineConfig({
  // Dev server roots at the static dir so /static/src/* and index.html resolve
  // the same way the browser sees them in production.
  root: STATIC,
  build: {
    outDir: 'build',
    emptyOutDir: true,
    // No hashing: predictable output path referenced from the static index.html.
    rollupOptions: {
      input: STATIC + 'src/main.js',
      output: {
        entryFileNames: 'app.js',
        // Single chunk — this app is small and a lone file keeps first paint
        // fast on a phone (no module-request waterfall).
        manualChunks: undefined,
        inlineDynamicImports: true,
      },
    },
    // Keep it readable-ish but minified for production payload size.
    minify: 'esbuild',
    target: 'es2019',
  },
});
