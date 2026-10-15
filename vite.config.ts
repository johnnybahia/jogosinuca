import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

const base = process.env.VITE_BASE ?? '/';
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

/** Gera dist/sw.js com a lista de arquivos + hash de conteúdo (jogo offline e atualização por botão dentro do jogo). */
function offlinePlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'sinuca-offline',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: { url: string; hash: string }[] = [];
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else {
            const rel = relative(outDir, full).split('\\').join('/');
            if (rel === 'sw.js' || rel.endsWith('.map') || name.startsWith('.')) continue;
            files.push({ url: rel, hash: createHash('sha1').update(readFileSync(full)).digest('hex').slice(0, 12) });
          }
        }
      };
      walk(outDir);
      files.sort((a, b) => a.url.localeCompare(b.url));
      const version = createHash('sha1').update(files.map((f) => f.url + f.hash).join('|')).digest('hex').slice(0, 10);
      const tpl = readFileSync('scripts/sw.template.js', 'utf8');
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ v: version }));
      writeFileSync(join(outDir, 'sw.js'), tpl.replace('__VERSION__', version).replace('__BASE__', base).replace('__FILES__', JSON.stringify(files)));
    },
  };
}

export default defineConfig({
  base,
  plugins: [offlinePlugin()],
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? pkg.version) },
  server: { host: true, port: 3000 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // three.js em arquivo próprio: o navegador mantém em cache entre versões do jogo
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  test: { include: ['shared/**/*.test.ts', 'client/**/*.test.ts'], testTimeout: 60000 },
});
