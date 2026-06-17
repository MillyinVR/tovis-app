// lib/migration/clientImportServer.test.ts
//
// Pure tests for the request parser. The preview/commit DB paths are exercised
// end-to-end through the wired page against the local dev DB.

import { describe, expect, it } from 'vitest'

import { parseClientImportRequest } from './clientImportServer'

describe('parseClientImportRequest', () => {
  const valid = {
    rows: [{ First: 'Maya', Last: 'Rodriguez', Email: 'maya@gmail.com' }],
    mapping: { firstName: 'First', lastName: 'Last', email: 'Email' },
  }

  it('parses a valid payload', () => {
    const parsed = parseClientImportRequest(valid)
    expect(parsed).not.toBeNull()
    expect(parsed?.rows).toHaveLength(1)
    expect(parsed?.mapping.firstName).toBe('First')
    expect(parsed?.excludeIndices).toEqual([])
  })

  it('rejects a body that is not an object', () => {
    expect(parseClientImportRequest(null)).toBeNull()
    expect(parseClientImportRequest('nope')).toBeNull()
  })

  it('rejects when rows is not an array', () => {
    expect(parseClientImportRequest({ rows: {}, mapping: valid.mapping })).toBeNull()
  })

  it('requires firstName + lastName mapping', () => {
    expect(
      parseClientImportRequest({ rows: valid.rows, mapping: { firstName: 'First' } }),
    ).toBeNull()
  })

  it('keeps only string cell values and numeric exclude indices', () => {
    const parsed = parseClientImportRequest({
      rows: [{ First: 'Maya', Last: 'R', Age: 30, Note: null }],
      mapping: { firstName: 'First', lastName: 'Last' },
      excludeIndices: [0, '2', 3],
    })
    expect(parsed?.rows[0]).toEqual({ First: 'Maya', Last: 'R' })
    expect(parsed?.excludeIndices).toEqual([0, 3])
  })
})
