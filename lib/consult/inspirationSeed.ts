import 'server-only'

import {
  ConsultActorType,
  ConsultAuditAction,
  ConsultInspirationSource,
  ConsultInspirationStatus,
  Prisma,
  Role,
} from '@prisma/client'
import { createHash } from 'node:crypto'

import { buildLookPolicyInput, loadLookAccess } from '@/lib/looks/access'
import { canViewLookPost } from '@/lib/looks/guards'

/**
 * Seeding a look-anchored consult's inspiration pack from the Look itself.
 *
 * The point of Book the Look: a client who taps "book this look" has ALREADY
 * shown us the picture. Making her pick a source — or re-upload the very image
 * she tapped — is the step the inversion exists to delete
 * (docs/product/BOOK-THE-LOOK-DIRECTION.md, B2).
 *
 * 🔴 It REFERENCES the Look; it never copies bytes. A `PLATFORM_LOOK` /
 * `BOOKED_PRO_LOOK` inspiration row carries `sourceLookPostId` and nothing
 * else — no bucket, no path, no expiry — which is the same shape the client's
 * own "choose an existing Look" path has always written, and the shape
 * `ConsultInspiration_shape` (20260913000001) enforces. That is what keeps the
 * two lifecycles apart: `runConsultInspirationPurgeSweep` and
 * `purgeConsultInspirationObject` both filter on
 * `source = EXTERNAL_UPLOAD`, so purging a look-anchored consult can never
 * touch — or orphan — the Look's media. A purged client upload and a
 * referenced public Look are different things and stay different things.
 *
 * WHEN it runs is load-bearing too. The seed happens at the MEDIA_READY
 * transition, not at creation, because the database's `consult_inspiration_guard`
 * requires a MEDIA_READY session with both legal prerequisites active before
 * any inspiration row exists. Seeding at creation would have meant relaxing
 * that rule to write consult content before consent — a worse trade than
 * seeding one step later, where the client would have been asked to choose a
 * source anyway.
 */

const SEED_IDEMPOTENCY_PREFIX = 'look-anchor:'

function seedIdempotencyKey(lookPostId: string): string {
  return `${SEED_IDEMPOTENCY_PREFIX}${lookPostId}`.slice(0, 128)
}

function seedRequestHash(args: {
  source: ConsultInspirationSource
  lookPostId: string
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        seed: 'consult-look-anchor',
        source: args.source,
        lookPostId: args.lookPostId,
      }),
    )
    .digest('hex')
}

/**
 * Which `ConsultInspirationSource` the anchoring Look is, from the same rule
 * the client-chosen path uses: the pro's own, pro-authored Look is a
 * `BOOKED_PRO_LOOK`; anything else she can legitimately see is a
 * `PLATFORM_LOOK`. Returns null when the Look is not currently viewable by
 * BOTH participants, which is the seed's only refusal — the client simply
 * lands on the ordinary source-choice step instead.
 */
async function resolveAnchorLookSource(
  tx: Prisma.TransactionClient,
  args: { lookPostId: string; clientId: string; professionalId: string },
): Promise<ConsultInspirationSource | null> {
  const [clientAccess, professionalAccess] = await Promise.all([
    loadLookAccess(tx, {
      lookPostId: args.lookPostId,
      viewerClientId: args.clientId,
    }),
    loadLookAccess(tx, {
      lookPostId: args.lookPostId,
      viewerProfessionalId: args.professionalId,
    }),
  ])
  if (!clientAccess || !professionalAccess) return null
  if (
    !canViewLookPost(buildLookPolicyInput(clientAccess, Role.CLIENT)) ||
    !canViewLookPost(buildLookPolicyInput(professionalAccess, Role.PRO))
  ) {
    return null
  }
  return clientAccess.look.professionalId === args.professionalId &&
    clientAccess.look.clientAuthorId === null
    ? ConsultInspirationSource.BOOKED_PRO_LOOK
    : ConsultInspirationSource.PLATFORM_LOOK
}

/**
 * Attaches the anchoring Look as this consult's inspiration source. The caller
 * owns the ConsultSession row lock and the transaction, and must call this only
 * once the session is already MEDIA_READY.
 *
 * Returns the created row's id, or null when nothing was seeded: no look
 * anchor, a source already chosen, or a Look that is no longer visible to both
 * participants. Every one of those leaves the client on the normal
 * choose-a-source step rather than in a dead end.
 */
export async function seedLockedConsultAnchorInspiration(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    clientId: string
    professionalId: string
    anchorLookPostId: string | null
    actor: { type: typeof ConsultActorType.CLIENT; id: string }
  },
): Promise<string | null> {
  if (!args.anchorLookPostId) return null

  // Two reasons not to seed, and both must be checked. An ACTIVE source means
  // the client already has one (hers wins over ours). A row carrying this
  // seed's idempotency key in ANY status means we already seeded once and she
  // replaced or removed it — re-seeding would both overrule her and collide
  // with the (consultSessionId, sourceIdempotencyKey) unique index. That
  // second case is reachable: revoking consent and re-consenting walks the
  // session back through INTAKE_IN_PROGRESS to MEDIA_READY a second time.
  const existing = await tx.consultInspiration.findFirst({
    where: {
      consultSessionId: args.consultSessionId,
      OR: [
        {
          status: {
            in: [
              ConsultInspirationStatus.UPLOAD_PENDING,
              ConsultInspirationStatus.ATTACHED,
            ],
          },
        },
        { sourceIdempotencyKey: seedIdempotencyKey(args.anchorLookPostId) },
      ],
    },
    select: { id: true },
  })
  if (existing) return null

  const source = await resolveAnchorLookSource(tx, {
    lookPostId: args.anchorLookPostId,
    clientId: args.clientId,
    professionalId: args.professionalId,
  })
  if (!source) return null

  const created = await tx.consultInspiration.create({
    data: {
      consultSessionId: args.consultSessionId,
      source,
      status: ConsultInspirationStatus.ATTACHED,
      sourceLookPostId: args.anchorLookPostId,
      sourceIdempotencyKey: seedIdempotencyKey(args.anchorLookPostId),
      sourceRequestHash: seedRequestHash({
        source,
        lookPostId: args.anchorLookPostId,
      }),
    },
    select: { id: true },
  })
  await tx.consultAuditEvent.create({
    data: {
      consultSessionId: args.consultSessionId,
      action: ConsultAuditAction.INSPIRATION_SOURCE_SELECTED,
      actorType: args.actor.type,
      actorId: args.actor.id,
      inspirationId: created.id,
    },
  })
  return created.id
}
