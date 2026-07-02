// lib/looks/proLooksList.test.ts
import { describe, expect, it } from 'vitest'
import { LookPostStatus } from '@prisma/client'

import {
  PRO_LOOKS_LISTABLE_STATUSES,
  buildProLooksCursorWhere,
  buildProLooksWhere,
  decodeProLooksCursor,
  encodeProLooksCursor,
  parseProLooksStatusParam,
} from './proLooksList'

describe('parseProLooksStatusParam', () => {
  it('returns every listable status when the param is absent or blank', () => {
    expect(parseProLooksStatusParam(null)).toEqual(
      PRO_LOOKS_LISTABLE_STATUSES,
    )
    expect(parseProLooksStatusParam('   ')).toEqual(
      PRO_LOOKS_LISTABLE_STATUSES,
    )
  })

  it('narrows to a single status, case-insensitively', () => {
    expect(parseProLooksStatusParam('draft')).toEqual([
      LookPostStatus.DRAFT,
    ])
    expect(parseProLooksStatusParam('PUBLISHED')).toEqual([
      LookPostStatus.PUBLISHED,
    ])
  })

  it('rejects unknown statuses', () => {
    expect(parseProLooksStatusParam('REMOVED')).toBeNull()
    expect(parseProLooksStatusParam('nope')).toBeNull()
  })
})

describe('buildProLooksWhere', () => {
  it('scopes to the pro, excludes client-authored and removed looks', () => {
    expect(
      buildProLooksWhere({
        professionalId: 'pro_1',
        statuses: [LookPostStatus.DRAFT],
      }),
    ).toEqual({
      professionalId: 'pro_1',
      clientAuthorId: null,
      removedAt: null,
      status: { in: [LookPostStatus.DRAFT] },
    })
  })
})

describe('cursor round-trip', () => {
  it('encodes and decodes a cursor losslessly', () => {
    const createdAt = new Date('2026-07-01T12:34:56.000Z')
    const encoded = encodeProLooksCursor({ createdAt, id: 'look_1' })

    expect(decodeProLooksCursor(encoded)).toEqual({
      createdAt,
      id: 'look_1',
    })
  })

  it('rejects garbage, non-record, and malformed payloads', () => {
    expect(decodeProLooksCursor(null)).toBeNull()
    expect(decodeProLooksCursor('')).toBeNull()
    expect(decodeProLooksCursor('not-base64-json')).toBeNull()
    expect(
      decodeProLooksCursor(Buffer.from('"str"', 'utf8').toString('base64url')),
    ).toBeNull()
    expect(
      decodeProLooksCursor(
        Buffer.from(
          JSON.stringify({ createdAt: 'not-a-date', id: 'x' }),
          'utf8',
        ).toString('base64url'),
      ),
    ).toBeNull()
    expect(
      decodeProLooksCursor(
        Buffer.from(
          JSON.stringify({ createdAt: '2026-07-01T00:00:00.000Z', id: '' }),
          'utf8',
        ).toString('base64url'),
      ),
    ).toBeNull()
  })
})

describe('buildProLooksCursorWhere', () => {
  it('builds a keyset predicate matching createdAt desc, id desc', () => {
    const createdAt = new Date('2026-07-01T00:00:00.000Z')

    expect(buildProLooksCursorWhere({ createdAt, id: 'look_9' })).toEqual({
      OR: [
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: 'look_9' } },
      ],
    })
  })
})
