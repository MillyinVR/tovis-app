// lib/migration/tableParse.ts
//
// Server-side spreadsheet → rows for the pro migration wizard. Real booking-app
// exports are often Excel, not CSV (Vagaro and Fresha hand out .xlsx by
// default), and the browser/iOS clients only parse plain-text CSV locally — so
// binary spreadsheets are shuttled here instead of asking the pro to convert
// them by hand. One endpoint serves both web and iOS, so the xlsx logic lives
// exactly once.
//
// Output shape matches what the client-side CSV parsers feed the import steps:
// a header list plus one Record<header, string> per row, so the downstream
// mapping/preview/commit pipeline is identical no matter where parsing ran.

import Papa from 'papaparse'
import * as XLSX from 'xlsx'

// Caps keep a hostile/degenerate upload from ballooning memory: the base64
// request body is bounded by the route, and these bound the parsed output.
export const MAX_TABLE_FILE_BYTES = 8 * 1024 * 1024 // 8 MB decoded
const MAX_ROWS = 20_000
const MAX_COLS = 100

export type ParsedTable = {
  headers: string[]
  rows: Record<string, string>[]
  /** True when row/column caps truncated the output. */
  truncated: boolean
}

export type TableParseResult =
  | { ok: true; table: ParsedTable }
  | { ok: false; code: 'EMPTY' | 'UNSUPPORTED' | 'TOO_LARGE'; error: string }

function isZipMagic(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
}

function isOleMagic(buf: Buffer): boolean {
  // Legacy .xls (OLE compound file): D0 CF 11 E0 A1 B1 1A E1
  return (
    buf.length >= 8 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0
  )
}

// First row → unique, non-empty header names. Empty cells become positional
// names and duplicates get a numeric suffix so record keys never collide (and
// the mapping UI can still show every column).
function normalizeHeaders(rawHeader: string[]): string[] {
  const seen = new Map<string, number>()
  return rawHeader.map((raw, i) => {
    const base = raw.trim() || `Column ${i + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} (${count + 1})`
  })
}

function toTable(grid: string[][]): TableParseResult {
  const firstNonEmpty = grid.findIndex((row) => row.some((cell) => cell.trim() !== ''))
  if (firstNonEmpty === -1) {
    return { ok: false, code: 'EMPTY', error: 'That file has no readable rows.' }
  }

  const headerRow = grid[firstNonEmpty]!.slice(0, MAX_COLS)
  const headers = normalizeHeaders(headerRow)

  const rows: Record<string, string>[] = []
  let truncated = grid[firstNonEmpty]!.length > MAX_COLS
  for (const cells of grid.slice(firstNonEmpty + 1)) {
    if (!cells.some((cell) => cell.trim() !== '')) continue
    if (rows.length >= MAX_ROWS) {
      truncated = true
      break
    }
    const record: Record<string, string> = {}
    headers.forEach((header, i) => {
      record[header] = (cells[i] ?? '').trim()
    })
    rows.push(record)
  }

  if (rows.length === 0) {
    return { ok: false, code: 'EMPTY', error: 'That file has no data rows under its header.' }
  }
  return { ok: true, table: { headers, rows, truncated } }
}

function parseExcel(buf: Buffer): TableParseResult {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buf, { type: 'buffer', dense: true })
  } catch {
    return { ok: false, code: 'UNSUPPORTED', error: 'We could not read that spreadsheet.' }
  }
  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!sheet) {
    return { ok: false, code: 'EMPTY', error: 'That spreadsheet has no sheets.' }
  }
  // raw:false renders each cell as its *formatted* text (dates/prices come out
  // the way the pro sees them in Excel), which is what the string pipeline
  // downstream expects.
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })
  return toTable(grid.map((row) => row.map((cell) => String(cell ?? ''))))
}

function parseCsvText(text: string): TableParseResult {
  const clean = text.replace(/^﻿/, '')
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: true })
  const grid = result.data.filter((row): row is string[] => Array.isArray(row))
  return toTable(grid.map((row) => row.map((cell) => String(cell ?? ''))))
}

// Parse an uploaded spreadsheet (xlsx / legacy xls / CSV text) into headers +
// string records. Format is sniffed from magic bytes, not the file name — pros
// rename files and booking apps mislabel exports.
export function parseSpreadsheet(buf: Buffer): TableParseResult {
  if (buf.length === 0) {
    return { ok: false, code: 'EMPTY', error: 'That file is empty.' }
  }
  if (buf.length > MAX_TABLE_FILE_BYTES) {
    return { ok: false, code: 'TOO_LARGE', error: 'That file is too large to import.' }
  }
  if (isZipMagic(buf) || isOleMagic(buf)) return parseExcel(buf)
  return parseCsvText(buf.toString('utf8'))
}

// ── request parsing (route-level; no casts) ──────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Base64 of MAX_TABLE_FILE_BYTES plus padding slack.
const MAX_BASE64_LENGTH = Math.ceil((MAX_TABLE_FILE_BYTES * 4) / 3) + 8

export type TableParseRequest = { content: Buffer }

export function parseTableParseRequest(
  body: unknown,
): TableParseRequest | { error: 'INVALID' | 'TOO_LARGE' } {
  if (!isRecord(body) || typeof body.contentBase64 !== 'string' || !body.contentBase64) {
    return { error: 'INVALID' }
  }
  if (body.contentBase64.length > MAX_BASE64_LENGTH) return { error: 'TOO_LARGE' }
  const content = Buffer.from(body.contentBase64, 'base64')
  if (content.length === 0) return { error: 'INVALID' }
  return { content }
}
