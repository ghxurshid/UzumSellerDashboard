import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Vendor chunks are split by concern so a topbar tweak never invalidates the chart or query cache bundle. */
const MANUAL_CHUNKS: Record<string, readonly string[]> = {
  /* Ahead of vendor-react on purpose: the check is a substring one, and
     `node_modules/react-markdown` contains `node_modules/react`. */
  'vendor-markdown': [
    'react-markdown',
    'remark-',
    'micromark',
    'mdast-',
    'hast-',
    'unist-',
    'unified',
    'vfile',
    'markdown-table',
    'property-information',
    'character-entities',
    'decode-named-character-reference',
  ],
  'vendor-react': ['react', 'react-dom', 'react-router-dom'],
  'vendor-query': ['@tanstack/react-query', 'axios'],
  'vendor-motion': ['framer-motion'],
  'vendor-forms': ['react-hook-form', 'zod', '@hookform/resolvers'],
};

const { version } = createRequire(import.meta.url)('./package.json') as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  /* The label in the title bar is the build's real version, not a string a
     release can forget to update. */
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    /**
     * The seller API sends no CORS headers, so a browser cannot call
     * `api-seller.uzum.uz` from `localhost` directly. In development the app
     * talks to this path and Vite forwards it; in the packaged extension the
     * same requests go straight out with host permissions, which is why the
     * base URL is a setting rather than a constant.
     */
    proxy: {
      '/api/seller-openapi': {
        target: 'https://api-seller.uzum.uz',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          for (const [chunk, packages] of Object.entries(MANUAL_CHUNKS)) {
            if (packages.some((pkg) => id.includes(`node_modules/${pkg}`))) return chunk;
          }
          return undefined;
        },
      },
    },
  },
});
