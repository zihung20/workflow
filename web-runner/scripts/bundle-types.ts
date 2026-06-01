/**
 * Custom .d.ts bundler. Recursively reads declaration files, strips .js from
 * relative import paths, then produces a single `declare module 'pkg' { ... }`.
 *
 * Handles rollup's code-split output where chunk files export symbols under
 * short aliases (e.g. `export { StateKind as S }`) and the entry re-exports
 * them with public names (`export { S as StateKind } from './chunk'`).
 * The bundle emits only the public names from the entry file.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function bundle(pkgDir: string, entryFile: string, moduleName: string): string {
  const visited = new Set<string>();
  const declChunks: string[] = [];
  // filePath → Map<alias, localDeclName>
  // e.g. 'workflow-xxx.d.ts' → { S: 'StateKind', i: 'StateStatus', ... }
  const chunkAliasMap = new Map<string, Map<string, string>>();

  // ── Pass 1: collect alias maps from every file ──────────────────────────
  function buildAliasMaps(filePath: string): void {
    if (visited.has(filePath) || !existsSync(filePath)) return;
    visited.add(filePath);

    const raw = readFileSync(filePath, 'utf-8');
    const dir = dirname(filePath);

    for (const m of raw.matchAll(/(?:import|export)\s[^'"]*from\s+['"](\.[^'"]+)['"]/g)) {
      const p = m[1]!.replace(/\.js$/, '');
      for (const c of [resolve(dir, p + '.d.ts'), resolve(dir, p, 'index.d.ts')]) {
        if (existsSync(c)) { buildAliasMaps(c); break; }
      }
    }

    // Build alias → localName map from export-alias lines.
    // e.g. `export { StateKind as S, type AnyState as a }` → { S: 'StateKind', a: 'AnyState' }
    const aliasMap = new Map<string, string>();
    for (const exportLine of raw.matchAll(/^export\s+\{([^}]+)\}/mg)) {
      for (const part of exportLine[1]!.split(',')) {
        const m = part.trim().match(/^(?:type\s+)?(\w+)\s+as\s+(\w+)$/);
        if (m) aliasMap.set(m[2]!, m[1]!); // alias → local
      }
    }
    chunkAliasMap.set(filePath, aliasMap);
  }

  // ── Pass 2: collect declarations ────────────────────────────────────────
  const entryPath = resolve(pkgDir, entryFile);
  buildAliasMaps(entryPath);
  visited.clear();

  function collectDecls(filePath: string, isEntry: boolean): void {
    if (visited.has(filePath) || !existsSync(filePath)) return;
    visited.add(filePath);

    const raw = readFileSync(filePath, 'utf-8');
    const dir = dirname(filePath);

    // Recurse depth-first so dependencies appear before dependents.
    for (const m of raw.matchAll(/(?:import|export)\s[^'"]*from\s+['"](\.[^'"]+)['"]/g)) {
      const p = m[1]!.replace(/\.js$/, '');
      for (const c of [resolve(dir, p + '.d.ts'), resolve(dir, p, 'index.d.ts')]) {
        if (existsSync(c)) { collectDecls(c, false); break; }
      }
    }

    const lines = raw.split('\n').filter(line => {
      const t = line.trim();

      if (isEntry) {
        // Drop intra-package imports (included via recursion).
        // Keep external-package imports (e.g. `import { ZodSchema } from 'zod'`).
        if (/^import\s[^'"]*from\s+['"]\.\.?\//.test(t)) return false;
        if (t === 'export {};' || t === 'export {}') return false;
        return true;
      } else {
        // Drop import/export-FROM lines; keep standalone `export { X as Y }` blocks —
        // they carry public names (zod's `export { objectType as object }`).
        // Rollup chunk short-alias exports (`export { StateKind as S }`) become
        // harmless extra exports alongside the resolved public names from the entry.
        if (/^(?:import|export)\s[^'"]*from\s+['"]/.test(t)) return false;
        // Keep external-package imports (e.g. `import { ZodSchema } from 'zod'`).
        if (/^import\s[^'"]*from\s+['"][^."]/.test(t)) return true;
        if (t === 'export {};' || t === 'export {}') return false;
        return true;
      }
    });

    // For the entry file, transform re-export-from lines into direct exports
    // using public names resolved through the alias map.
    // e.g. `export { S as StateKind } from './chunk'` → `export { StateKind };`
    const resolved = isEntry
      ? lines.map(line => {
          const m = line.match(/^export\s+\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"]/);
          if (!m) return line;

          const chunkPath = (() => {
            const p = m[2]!.replace(/\.js$/, '');
            for (const c of [resolve(dir, p + '.d.ts'), resolve(dir, p, 'index.d.ts')]) {
              if (existsSync(c)) return c;
            }
            return null;
          })();
          const aliasMap = chunkPath ? (chunkAliasMap.get(chunkPath) ?? new Map()) : new Map();

          const parts = m[1]!.split(',').map(part => {
            const pm = part.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);
            if (!pm) return part.trim();
            const chunkAlias = pm[1]!;
            const publicName = pm[2] ?? pm[1]!;
            const localDeclName = aliasMap.get(chunkAlias) ?? chunkAlias;
            return localDeclName === publicName ? publicName : `${localDeclName} as ${publicName}`;
          });
          return `export { ${parts.join(', ')} };`;
        })
      : lines;

    const text = resolved.join('\n').trim();
    if (text) declChunks.push(text);
  }

  collectDecls(entryPath, true);

  return `declare module '${moduleName}' {\n${declChunks.join('\n\n')}\n}\n`;
}

const root = resolve(__dirname, '..');

mkdirSync(resolve(root, 'src/types'), { recursive: true });

// ── zod ─────────────────────────────────────────────────────────────────────
const zodOut = bundle(resolve(root, 'node_modules/zod/v3'), 'external.d.ts', 'zod');
writeFileSync(resolve(root, 'src/types/zod.bundle.d.ts'), zodOut);
console.log('zod.bundle.d.ts:', zodOut.split('\n').length, 'lines');

// ── flowyd ───────────────────────────────────────────────────────────────────
const flowydOut = bundle(resolve(root, '../flowyd/dist'), 'index.d.ts', 'flowyd');
writeFileSync(resolve(root, 'src/types/flowyd.bundle.d.ts'), flowydOut);
console.log('flowyd.bundle.d.ts:', flowydOut.split('\n').length, 'lines');
