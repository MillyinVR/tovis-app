// lib/migration/tableParse.test.ts

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import {
  MAX_TABLE_FILE_BYTES,
  parseSpreadsheet,
  parseTableParseRequest,
} from './tableParse'

function xlsxBuffer(rows: (string | number)[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
  const out: unknown = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  if (!Buffer.isBuffer(out)) throw new Error('expected buffer')
  return out
}

describe('parseSpreadsheet', () => {
  it('parses CSV text into headers + records', () => {
    const buf = Buffer.from('Name,Price\nBalayage,240\n"Cut, Long",85\n', 'utf8')
    const result = parseSpreadsheet(buf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.table.headers).toEqual(['Name', 'Price'])
    expect(result.table.rows).toEqual([
      { Name: 'Balayage', Price: '240' },
      { Name: 'Cut, Long', Price: '85' },
    ])
    expect(result.table.truncated).toBe(false)
  })

  it('strips a UTF-8 BOM before the first header', () => {
    const buf = Buffer.from('﻿Name,Price\nCut,85\n', 'utf8')
    const result = parseSpreadsheet(buf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.table.headers[0]).toBe('Name')
  })

  it('parses an xlsx workbook (Vagaro/Fresha-style export)', () => {
    const buf = xlsxBuffer([
      ['Service', 'Price', 'Duration'],
      ['Balayage', 240, 150],
      ['Gloss', 65, 45],
    ])
    const result = parseSpreadsheet(buf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.table.headers).toEqual(['Service', 'Price', 'Duration'])
    expect(result.table.rows).toEqual([
      { Service: 'Balayage', Price: '240', Duration: '150' },
      { Service: 'Gloss', Price: '65', Duration: '45' },
    ])
  })

  it('skips leading blank rows and names blank/duplicate headers uniquely', () => {
    const buf = xlsxBuffer([
      ['', '', ''],
      ['Name', '', 'Name'],
      ['Jane', 'x', 'Doe'],
    ])
    const result = parseSpreadsheet(buf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.table.headers).toEqual(['Name', 'Column 2', 'Name (2)'])
    expect(result.table.rows[0]).toEqual({ Name: 'Jane', 'Column 2': 'x', 'Name (2)': 'Doe' })
  })

  it('rejects an empty or headers-only file', () => {
    expect(parseSpreadsheet(Buffer.alloc(0)).ok).toBe(false)
    const headersOnly = parseSpreadsheet(Buffer.from('Name,Price\n', 'utf8'))
    expect(headersOnly.ok).toBe(false)
    if (!headersOnly.ok) expect(headersOnly.code).toBe('EMPTY')
  })

  it('rejects an oversized file', () => {
    const result = parseSpreadsheet(Buffer.alloc(MAX_TABLE_FILE_BYTES + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('TOO_LARGE')
  })

  it('rejects a corrupt zip that claims to be xlsx', () => {
    const buf = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(64, 7)])
    const result = parseSpreadsheet(buf)
    expect(result.ok).toBe(false)
  })
})

describe('parseTableParseRequest', () => {
  it('decodes a base64 payload', () => {
    const parsed = parseTableParseRequest({
      contentBase64: Buffer.from('Name,Price\nCut,85\n').toString('base64'),
    })
    expect('error' in parsed).toBe(false)
    if ('error' in parsed) return
    expect(parsed.content.toString('utf8')).toContain('Name,Price')
  })

  it('rejects missing/empty payloads', () => {
    expect(parseTableParseRequest(null)).toEqual({ error: 'INVALID' })
    expect(parseTableParseRequest({})).toEqual({ error: 'INVALID' })
    expect(parseTableParseRequest({ contentBase64: '' })).toEqual({ error: 'INVALID' })
  })

  it('rejects payloads over the size cap without decoding them', () => {
    const oversized = 'A'.repeat(Math.ceil((MAX_TABLE_FILE_BYTES * 4) / 3) + 16)
    expect(parseTableParseRequest({ contentBase64: oversized })).toEqual({ error: 'TOO_LARGE' })
  })
})
