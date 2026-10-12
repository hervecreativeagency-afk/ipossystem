import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[tailwindcss()],build:{outDir:'dist',rollupOptions:{output:{manualChunks:{supabase:['@supabase/supabase-js']}}}}});
