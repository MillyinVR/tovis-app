// lib/clients/clientNoteKinds.test.ts
import { describe, expect, it } from 'vitest'
import { ClientNoteKind, ClientNoteVisibility } from '@prisma/client'

import {
  AUTHORABLE_NOTE_KINDS,
  isClientNoteKind,
  normalizeAuthorableNoteKind,
  partitionNotesByKind,
  visibilityForNoteKind,
} from './clientNoteKinds'

describe('visibilityForNoteKind', () => {
  it('forces DO_NOT_REBOOK author-scoped', () => {
    expect(visibilityForNoteKind(ClientNoteKind.DO_NOT_REBOOK)).toBe(
      ClientNoteVisibility.PRIVATE_TO_AUTHOR,
    )
  })

  it('keeps every other kind shared with pros', () => {
    for (const kind of AUTHORABLE_NOTE_KINDS) {
      expect(visibilityForNoteKind(kind)).toBe(
        ClientNoteVisibility.PROFESSIONALS_ONLY,
      )
    }
  })
})

describe('normalizeAuthorableNoteKind', () => {
  it('accepts the authorable kinds (case-insensitive)', () => {
    expect(normalizeAuthorableNoteKind('consultation')).toBe(
      ClientNoteKind.CONSULTATION,
    )
    expect(normalizeAuthorableNoteKind('COMMUNICATION_STYLE')).toBe(
      ClientNoteKind.COMMUNICATION_STYLE,
    )
  })

  it('refuses to author DO_NOT_REBOOK through the general path', () => {
    expect(normalizeAuthorableNoteKind('DO_NOT_REBOOK')).toBe(
      ClientNoteKind.GENERAL,
    )
  })

  it('falls back to GENERAL for unknown/empty input', () => {
    expect(normalizeAuthorableNoteKind('')).toBe(ClientNoteKind.GENERAL)
    expect(normalizeAuthorableNoteKind('nonsense')).toBe(ClientNoteKind.GENERAL)
    expect(normalizeAuthorableNoteKind(undefined)).toBe(ClientNoteKind.GENERAL)
  })
})

describe('isClientNoteKind', () => {
  it('guards valid kinds and rejects junk', () => {
    expect(isClientNoteKind('GENERAL')).toBe(true)
    expect(isClientNoteKind('DO_NOT_REBOOK')).toBe(true)
    expect(isClientNoteKind('toString')).toBe(false)
    expect(isClientNoteKind(7)).toBe(false)
  })
})

describe('partitionNotesByKind', () => {
  const notes = [
    { id: 'a', kind: ClientNoteKind.GENERAL },
    { id: 'b', kind: ClientNoteKind.CONSULTATION },
    { id: 'c', kind: ClientNoteKind.DO_NOT_REBOOK },
    { id: 'd', kind: ClientNoteKind.GENERAL },
  ]

  it('separates DO_NOT_REBOOK from the grouped sections', () => {
    const { groups, doNotRebook } = partitionNotesByKind(notes)
    expect(doNotRebook.map((n) => n.id)).toEqual(['c'])
    // No grouped section ever contains a DO_NOT_REBOOK note.
    expect(
      groups.every((g) => g.kind !== ClientNoteKind.DO_NOT_REBOOK),
    ).toBe(true)
  })

  it('drops empty groups and preserves display order', () => {
    const { groups } = partitionNotesByKind(notes)
    expect(groups.map((g) => g.kind)).toEqual([
      ClientNoteKind.GENERAL,
      ClientNoteKind.CONSULTATION,
    ])
    expect(groups[0]?.notes.map((n) => n.id)).toEqual(['a', 'd'])
  })

  it('returns no groups for an empty list', () => {
    const { groups, doNotRebook } = partitionNotesByKind([])
    expect(groups).toEqual([])
    expect(doNotRebook).toEqual([])
  })
})
