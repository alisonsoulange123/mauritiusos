/**
 * Exports the Zod event catalog as JSON Schema so the Python AI worker
 * validates against the *same* definitions as the Node services.
 *
 * TypeScript owns the contract; Python consumes a generated artifact. Run via
 * `pnpm contracts:export` and in CI — a drifted artifact fails the build.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { eventCatalog } from '../src/events/catalog';
import { eventEnvelopeSchema } from '../src/events/envelope';
import { MODULE_KEYS, ROLES } from '../src/modules/keys';

const out = resolve(import.meta.dirname, '../generated/contracts.schema.json');

const document = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Reef Technologies platform contracts',
  generatedBy: 'packages/contracts/scripts/export-json-schema.ts',
  moduleKeys: MODULE_KEYS,
  roles: ROLES,
  envelope: zodToJsonSchema(eventEnvelopeSchema, 'EventEnvelope'),
  events: Object.fromEntries(
    Object.entries(eventCatalog).map(([name, schema]) => [name, zodToJsonSchema(schema, name)]),
  ),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
console.warn(`✓ exported ${Object.keys(eventCatalog).length} event schemas -> ${out}`);
