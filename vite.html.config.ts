// Builds ARCHIFORMA as ONE self-contained HTML file (all JS + CSS inlined)
// into docs/index.html. No TypeScript is left in the output, so GitHub Pages
// can serve it straight from the repo ("Deploy from a branch" → /docs),
// and it can be opened by double-clicking the file.
import {defineConfig, mergeConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import base from './vite.config';

export default defineConfig((env) =>
  mergeConfig((base as any)(env), {
    plugins: [viteSingleFile()],
    build: {outDir: 'docs', emptyOutDir: true},
    // docs/index.html is public: never bake an API key into it.
    define: {'process.env.GEMINI_API_KEY': JSON.stringify('')},
  }),
);
