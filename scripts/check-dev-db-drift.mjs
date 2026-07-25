#!/usr/bin/env node
// scripts/check-dev-db-drift.mjs
//
// DIAGNOSTIC — not a guard, and deliberately not wired into CI.
//
// The local dev database is `prisma db push`-managed by design, so it drifts
// behind merged migrations as a matter of course. That drift is invisible until
// you drive a route: Prisma raises `The column X does not exist in the current
// database`, Next renders it as a generic "Internal server error", and it reads
// like a bug in whatever you just wrote. B1-A lost two driving rounds to exactly
// that (booking-calendar-truth-audit-plan.md §7.7).
//
// This prints the diff between the Prisma schema's scalar fields and
// `information_schema.columns`, plus the `ALTER TABLE … ADD COLUMN IF NOT
// EXISTS` statements that would close it. It does NOT run them — read them
// first, then apply, then restart `pnpm dev` (the running server holds the old
// DMMF and will keep failing until it is restarted).
//
//   node scripts/check-dev-db-drift.mjs
//   node scripts/check-dev-db-drift.mjs --url=postgresql://…@localhost:5433/tovis_test
//
// Refuses any non-local host: this must never be pointed at production.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { PrismaClient, Prisma } from '@prisma/client'

const SCHEMA_PATH = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'prisma',
  'schema.prisma',
)

const DEFAULT_DEV_URL = 'postgresql://postgres:postgres@localhost:5434/tovis_dev'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function parseArgs(argv) {
  let url = null
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--url=')) url = arg.slice('--url='.length)
    else if (arg === '--help' || arg === '-h') return { help: true, url: null }
    else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return { help: false, url }
}

function redact(url) {
  try {
    const parsed = new URL(url)
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    return '(unparseable url)'
  }
}

/**
 * Hard local-only gate. The dev DB lives in docker on localhost; production is
 * remote Supabase, and `.env.local` points at it — so a script that silently
 * inherited DATABASE_URL could be aimed at prod by accident. Host allowlist,
 * checked before a connection is opened.
 */
function assertLocalUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Not a valid connection URL: ${redact(url)}`)
  }

  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Refusing to inspect a non-local database (host "${parsed.hostname}"). ` +
        'This diagnostic is dev-only; production drift is not fixed by hand.',
    )
  }
}

const SCALAR_TO_PG = {
  String: 'TEXT',
  Boolean: 'BOOLEAN',
  Int: 'INTEGER',
  BigInt: 'BIGINT',
  Float: 'DOUBLE PRECISION',
  Decimal: 'DECIMAL(65,30)',
  DateTime: 'TIMESTAMP(3)',
  Json: 'JSONB',
  Bytes: 'BYTEA',
}

const ENUM_NAMES = new Set(Prisma.dmmf.datamodel.enums.map((e) => e.name))

/**
 * `Unsupported("…")` fields (postgis `geography`, pgvector `vector`) are real
 * columns the migrations create, but the DMMF drops them entirely — so a
 * DMMF-only diff reports them as columns the schema does not know about. Read
 * them straight out of schema.prisma so they are neither proposed as missing
 * nor reported as extra.
 */
function readUnsupportedColumnsByModel() {
  const source = readFileSync(SCHEMA_PATH, 'utf8')
  const byModel = new Map()

  let currentModel = null
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()

    const modelStart = /^model\s+(\w+)\s*\{/.exec(line)
    if (modelStart) {
      currentModel = modelStart[1]
      continue
    }

    if (currentModel && line === '}') {
      currentModel = null
      continue
    }

    if (!currentModel) continue

    const unsupported = /^(\w+)\s+Unsupported\(/.exec(line)
    if (unsupported) {
      if (!byModel.has(currentModel)) byModel.set(currentModel, new Set())
      byModel.get(currentModel).add(unsupported[1])
    }
  }

  return byModel
}

function nativeTypeToPg(nativeType) {
  if (!Array.isArray(nativeType) || nativeType.length === 0) return null
  const [name, args] = nativeType
  const argList = Array.isArray(args) ? args : []
  return argList.length ? `${name}(${argList.join(',')})` : name
}

/**
 * The column type to propose. `@db.` native types win where present (a
 * VarChar(64) column written as TEXT would diverge from what the migration
 * actually creates); otherwise fall back to Prisma's default mapping.
 */
function pgTypeForField(field) {
  const native = nativeTypeToPg(field.nativeType)
  if (native) return field.isList ? `${native}[]` : native

  if (ENUM_NAMES.has(field.type)) {
    return field.isList ? `"${field.type}"[]` : `"${field.type}"`
  }

  const base = SCALAR_TO_PG[field.type]
  if (!base) return null

  return field.isList ? `${base}[]` : base
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * The DEFAULT clause for a proposed column, or null when the value is generated
 * by the application (cuid/uuid) or by the database in a way this script should
 * not guess at (dbgenerated/autoincrement).
 */
function defaultClauseForField(field) {
  if (!field.hasDefaultValue) return null

  const def = field.default

  if (def && typeof def === 'object' && !Array.isArray(def)) {
    if (def.name === 'now') return 'now()'
    return null
  }

  if (Array.isArray(def)) return null

  if (typeof def === 'boolean' || typeof def === 'number') return String(def)

  if (typeof def === 'string') {
    if (ENUM_NAMES.has(field.type)) {
      return `${quoteLiteral(def)}::"${field.type}"`
    }
    return quoteLiteral(def)
  }

  return null
}

function buildAlter(model, field) {
  const type = pgTypeForField(field)
  if (!type) return null

  const defaultClause = defaultClauseForField(field)

  // NOT NULL is only proposed when a default can back-fill the existing rows.
  // A required column with no default cannot be added NOT NULL to a table that
  // already has rows, so it is proposed nullable with the mismatch called out
  // rather than emitting a statement that would fail.
  const canBeNotNull = field.isRequired && defaultClause !== null

  const parts = [`ALTER TABLE "${model}" ADD COLUMN IF NOT EXISTS "${field.name}" ${type}`]
  if (defaultClause !== null) parts.push(`DEFAULT ${defaultClause}`)
  if (canBeNotNull) parts.push('NOT NULL')

  return {
    sql: `${parts.join(' ')};`,
    note:
      field.isRequired && !canBeNotNull
        ? 'schema says required, but no default to back-fill — proposed nullable'
        : null,
  }
}

async function main() {
  const { help, url: urlArg } = parseArgs(process.argv)

  if (help) {
    console.log(
      [
        'Usage: node scripts/check-dev-db-drift.mjs [--url=<postgres url>]',
        '',
        'Diffs the Prisma schema against a LOCAL database and prints the',
        'ALTER TABLE statements that would close the gap. Does not run them.',
        `Default URL: ${DEFAULT_DEV_URL}`,
      ].join('\n'),
    )
    return 0
  }

  const url = urlArg ?? DEFAULT_DEV_URL
  assertLocalUrl(url)

  console.log(`Prisma schema vs ${redact(url)}`)
  console.log('(presence only — column types and nullability are not compared)\n')

  const prisma = new PrismaClient({ datasourceUrl: url })

  let rows
  try {
    rows = await prisma.$queryRaw`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `
  } finally {
    await prisma.$disconnect()
  }

  const dbColumns = new Map()
  for (const row of rows) {
    const table = row.table_name
    if (!dbColumns.has(table)) dbColumns.set(table, new Set())
    dbColumns.get(table).add(row.column_name)
  }

  const missingTables = []
  const missingColumns = []
  const extraColumns = []
  const unsupportedByModel = readUnsupportedColumnsByModel()

  for (const model of Prisma.dmmf.datamodel.models) {
    // No @@map / @map anywhere in this schema, so model name == table name and
    // field name == column name. dbName is still honoured in case that changes.
    const table = model.dbName ?? model.name
    const present = dbColumns.get(table)

    if (!present) {
      missingTables.push(table)
      continue
    }

    const schemaColumns = new Set(unsupportedByModel.get(model.name) ?? [])

    for (const missing of schemaColumns) {
      if (!present.has(missing)) {
        // No ALTER is proposed: the type only exists in schema.prisma as an
        // opaque string, so `pnpm db:dev:push` is the honest fix.
        missingColumns.push({ table, field: null, column: missing })
      }
    }

    for (const field of model.fields) {
      // Relations and Prisma-side computed kinds have no column of their own.
      if (field.kind === 'object') continue
      if (field.isList && field.kind === 'object') continue

      const column = field.dbName ?? field.name
      schemaColumns.add(column)

      if (!present.has(column)) {
        missingColumns.push({ table, field, column })
      }
    }

    for (const column of present) {
      if (!schemaColumns.has(column)) extraColumns.push({ table, column })
    }
  }

  if (missingTables.length) {
    console.log(`❌ ${missingTables.length} table(s) missing entirely:`)
    for (const table of missingTables) console.log(`   ${table}`)
    console.log('\n   → run `pnpm db:dev:push` (adding these by hand is not worth it)\n')
  }

  if (missingColumns.length) {
    console.log(`❌ ${missingColumns.length} column(s) in the schema but not in the database:\n`)

    const unsupported = []
    let alterCount = 0
    for (const { table, field, column } of missingColumns) {
      const alter = field ? buildAlter(table, field) : null
      if (!alter) {
        const described = field
          ? `${field.type}${field.isList ? '[]' : ''}`
          : 'Unsupported()'
        unsupported.push(`${table}.${column} (${described})`)
        continue
      }
      console.log(alter.sql)
      if (alter.note) console.log(`  -- ⚠️  ${alter.note}`)
      alterCount += 1
    }

    if (unsupported.length) {
      // Leading newline only when ALTERs were actually printed above, or the
      // report opens on a stray blank line.
      console.log(
        `${alterCount ? '\n' : ''}⚠️  no ALTER proposed for these ` +
          '(unmapped type — use `pnpm db:dev:push`):',
      )
      for (const entry of unsupported) console.log(`   ${entry}`)
    }

    // Only claim there are statements to apply when some were printed.
    if (alterCount) {
      console.log(
        '\n→ apply the statements above, then RESTART `pnpm dev`.' +
          '\n  The running server caches the old DMMF and keeps 500ing until it is.',
      )
    }
  }

  if (extraColumns.length) {
    console.log(
      `\nℹ️  ${extraColumns.length} column(s) in the database but not in the schema ` +
        '(expected on a db-push database — dropped fields are not removed):',
    )
    for (const { table, column } of extraColumns.slice(0, 20)) {
      console.log(`   ${table}.${column}`)
    }
    if (extraColumns.length > 20) {
      console.log(`   … and ${extraColumns.length - 20} more`)
    }
  }

  if (!missingTables.length && !missingColumns.length) {
    console.log('✅ every Prisma scalar field has a column — no drift to fix.')
  }

  // Always exit 0: drift is EXPECTED on a db-push database. This reports, it
  // does not gate. Wiring it into CI would be a category error.
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\ncheck-dev-db-drift failed: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  })
