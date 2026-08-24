import {
  ClientClaimStatus,
  ContactMethod,
  Prisma,
  ProClientInviteStatus,
} from '@prisma/client'

import {
  createProClientInviteToken,
  hashProClientInviteToken,
  normalizeProClientInviteToken,
} from '@/lib/clients/proClientInviteTokens'
import { asTrimmedString } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { professionalPublicDisplayNameSelect } from '@/lib/privacy/professionalDisplayName'

type DbClient = Prisma.TransactionClient | typeof prisma

type ClientClaimLinkAuditTx = {
  proClientInvite: Pick<
    Prisma.TransactionClient['proClientInvite'],
    'updateMany' | 'findUnique'
  >
}

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim()

  if (!normalized) {
    throw new Error(`clientClaimLinks: ${fieldName} is required.`)
  }

  return normalized
}

function validateClaimChannels(args: {
  invitedEmail: string | null
  invitedPhone: string | null
  preferredContactMethod: ContactMethod | null
}) {
  if (!args.invitedEmail && !args.invitedPhone) {
    throw new Error(
      'clientClaimLinks: invitedEmail or invitedPhone is required.',
    )
  }

  if (
    args.preferredContactMethod === ContactMethod.EMAIL &&
    !args.invitedEmail
  ) {
    throw new Error(
      'clientClaimLinks: invitedEmail is required when preferredContactMethod is EMAIL.',
    )
  }

  if (
    args.preferredContactMethod === ContactMethod.SMS &&
    !args.invitedPhone
  ) {
    throw new Error(
      'clientClaimLinks: invitedPhone is required when preferredContactMethod is SMS.',
    )
  }
}

function isLinkRevoked(
  invite: Pick<ClientClaimLinkRow, 'status' | 'revokedAt'>,
): boolean {
  return (
    invite.status === ProClientInviteStatus.REVOKED || invite.revokedAt != null
  )
}

function isClientAlreadyClaimed(
  invite: Pick<ClientClaimLinkRow, 'client'>,
): boolean {
  return (
    invite.client?.claimStatus === ClientClaimStatus.CLAIMED ||
    invite.client?.userId != null
  )
}

const clientClaimLinkSelect = Prisma.validator<Prisma.ProClientInviteSelect>()({
  id: true,
  token: true,
  tokenHash: true,
  professionalId: true,
  clientId: true,
  bookingId: true,
  invitedName: true,
  invitedEmail: true,
  invitedPhone: true,
  preferredContactMethod: true,
  status: true,
  acceptedAt: true,
  acceptedByUserId: true,
  revokedAt: true,
  revokedByUserId: true,
  revokeReason: true,
  createdAt: true,
  updatedAt: true,
  client: {
    select: {
      id: true,
      userId: true,
      claimStatus: true,
      claimedAt: true,
      preferredContactMethod: true,
    },
  },
  // Top-level pro (nullable) so the claim view can name the professional even
  // when there's no booking to read it from (booking-less invite).
  professional: {
    select: {
      id: true,
      ...professionalPublicDisplayNameSelect,
    },
  },
  booking: {
    select: {
      id: true,
      clientId: true,
      scheduledFor: true,
      locationTimeZone: true,
      service: {
        select: {
          name: true,
        },
      },
      professional: {
        select: {
          id: true,
          businessName: true,
          firstName: true,
          lastName: true,
          handle: true,
          nameDisplay: true,
          location: true,
          timeZone: true,
          user: {
            select: {
              email: true,
            },
          },
        },
      },
      location: {
        select: {
          name: true,
          formattedAddress: true,
          city: true,
          state: true,
          timeZone: true,
        },
      },
    },
  },
} satisfies Prisma.ProClientInviteSelect)

export type ClientClaimLinkRow = Prisma.ProClientInviteGetPayload<{
  select: typeof clientClaimLinkSelect
}>

export type ClientClaimLinkWithRawToken = ClientClaimLinkRow & {
  /**
   * Raw token is only available immediately after creating/rotating an invite,
   * or for legacy rows that still have ProClientInvite.token.
   */
  rawToken: string | null
}

export type UpsertClientClaimLinkArgs = {
  professionalId: string
  clientId: string
  bookingId: string
  invitedName: string
  invitedEmail?: string | null
  invitedPhone?: string | null
  preferredContactMethod?: ContactMethod | null
  tx?: Prisma.TransactionClient
}

export type GetClientClaimLinkByTokenArgs = {
  token: string
  tx?: Prisma.TransactionClient
}

export type ClientClaimLinkPublicState =
  | { kind: 'not_found' }
  | { kind: 'revoked'; link: ClientClaimLinkRow }
  | { kind: 'already_claimed'; link: ClientClaimLinkRow }
  | { kind: 'ready'; link: ClientClaimLinkRow }

export type MarkClientClaimLinkAcceptedAuditArgs = {
  inviteId: string
  actingUserId: string
  acceptedAt: Date
  tx: ClientClaimLinkAuditTx
}

function withRawToken(
  invite: ClientClaimLinkRow,
  rawToken: string | null,
): ClientClaimLinkWithRawToken {
  return {
    ...invite,
    rawToken,
  }
}

function legacyRawTokenFromInvite(invite: ClientClaimLinkRow): string | null {
  return normalizeProClientInviteToken(invite.token)
}

/**
 * Who a claim link is addressed to, and how it should reach them.
 */
export type ClaimLinkContact = {
  invitedName: string
  invitedEmail: string | null
  invitedPhone: string | null
  preferredContactMethod: ContactMethod | null
}

/**
 * Derive the invite contact from a client profile. Shared by both issue*
 * helpers so the booking and booking-less doors cannot drift apart on what they
 * address a link to.
 */
function contactFromClientProfile(client: {
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
}): ClaimLinkContact {
  const invitedName =
    [client.firstName, client.lastName] // pii-plaintext-read-ok: composes required ProClientInvite.invitedName for the claim link
      .map((part) => asTrimmedString(part))
      .filter((part): part is string => Boolean(part))
      .join(' ') || 'Client'
  const invitedEmail = asTrimmedString(client.email) // pii-plaintext-read-ok: seeds invitedEmail for claim-link prefill, mirrors upsertProClient invite flow
  const invitedPhone = asTrimmedString(client.phone) // pii-plaintext-read-ok: seeds invitedPhone for claim-link prefill, mirrors upsertProClient invite flow

  return {
    invitedName,
    invitedEmail,
    invitedPhone,
    preferredContactMethod: invitedEmail
      ? ContactMethod.EMAIL
      : invitedPhone
        ? ContactMethod.SMS
        : null,
  }
}

/**
 * Normalize a caller-supplied contact, applying the same channel rules the
 * pro-driven upsert path enforces — a link nothing can be delivered to is a
 * throw, not a silent mint.
 */
function normalizeSuppliedContact(contact: ClaimLinkContact): ClaimLinkContact {
  const invitedName = normalizeRequiredString(contact.invitedName, 'invitedName')
  const invitedEmail = asTrimmedString(contact.invitedEmail)
  const invitedPhone = asTrimmedString(contact.invitedPhone)
  const preferredContactMethod = contact.preferredContactMethod ?? null

  validateClaimChannels({ invitedEmail, invitedPhone, preferredContactMethod })

  return { invitedName, invitedEmail, invitedPhone, preferredContactMethod }
}

export async function upsertClientClaimLink(
  args: UpsertClientClaimLinkArgs,
): Promise<ClientClaimLinkWithRawToken> {
  const db = getDb(args.tx)

  const professionalId = normalizeRequiredString(
    args.professionalId,
    'professionalId',
  )
  const clientId = normalizeRequiredString(args.clientId, 'clientId')
  const bookingId = normalizeRequiredString(args.bookingId, 'bookingId')
  const invitedName = normalizeRequiredString(args.invitedName, 'invitedName')
  const invitedEmail = asTrimmedString(args.invitedEmail)
  const invitedPhone = asTrimmedString(args.invitedPhone)
  const preferredContactMethod = args.preferredContactMethod ?? null

  validateClaimChannels({
    invitedEmail,
    invitedPhone,
    preferredContactMethod,
  })

  const existing = await db.proClientInvite.findUnique({
    where: { bookingId },
    select: clientClaimLinkSelect,
  })

  if (!existing) {
    const rawToken = createProClientInviteToken()
    const tokenHash = hashProClientInviteToken(rawToken)

    const created = await db.proClientInvite.create({
      data: {
        professionalId,
        clientId,
        bookingId,
        invitedName,
        invitedEmail,
        invitedPhone,
        preferredContactMethod,
        status: ProClientInviteStatus.PENDING,

        /**
         * New rows store only tokenHash. The raw token is returned to the caller
         * once for delivery/link rendering and is not persisted.
         */
        token: null,
        tokenHash,
      },
      select: clientClaimLinkSelect,
    })

    return withRawToken(created, rawToken)
  }

  if (isLinkRevoked(existing)) {
    return withRawToken(existing, null)
  }

  const needsUpdate =
    existing.professionalId !== professionalId ||
    existing.clientId !== clientId ||
    existing.invitedName !== invitedName ||
    existing.invitedEmail !== invitedEmail ||
    existing.invitedPhone !== invitedPhone ||
    existing.preferredContactMethod !== preferredContactMethod

  const needsTokenHashBackfill =
    existing.tokenHash == null && legacyRawTokenFromInvite(existing) != null

  if (!needsUpdate && !needsTokenHashBackfill) {
    return withRawToken(existing, legacyRawTokenFromInvite(existing))
  }

  const legacyRawToken = legacyRawTokenFromInvite(existing)

  const updated = await db.proClientInvite.update({
    where: { id: existing.id },
    data: {
      ...(needsUpdate
        ? {
            professionalId,
            clientId,
            invitedName,
            invitedEmail,
            invitedPhone,
            preferredContactMethod,
          }
        : {}),
      ...(needsTokenHashBackfill && legacyRawToken
        ? {
            tokenHash: hashProClientInviteToken(legacyRawToken),
          }
        : {}),
    },
    select: clientClaimLinkSelect,
  })

  return withRawToken(updated, legacyRawToken)
}

export type IssueClaimLinkForBookingArgs = {
  bookingId: string
  /**
   * Contact this invite is addressed to. Omit to derive it from the client
   * profile (what the public consultation/aftercare doors do). Supply it when
   * the caller took the contact from a request body — the pro-facing invite
   * door does, and a pro may invite a client at an address the profile does not
   * carry yet.
   */
  contact?: ClaimLinkContact | null
  tx?: Prisma.TransactionClient
}

export type IssueClaimLinkForBookingResult =
  | {
      kind: 'ok'
      rawToken: string
      invite: ClientClaimLinkRow
      /**
       * True when this call minted the ProClientInvite row itself; false when it
       * rotated the token on an existing row. A rotation means an earlier link
       * (and very likely an earlier send) existed, so deliveries for it must use
       * a fresh send cycle instead of collapsing into the original send's
       * idempotency key.
       */
      created: boolean
    }
  | { kind: 'not_found' }
  | { kind: 'already_claimed' }
  | { kind: 'revoked' }

/**
 * Mint (or rotate) a claim link for a booking's UNCLAIMED client, returning a
 * fresh raw token usable at /claim/{token}.
 *
 * Unlike upsertClientClaimLink, this ALWAYS regenerates the token hash, so it
 * hands back a working link even when the original emailed claim token is no
 * longer recoverable — and reports `created` so a caller that also delivers the
 * link can open a fresh send cycle for a rotation.
 *
 * Two kinds of caller:
 *   - the public consultation/aftercare pages, which hold a valid
 *     ClientActionToken proving they are the intended recipient and pass no
 *     `contact` (it is derived from the profile, and no contact channel is
 *     required — the link itself is the delivery);
 *   - the pro-facing invite door, which passes the `contact` from its request
 *     body and delivers the link to it.
 *
 * Respects pro revocation: a revoked invite returns { kind: 'revoked' } rather
 * than silently re-opening claim access.
 */
export async function issueClaimLinkForBooking(
  args: IssueClaimLinkForBookingArgs,
): Promise<IssueClaimLinkForBookingResult> {
  const db = getDb(args.tx)
  const bookingId = normalizeRequiredString(args.bookingId, 'bookingId')

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      professionalId: true,
      client: {
        select: {
          id: true,
          userId: true,
          firstName: true, // pii-plaintext-read-ok: builds required ProClientInvite.invitedName for the claim link
          lastName: true, // pii-plaintext-read-ok: builds required ProClientInvite.invitedName for the claim link
          email: true, // pii-plaintext-read-ok: seeds invitedEmail for claim-link prefill, mirrors upsertProClient invite flow
          phone: true, // pii-plaintext-read-ok: seeds invitedPhone for claim-link prefill, mirrors upsertProClient invite flow
          claimStatus: true,
        },
      },
    },
  })

  if (!booking || !booking.client) {
    return { kind: 'not_found' }
  }

  const client = booking.client

  if (client.userId != null || client.claimStatus === ClientClaimStatus.CLAIMED) {
    return { kind: 'already_claimed' }
  }

  const { invitedName, invitedEmail, invitedPhone, preferredContactMethod } =
    args.contact
      ? normalizeSuppliedContact(args.contact)
      : contactFromClientProfile(client)

  const existing = await db.proClientInvite.findUnique({
    where: { bookingId },
    select: clientClaimLinkSelect,
  })

  if (existing && isLinkRevoked(existing)) {
    return { kind: 'revoked' }
  }

  const rawToken = createProClientInviteToken()
  const tokenHash = hashProClientInviteToken(rawToken)

  if (!existing) {
    const created = await db.proClientInvite.create({
      data: {
        professionalId: booking.professionalId,
        clientId: client.id,
        bookingId,
        invitedName,
        invitedEmail,
        invitedPhone,
        preferredContactMethod,
        status: ProClientInviteStatus.PENDING,
        token: null,
        tokenHash,
      },
      select: clientClaimLinkSelect,
    })

    return { kind: 'ok', rawToken, invite: created, created: true }
  }

  const updated = await db.proClientInvite.update({
    where: { id: existing.id },
    data: {
      professionalId: booking.professionalId,
      clientId: client.id,
      invitedName,
      invitedEmail,
      invitedPhone,
      preferredContactMethod,
      status: ProClientInviteStatus.PENDING,
      token: null,
      tokenHash,
    },
    select: clientClaimLinkSelect,
  })

  return { kind: 'ok', rawToken, invite: updated, created: false }
}

export type IssueClaimLinkForClientArgs = {
  clientId: string
  /**
   * The pro attributed to this invite, or null. Cold self-serve passes null
   * (no pro in context); the pro-facing directory invite passes the acting pro.
   */
  professionalId?: string | null
  tx?: Prisma.TransactionClient
}

export type IssueClaimLinkForClientResult =
  | {
      kind: 'ok'
      rawToken: string
      invite: ClientClaimLinkRow
      /** Same semantics as IssueClaimLinkForBookingResult.created. */
      created: boolean
    }
  | { kind: 'not_found' }
  | { kind: 'already_claimed' }
  | { kind: 'revoked' }

/**
 * Mint (or rotate) a BOOKING-LESS claim link for an UNCLAIMED client, returning a
 * fresh raw token usable at /claim/{token}. The sibling of
 * issueClaimLinkForBooking for clients with no appointment (directory-created or
 * migration-imported). invitedName/email/phone are derived from the client
 * profile, exactly as the booking path derives them from booking.client.
 *
 * At most one booking-less invite per client: an existing one is rotated (its
 * token regenerated) rather than duplicated. Respects revocation. A provided
 * professionalId is set; a null one never clobbers an existing attribution.
 */
export async function issueClaimLinkForClient(
  args: IssueClaimLinkForClientArgs,
): Promise<IssueClaimLinkForClientResult> {
  const db = getDb(args.tx)
  const clientId = normalizeRequiredString(args.clientId, 'clientId')
  const professionalId = asTrimmedString(args.professionalId)

  const client = await db.clientProfile.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      userId: true,
      firstName: true, // pii-plaintext-read-ok: composes required ProClientInvite.invitedName for the claim link
      lastName: true, // pii-plaintext-read-ok: composes required ProClientInvite.invitedName for the claim link
      email: true, // pii-plaintext-read-ok: seeds invitedEmail for claim-link prefill, mirrors issueClaimLinkForBooking
      phone: true, // pii-plaintext-read-ok: seeds invitedPhone for claim-link prefill, mirrors issueClaimLinkForBooking
      claimStatus: true,
    },
  })

  if (!client) {
    return { kind: 'not_found' }
  }

  if (client.userId != null || client.claimStatus === ClientClaimStatus.CLAIMED) {
    return { kind: 'already_claimed' }
  }

  const { invitedName, invitedEmail, invitedPhone, preferredContactMethod } =
    contactFromClientProfile(client)

  // One booking-less invite per client — rotate an existing one rather than
  // minting a duplicate. (A booking-BEARING invite for the same client is a
  // distinct row keyed by its bookingId and is left untouched.)
  const existing = await db.proClientInvite.findFirst({
    where: { clientId, bookingId: null },
    select: clientClaimLinkSelect,
  })

  if (existing && isLinkRevoked(existing)) {
    return { kind: 'revoked' }
  }

  const rawToken = createProClientInviteToken()
  const tokenHash = hashProClientInviteToken(rawToken)

  if (!existing) {
    const created = await db.proClientInvite.create({
      data: {
        professionalId,
        clientId,
        bookingId: null,
        invitedName,
        invitedEmail,
        invitedPhone,
        preferredContactMethod,
        status: ProClientInviteStatus.PENDING,
        token: null,
        tokenHash,
      },
      select: clientClaimLinkSelect,
    })

    return { kind: 'ok', rawToken, invite: created, created: true }
  }

  const updated = await db.proClientInvite.update({
    where: { id: existing.id },
    data: {
      // A null professionalId (cold self-serve) never wipes an existing pro
      // attribution from an earlier pro-facing invite.
      professionalId: professionalId ?? existing.professionalId,
      clientId,
      invitedName,
      invitedEmail,
      invitedPhone,
      preferredContactMethod,
      status: ProClientInviteStatus.PENDING,
      token: null,
      tokenHash,
    },
    select: clientClaimLinkSelect,
  })

  return { kind: 'ok', rawToken, invite: updated, created: false }
}

export async function getClientClaimLinkByToken(
  args: GetClientClaimLinkByTokenArgs,
): Promise<ClientClaimLinkRow | null> {
  const db = getDb(args.tx)
  const rawToken = normalizeRequiredString(args.token, 'token')
  const tokenHash = hashProClientInviteToken(rawToken)

  const byHash = await db.proClientInvite.findUnique({
    where: { tokenHash },
    select: clientClaimLinkSelect,
  })

  if (byHash) {
    return byHash
  }

  /**
   * Temporary legacy fallback for rows created before tokenHash existed.
   * Remove this after raw token burn-in is complete and token column is dropped.
   */
  return db.proClientInvite.findUnique({
    where: { token: rawToken },
    select: clientClaimLinkSelect,
  })
}

export async function getClientClaimLinkPublicState(
  args: GetClientClaimLinkByTokenArgs,
): Promise<ClientClaimLinkPublicState> {
  const link = await getClientClaimLinkByToken(args)

  if (!link || !link.client) {
    return { kind: 'not_found' }
  }

  if (isLinkRevoked(link)) {
    return { kind: 'revoked', link }
  }

  if (isClientAlreadyClaimed(link)) {
    return { kind: 'already_claimed', link }
  }

  return { kind: 'ready', link }
}

export async function markClientClaimLinkAcceptedAudit(
  args: MarkClientClaimLinkAcceptedAuditArgs,
): Promise<'ok' | 'revoked' | 'not_found' | 'conflict'> {
  const inviteId = normalizeRequiredString(args.inviteId, 'inviteId')
  const actingUserId = normalizeRequiredString(args.actingUserId, 'actingUserId')

  const updateResult = await args.tx.proClientInvite.updateMany({
    where: {
      id: inviteId,
      revokedAt: null,
    },
    data: {
      status: ProClientInviteStatus.ACCEPTED,
      acceptedAt: args.acceptedAt,
      acceptedByUserId: actingUserId,
    },
  })

  if (updateResult.count === 1) {
    return 'ok'
  }

  const currentInvite = await args.tx.proClientInvite.findUnique({
    where: { id: inviteId },
    select: {
      id: true,
      status: true,
      revokedAt: true,
    },
  })

  if (!currentInvite) {
    return 'not_found'
  }

  if (
    currentInvite.status === ProClientInviteStatus.REVOKED ||
    currentInvite.revokedAt != null
  ) {
    return 'revoked'
  }

  return 'conflict'
}