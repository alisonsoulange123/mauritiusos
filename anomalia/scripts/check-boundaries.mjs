#!/usr/bin/env node
/**
 * Static architecture guard. Runs in CI before typecheck.
 *
 * ESLint enforces boundaries while you edit; this script enforces them even if
 * someone disables a rule inline. It is deliberately dumb (regex over source)
 * so it can never be silenced by configuration.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = process.cwd();
const API = join(ROOT, 'apps/api/src');
const WEB = join(ROOT, 'apps/web/src');

const violations = [];

function walk(dir, exts = ['.ts', '.tsx']) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full, exts);
    return exts.some((e) => full.endsWith(e)) ? [full] : [];
  });
}

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function importsOf(file) {
  const src = readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(IMPORT_RE)) out.push({ spec: m[1] ?? m[2], src });
  return out;
}

function report(file, spec, rule) {
  violations.push(`${relative(ROOT, file)}\n    imports "${spec}"\n    ✗ ${rule}`);
}

// ── Rule 1: core must not depend on modules ────────────────────────────────
for (const file of walk(join(API, 'core'))) {
  for (const { spec } of importsOf(file)) {
    if (/(^|\/)modules\//.test(spec) || spec.startsWith('@modules/')) {
      report(file, spec, 'core/ must not import from modules/ (dependency inversion via the registry).');
    }
  }
}

// ── Rule 2: no cross-module imports ───────────────────────────────────────
//
// Relative specifiers are RESOLVED before being judged. A bare regex on the
// text would miss `../../identity/infrastructure/x.js`, which is the form a
// cross-module import actually takes when someone reaches for autocomplete —
// the very case this rule exists to catch.
//
// Returns which module/feature directory a path belongs to, or null when it
// belongs to none. Null covers two legitimate cases that must NOT be treated
// as modules:
//
//   • a file sitting directly in `modules/` or `features/` — that is the
//     composition layer (registry.ts, feature.definition.ts), which is
//     *supposed* to import every module;
//   • shared test scaffolding.
const EXEMPT_DIRS = new Set(['__tests__', '__mocks__', '__fixtures__']);

function moduleOwnerOf(absPath, rootDir) {
  const rel = relative(rootDir, absPath);
  if (!rel || rel.startsWith('..')) return null;
  const segments = rel.split(sep);
  // Length 1 means a bare file in the root: composition, not a module.
  if (segments.length < 2) return null;
  const owner = segments[0];
  if (EXEMPT_DIRS.has(owner)) return null;
  if (!existsSync(join(rootDir, owner)) || !statSync(join(rootDir, owner)).isDirectory()) return null;
  return owner;
}

// Importing another module's ROOT (`./identity`, i.e. its index.ts) is still
// a cross-module import — it is only legal from the composition layer, which
// moduleOwnerOf already excludes from the check.
function moduleRootOf(absPath, rootDir) {
  const rel = relative(rootDir, absPath);
  if (!rel || rel.startsWith('..')) return null;
  const segments = rel.split(sep);
  if (segments.length !== 1) return null;
  const candidate = join(rootDir, segments[0]);
  return existsSync(candidate) && statSync(candidate).isDirectory() ? segments[0] : null;
}

const MODULES_DIR = join(API, 'modules');
for (const file of walk(MODULES_DIR)) {
  const owner = moduleOwnerOf(file, MODULES_DIR);
  if (!owner) continue;

  for (const { spec } of importsOf(file)) {
    let target = null;
    let deepPath = '';

    if (spec.startsWith('.')) {
      // Resolve against the importing file's directory, then see which module
      // the result lands in.
      const resolved = resolve(dirname(file), spec);
      const hit = moduleOwnerOf(resolved, MODULES_DIR) ?? moduleRootOf(resolved, MODULES_DIR);
      if (hit && hit !== owner) {
        target = hit;
        deepPath = relative(join(MODULES_DIR, hit), resolved);
      }
    } else {
      const m = spec.match(/(?:@modules\/|modules\/)([^/]+)(?:\/(.+))?/);
      if (m && m[1] !== owner) {
        target = m[1];
        deepPath = m[2] ?? '';
      }
    }

    if (target) {
      report(
        file,
        spec,
        `module "${owner}" reaches into "${target}${deepPath ? `/${deepPath}` : ''}". ` +
          'Use the EventBus or a ContractToken from @anomalia/contracts.',
      );
    }
  }
}

// ── Rule 3: domain layer purity ───────────────────────────────────────────
const FORBIDDEN_IN_DOMAIN = [/^@nestjs\//, /^drizzle-orm/, /^pg$/, /^ioredis$/, /^bullmq$/];
for (const file of walk(join(API, 'modules'))) {
  if (!file.includes(`${sep}domain${sep}`)) continue;
  for (const { spec } of importsOf(file)) {
    if (FORBIDDEN_IN_DOMAIN.some((re) => re.test(spec))) {
      report(file, spec, 'domain/ must remain framework- and persistence-agnostic.');
    }
  }
}

// ── Rule 4: frontend features stay isolated ───────────────────────────────
const FEATURES_DIR = join(WEB, 'features');
for (const file of walk(FEATURES_DIR)) {
  const owner = moduleOwnerOf(file, FEATURES_DIR);
  if (!owner) continue;

  for (const { spec } of importsOf(file)) {
    if (/^@\/app\//.test(spec)) {
      report(file, spec, 'features/ must not import from app/. Data flows app/ -> features/, never back.');
      continue;
    }

    let target = null;
    if (spec.startsWith('.')) {
      const resolved = resolve(dirname(file), spec);
      const hit = moduleOwnerOf(resolved, FEATURES_DIR) ?? moduleRootOf(resolved, FEATURES_DIR);
      if (hit && hit !== owner) target = hit;
    } else {
      const m = spec.match(/^@\/features\/([^/]+)\/(.+)/);
      if (m && m[1] !== owner) target = m[1];
    }

    if (target) {
      report(
        file,
        spec,
        `feature "${owner}" imports internals of "${target}". Features compose only via app/ or shared/.`,
      );
    }
  }
}

// ── Rule 5: UI primitives are dumb ────────────────────────────────────────
for (const file of walk(join(WEB, 'components/ui'))) {
  for (const { spec } of importsOf(file)) {
    if (/^@\/features\//.test(spec) || /^@\/app\//.test(spec)) {
      report(file, spec, 'components/ui must contain no business knowledge.');
    }
  }
}

if (violations.length) {
  console.error(`\n✗ ${violations.length} architecture boundary violation(s):\n`);
  console.error(violations.join('\n\n'));
  console.error('\nSee docs/ARCHITECTURE.md §"Boundaries" for the rationale.\n');
  process.exit(1);
}
console.warn('✓ architecture boundaries clean');
