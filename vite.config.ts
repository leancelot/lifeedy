import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_APP_URL': JSON.stringify(
        process.env.VITE_APP_URL || process.env.APP_URL || ''
      ),
      'import.meta.env.VITE_GITHUB_REPO': JSON.stringify(
        process.env.VITE_GITHUB_REPO || process.env.GITHUB_REPOSITORY || ''
      ),
      'import.meta.env.VITE_APP_COMMIT_SHA': JSON.stringify(
        process.env.VITE_APP_COMMIT_SHA || process.env.GITHUB_SHA || ''
      ),
      'import.meta.env.VITE_APP_BUILD_NUMBER': JSON.stringify(
        process.env.VITE_APP_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || ''
      ),
      'import.meta.env.VITE_APP_BUILT_AT': JSON.stringify(
        process.env.VITE_APP_BUILT_AT || new Date().toISOString()
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    optimizeDeps: {
      entries: ['index.html', 'src/main.tsx'],
    },
    build: {
      rolldownOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
              return 'react-vendor';
            }
            if (id.includes('tesseract.js')) {
              return 'ocr-vendor';
            }
            if (id.includes('lucide-react')) {
              return 'icons-vendor';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      ws: process.env.DISABLE_HMR === 'true' ? (false as const) : undefined,
      watch:
        process.env.DISABLE_HMR === 'true'
          ? null
          : {
              ignored: ['**/android/**', '**/dist/**', '**/.git/**'],
            },
    },
  };
});
