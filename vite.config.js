import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

// Writes the list of every built file into sw.js, so each release changes the
// service worker (phones pick up the update) and everything — including parts
// loaded on demand, like the camera scanner — is saved for offline use.
function offlineAssetList() {
  let files = [], outDir = 'dist';
  return {
    name: 'ipos-offline-asset-list',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir; },
    generateBundle(_, bundle) { files = Object.keys(bundle).filter(f => f.startsWith('assets/')).map(f => '/' + f).sort(); },
    closeBundle() {
      const sw = path.resolve(outDir, 'sw.js');
      if (!fs.existsSync(sw)) return;
      const src = fs.readFileSync(sw, 'utf8');
      if (!src.includes('self.__BUILD_ASSETS__')) throw new Error('sw.js is missing the self.__BUILD_ASSETS__ placeholder');
      fs.writeFileSync(sw, src.replaceAll('self.__BUILD_ASSETS__', JSON.stringify(files)));
    },
  };
}

export default defineConfig({ define: { __APP_VERSION__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7)) }, plugins: [tailwindcss(), offlineAssetList()], build: { outDir: 'dist', rollupOptions: { output: { manualChunks: { supabase: ['@supabase/supabase-js'] } } } } });
