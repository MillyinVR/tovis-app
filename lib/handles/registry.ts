// lib/handles/registry.ts
//
// The single write boundary for the global `@handle` namespace.
//
// WHY THIS EXISTS
// ---------------
// `ProfessionalProfile.handleNormalized` and `ClientProfile.handleNormalized`
// each have their own `@unique`. Unique *within* a table is not unique across
// the app, and the two are displayed identically: the looks feed renders
//   posterName = clientAuthor ? `@${clientAuthor.handle}` : proDisplayName
// so a client-authored post and a pro-authored post sit in one list as the same
// `@handle` with no type marker. A client could claim a well-known pro's handle
// and post under their identity. Both write paths (pro profile PATCH, client
// profile PATCH) relied purely on their own table's index, so neither ever saw
// the other's claim.
//
// Postgres cannot express a unique index spanning two tables. `HandleRegistration`
// is that constraint instead — `handleNormalized` is its PRIMARY KEY — and these
// helpers are the only sanctioned way to touch it.
//
// CALL THESE INSIDE THE SAME TRANSACTION as the profile update. A claim that
// commits while its profile write rolls back would lock a handle onto a profile
// that does not display it.

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

/** Who is claiming. Exactly one owner kind — mirrors the table's CHECK. */
export type HandleOwner =
  | { kind: 'PRO'; professionalId: string }
  | { kind: 'CLIENT'; clientProfileId: string }

/**
 * Any Prisma client that can reach the registry — the singleton or a
 * transaction client. Typed structurally so callers inside `$transaction`
 * don't have to cast.
 */
type RegistryDb = Pick<Prisma.TransactionClient, 'handleRegistration'>

/** The owner columns for a create, and the `where` for finding an owner's row. */
function ownerData(owner: HandleOwner) {
  return owner.kind === 'PRO'
    ? { professionalId: owner.professionalId, clientProfileId: null }
    : { professionalId: null, clientProfileId: owner.clientProfileId }
}

function ownerWhere(owner: HandleOwner) {
  return owner.kind === 'PRO'
    ? { professionalId: owner.professionalId }
    : { clientProfileId: owner.clientProfileId }
}

/**
 * Release whatever handle `owner` currently holds. No-op when it holds none, so
 * this is safe to call unconditionally before a claim or on a handle clear.
 */
export async function releaseHandle(
  db: RegistryDb,
  owner: HandleOwner,
): Promise<void> {
  await db.handleRegistration.deleteMany({ where: ownerWhere(owner) })
}

/**
 * Claim `handleNormalized` for `owner`, dropping the owner's previous handle in
 * the same breath (one handle per owner).
 *
 * Throws Prisma P2002 when another owner already holds it — callers map that to
 * a 409 through their existing `prismaErrorToResponse`, which already says
 * "That handle is taken." Re-claiming a handle the owner already holds is a
 * no-op, so an idempotent save does not 409 against itself.
 *
 * `handleNormalized` must already be normalized + validated by the caller
 * (`normalizeHandle` / `isValidHandle` / `isHandleReserved` in lib/handles.ts).
 * This function is the uniqueness lock, not the format checker.
 */
export async function claimHandle(
  db: RegistryDb,
  handleNormalized: string,
  owner: HandleOwner,
): Promise<void> {
  const existing = await db.handleRegistration.findUnique({
    where: { handleNormalized },
    select: { professionalId: true, clientProfileId: true },
  })

  if (existing) {
    const isSameOwner =
      owner.kind === 'PRO'
        ? existing.professionalId === owner.professionalId
        : existing.clientProfileId === owner.clientProfileId

    // Already ours — nothing to do. Deleting and re-creating would be a
    // pointless write, and would briefly free the handle inside the tx.
    if (isSameOwner) return
  }

  await releaseHandle(db, owner)
  await db.handleRegistration.create({
    data: { handleNormalized, ...ownerData(owner) },
  })
}

/**
 * Whether `handleNormalized` is free for `owner` to take — free outright, or
 * already held by that same owner.
 *
 * ADVISORY ONLY. This is for "is it available?" UI (the pro signup form's live
 * check); it is a read and two callers can pass it at once. The registry's
 * primary key is what actually decides, at write time.
 */
export async function isHandleAvailable(
  handleNormalized: string,
  owner?: HandleOwner,
  db: RegistryDb = prisma,
): Promise<boolean> {
  const existing = await db.handleRegistration.findUnique({
    where: { handleNormalized },
    select: { professionalId: true, clientProfileId: true },
  })

  if (!existing) return true
  if (!owner) return false

  return owner.kind === 'PRO'
    ? existing.professionalId === owner.professionalId
    : existing.clientProfileId === owner.clientProfileId
}

/**
 * Filter `candidates` down to the ones nobody holds. Used by the signup form's
 * suggestion list; same advisory caveat as `isHandleAvailable`.
 */
export async function filterAvailableHandles(
  candidates: string[],
  db: RegistryDb = prisma,
): Promise<string[]> {
  if (candidates.length === 0) return []

  const taken = await db.handleRegistration.findMany({
    where: { handleNormalized: { in: candidates } },
    select: { handleNormalized: true },
  })
  const takenSet = new Set(taken.map((row) => row.handleNormalized))

  return candidates.filter((candidate) => !takenSet.has(candidate))
}
