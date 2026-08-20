// lib/blocks/userBlocks.test.ts
import { describe, expect, it, vi } from 'vitest'

import {
  BLOCKED_USER_IDS_CAP,
  buildLookCommentBlockFilter,
  buildLookPostBlockFilter,
  loadBlockedUserIds,
} from '@/lib/blocks/userBlocks'

function dbReturning(rows: Array<{ blockerUserId: string; blockedUserId: string }>) {
  return {
    userBlock: { findMany: vi.fn().mockResolvedValue(rows) },
  }
}

describe('loadBlockedUserIds', () => {
  it('reads BOTH directions — the people you blocked and the people who blocked you', async () => {
    const db = dbReturning([
      { blockerUserId: 'me', blockedUserId: 'i-blocked-them' },
      { blockerUserId: 'they-blocked-me', blockedUserId: 'me' },
    ])

    const ids = await loadBlockedUserIds(db, { userId: 'me' })

    // Symmetry is the whole point: enforcing one direction only would let the
    // blocked party keep watching and replying to the person who blocked them.
    expect(new Set(ids)).toEqual(new Set(['i-blocked-them', 'they-blocked-me']))
  })

  it('never returns the viewer, who is one end of every row', async () => {
    const db = dbReturning([
      { blockerUserId: 'me', blockedUserId: 'other' },
      { blockerUserId: 'other2', blockedUserId: 'me' },
    ])

    // Leaking the viewer's own id into the exclusion set would filter their own
    // looks and comments out of their own feeds.
    await expect(loadBlockedUserIds(db, { userId: 'me' })).resolves.not.toContain('me')
  })

  it('de-duplicates a mutual block into one id', async () => {
    const db = dbReturning([
      { blockerUserId: 'me', blockedUserId: 'other' },
      { blockerUserId: 'other', blockedUserId: 'me' },
    ])

    await expect(loadBlockedUserIds(db, { userId: 'me' })).resolves.toEqual(['other'])
  })

  it('queries both columns and caps the read', async () => {
    const db = dbReturning([])
    await loadBlockedUserIds(db, { userId: 'me' })

    expect(db.userBlock.findMany).toHaveBeenCalledWith({
      where: { OR: [{ blockerUserId: 'me' }, { blockedUserId: 'me' }] },
      orderBy: { createdAt: 'desc' },
      take: BLOCKED_USER_IDS_CAP,
      select: { blockerUserId: true, blockedUserId: true },
    })
  })
})

describe('buildLookPostBlockFilter', () => {
  it('is null when there is nothing to filter, so an unblocked viewer costs no SQL', () => {
    expect(buildLookPostBlockFilter([])).toBeNull()
  })

  it('excludes a look by EITHER author — the origin pro or the publishing client', () => {
    // A client-authored look carries two people: professionalId stays the
    // ORIGIN pro. Blocking either must remove the look.
    expect(buildLookPostBlockFilter(['blocked'])).toEqual({
      AND: [
        { professional: { is: { userId: { notIn: ['blocked'] } } } },
        {
          OR: [
            { clientAuthorId: null },
            { clientAuthor: { is: { userId: null } } },
            { clientAuthor: { is: { userId: { notIn: ['blocked'] } } } },
          ],
        },
      ],
    })
  })

  it('spells out BOTH null cases on the client-author side', () => {
    // 🔴 REGRESSION GUARD, and it is a measured one. This filter was first
    // written as `NOT { OR [ …userId: { in } ] }`, on the theory that negating
    // a positive match is null-safe. It is not: `ClientProfile.userId` is
    // nullable, the inner condition is NULL for those rows, and `NOT NULL` is
    // NULL — so Postgres dropped them. Against the dev database that silently
    // removed 90 unrelated looks (109 feed-visible → 11). The two OR branches
    // below are what keep an unblockable author's look in the feed; deleting
    // either one reintroduces that bug, and no shape-only assertion catches it.
    const filter = buildLookPostBlockFilter(['blocked'])
    const or = (filter?.AND as Array<{ OR?: unknown[] }>)[1]?.OR ?? []
    expect(or).toContainEqual({ clientAuthorId: null })
    expect(or).toContainEqual({ clientAuthor: { is: { userId: null } } })
  })

  it('returns one self-contained AND key, so it composes into any AND array', () => {
    // A bare top-level `OR` would collide with a caller's own `OR`.
    expect(Object.keys(buildLookPostBlockFilter(['blocked']) ?? {})).toEqual(['AND'])
  })
})

describe('buildLookCommentBlockFilter', () => {
  it('is null when there is nothing to filter', () => {
    expect(buildLookCommentBlockFilter([])).toBeNull()
  })

  it('excludes comments authored by a blocked person', () => {
    // LookComment.userId is non-nullable, so notIn is safe here.
    expect(buildLookCommentBlockFilter(['a', 'b'])).toEqual({
      userId: { notIn: ['a', 'b'] },
    })
  })
})
