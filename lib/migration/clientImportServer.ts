// lib/migration/clientImportServer.ts
//
// Server side of the client import: turns evaluated CSV rows into a dedupe
// preview, and commits them through upsertProClient (the single source of truth
// for client creation — silent, no client-facing invites). Match detection
// reuses the exact predicate upsertProClient uses, so "existing" here means the
// same thing a commit will merge into.

import { prisma } from '@/lib/prisma'
import {
  buildClientProfileLookupOrConditions,
  upsertProClient,
  type UpsertProClientResult,
} from '@/lib/clients/upsertProClient'

import {
  evaluateClientRows,
  type ColumnMapping,
  type ClientRowIssue,
  type RawCsvRow,
} from './clientImport'

const CLIENT_IMPORT_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toStringRecord(value: unknown): RawCsvRow {
  const out: RawCsvRow = {}
  if (!isRecord(value)) return out
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') out[key] = raw
  }
  return out
}

function toColumnMapping(value: unknown): ColumnMapping {
  const out: ColumnMapping = {}
  if (!isRecord(value)) return out
  for (const field of CLIENT_IMPORT_FIELDS) {
    const header = value[field]
    if (typeof header === 'string' && header.length > 0) out[field] = header
  }
  return out
}

export type ClientImportRequest = {
  rows: RawCsvRow[]
  mapping: ColumnMapping
  excludeIndices: number[]
}

// Parses + validates the request body for both preview and commit. Returns null
// if the shape is unusable, so routes can 400 cleanly. No casts — narrowing only.
export function parseClientImportRequest(body: unknown): ClientImportRequest | null {
  if (!isRecord(body)) return null
  if (!Array.isArray(body.rows)) return null
  const rows = body.rows.map(toStringRecord)
  const mapping = toColumnMapping(body.mapping)
  if (!mapping.firstName || !mapping.lastName) return null
  const excludeIndices = Array.isArray(body.excludeIndices)
    ? body.excludeIndices.filter((n): n is number => typeof n === 'number')
    : []
  return { rows, mapping, excludeIndices }
}

export type ClientPreviewMatch = 'NEW' | 'EXISTING' | 'MISSING_INFO'

export type ClientImportPreviewRow = {
  index: number
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  match: ClientPreviewMatch
  issues: ClientRowIssue[]
  importable: boolean
}

export type ClientImportPreview = {
  rows: ClientImportPreviewRow[]
  summary: {
    total: number
    importable: number
    existing: number
    new: number
    needsAttention: number
  }
}

async function contactMatchExists(
  email: string | null,
  phone: string | null,
): Promise<boolean> {
  const orConditions = buildClientProfileLookupOrConditions({ email, phone })
  if (orConditions.length === 0) return false
  const found = await prisma.clientProfile.findFirst({
    where: { OR: orConditions },
    select: { id: true },
  })
  return found !== null
}

export async function previewClientImport(args: {
  rows: RawCsvRow[]
  mapping: ColumnMapping
}): Promise<ClientImportPreview> {
  const evaluated = evaluateClientRows(args.rows, args.mapping)

  const rows: ClientImportPreviewRow[] = []
  for (let index = 0; index < evaluated.length; index += 1) {
    const row = evaluated[index]!
    let match: ClientPreviewMatch
    if (!row.importable) {
      match = 'MISSING_INFO'
    } else {
      match = (await contactMatchExists(row.parsed.email, row.parsed.phone))
        ? 'EXISTING'
        : 'NEW'
    }
    rows.push({
      index,
      firstName: row.parsed.firstName,
      lastName: row.parsed.lastName,
      email: row.parsed.email,
      phone: row.parsed.phone,
      match,
      issues: row.issues,
      importable: row.importable,
    })
  }

  const summary = {
    total: rows.length,
    importable: rows.filter((r) => r.importable).length,
    existing: rows.filter((r) => r.match === 'EXISTING').length,
    new: rows.filter((r) => r.match === 'NEW').length,
    needsAttention: rows.filter((r) => !r.importable).length,
  }

  return { rows, summary }
}

export type ClientCommitRowResult =
  | { index: number; ok: true; clientId: string }
  | { index: number; ok: false; error: string; code: string }

export type ClientImportCommitResult = {
  rows: ClientCommitRowResult[]
  summary: { attempted: number; imported: number; failed: number; skipped: number }
}

export async function commitClientImport(args: {
  professionalId: string
  rows: RawCsvRow[]
  mapping: ColumnMapping
  excludeIndices?: number[]
}): Promise<ClientImportCommitResult> {
  const excluded = new Set(args.excludeIndices ?? [])
  const evaluated = evaluateClientRows(args.rows, args.mapping)

  const results: ClientCommitRowResult[] = []
  let imported = 0
  let failed = 0
  let skipped = 0
  let attempted = 0

  // One transaction so successful rows commit atomically. upsertProClient
  // returns an error *result* (it doesn't throw) for validation/identity
  // conflicts, so a bad row records a failure without aborting the batch —
  // best-effort: valid rows import, the rare failures are reported back.
  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < evaluated.length; index += 1) {
      const row = evaluated[index]!
      if (!row.importable || excluded.has(index)) {
        skipped += 1
        continue
      }
      attempted += 1
      const result: UpsertProClientResult = await upsertProClient({
        professionalId: args.professionalId,
        firstName: row.parsed.firstName,
        lastName: row.parsed.lastName,
        email: row.parsed.email,
        phone: row.parsed.phone,
        tx,
      })
      if (result.ok) {
        imported += 1
        results.push({ index, ok: true, clientId: result.clientId })
      } else {
        failed += 1
        results.push({ index, ok: false, error: result.error, code: result.code })
      }
    }
  })

  return { rows: results, summary: { attempted, imported, failed, skipped } }
}
