#!/usr/bin/env node
// tools/check-api-schema.mjs
//
// Guards that the committed API JSON Schema (schema/api/tovis-api.schema.json) is
// in sync with the DTO barrel (lib/dto/index.ts). The schema is the wire contract
// a native client codegens from, so it must never drift from the TS types.
//
// Regenerates to a temp file and byte-compares. If they differ, a DTO changed
// without regenerating — run `npm run gen:api-schema` and commit the result.
//
// (ts-json-schema-generator output is deterministic for the same inputs.)
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const COMMITTED = 'schema/api/tovis-api.schema.json'
const ARGS = [
  '--path',
  'lib/dto/index.ts',
  '--type',
  '*',
  '--tsconfig',
  'tsconfig.json',
  '--additional-properties',
]

const tmp = mkdtempSync(join(tmpdir(), 'api-schema-'))
const out = join(tmp, 'schema.json')

try {
  execFileSync('npx', ['ts-json-schema-generator', ...ARGS, '--out', out], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })

  const fresh = readFileSync(out, 'utf8')
  let committed
  try {
    committed = readFileSync(COMMITTED, 'utf8')
  } catch {
    console.error(
      `check-api-schema: ${COMMITTED} is missing. Run \`npm run gen:api-schema\`.`,
    )
    process.exit(1)
  }

  if (fresh !== committed) {
    console.error(
      'check-api-schema: FAILED — the committed API schema is stale.\n' +
        'A DTO in lib/dto/index.ts (or a type it re-exports) changed.\n' +
        'Run `npm run gen:api-schema` and commit schema/api/tovis-api.schema.json.',
    )
    process.exit(1)
  }

  console.log('check-api-schema: passed (schema in sync with lib/dto/index.ts)')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
