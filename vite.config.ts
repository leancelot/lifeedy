import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  // Se o arquivo local firebase-applet-config.json existir no disco (ignorado pelo git),
  // carrega suas chaves em tempo de execução sem expor no repositório.
  let localConfig: Record<string, string> = {};
  const configPath = path.resolve(import.meta.dirname, 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    try {
      localConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_APP_URL': JSON.stringify(
        process.env.VITE_APP_URL || process.env.APP_URL || ''
      ),
      'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(
        process.env.VITE_FIREBASE_API_KEY || localConfig.apiKey || ''
      ),
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(
        process.env.VITE_FIREBASE_PROJECT_ID || localConfig.projectId || ''
      ),
      'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(
        process.env.VITE_FIREBASE_APP_ID || localConfig.appId || ''
      ),
      'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(
        process.env.VITE_FIREBASE_AUTH_DOMAIN || localConfig.authDomain || ''
      ),
      'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(
        process.env.VITE_FIREBASE_STORAGE_BUCKET || localConfig.storageBucket || ''
      ),
      'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(
        process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || localConfig.messagingSenderId || ''
      ),
      'import.meta.env.VITE_FIREBASE_OAUTH_CLIENT_ID': JSON.stringify(
        process.env.VITE_FIREBASE_OAUTH_CLIENT_ID || localConfig.oAuthClientId || ''
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
            if (id.includes('firebase') || id.includes('@firebase')) {
              return 'firebase-vendor';
            }
            if (id.includes('tesseract.js')) {
              return 'ocr-vendor';
            }
            if (id.includes('motion') || id.includes('framer-motion')) {
              return 'motion-vendor';
            }
            if (id.includes('lucide-react')) {
              return 'icons-vendor';
            }
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('/scheduler/')) {
              return 'react-vendor';
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
