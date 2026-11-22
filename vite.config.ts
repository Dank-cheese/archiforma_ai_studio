import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const geminiKey = env.GEMINI_API_KEY && !/^MY_/i.test(env.GEMINI_API_KEY) ? env.GEMINI_API_KEY : '';
  return {
    // Relative base so the built app works both at a domain root
    // (AI Studio / Cloud Run, Vercel, Netlify) and under a sub-path
    // such as GitHub Pages (https://<user>.github.io/<repo>/).
    // With the default '/', assets 404 on GitHub Pages and the page is blank.
    base: './',
    plugins: [react(), tailwindcss()],
    define: {
      // Lets "Design with AI" use the key Google AI Studio provides. Public builds have no key,
      // so visitors paste their own in AI settings (it stays in their browser).
      'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      // three.js + the CAD engine make one large bundle; that's expected.
      chunkSizeWarningLimit: 3000,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
