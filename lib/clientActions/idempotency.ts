// lib/clientActions/idempotency.ts

import crypto from 'crypto'

import type {
  ClientActionEntityRefs,
  ClientActionIdempotencyInput,
  ClientActionIdempotencyKeys,
} from './types'

type ClientActionIdempotencyArgs = ClientActionIdempotencyInput & {
  /**
   * Optional explicit send-cycle discriminator.
   *
   * Use this for intentional resends so each resend can create a fresh
   * delivery identity instead of collapsing into the same sendKey.
   *
   * Good examples later:
   * - notification row updatedAt timestamp
   * - token issuance id
   * - manual resend audit id
   * - route-level resend sequence/version
   */
  sendVersion?: string | null
}

const ENTITY_REF_ORDER = [
  'inviteId',
  'aftercareId',
  'consultationApprovalId',
  'bookingId',
  'clientId',
  'professionalId',
] as const satisfies readonly (keyof ClientActionEntityRefs)[]

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value)
  return normalized ? normalized.toLowerCase() : null
}

function normalizePhone(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return null

  /**
   * Keep leading "+" if present, but otherwise normalize formatting noise.
   * This is only for fingerprinting/idempotency, not E.164 validation.
   */
  const hasLeadingPlus = normalized.startsWith('+')
  const digitsOnly = normalized.replace(/[^\d]/g, '')

  if (!digitsOnly) return null
  return hasLeadingPlus ? `+${digitsOnly}` : digitsOnly
}

function slugifyActionType(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

function serializeStableParts(parts: ReadonlyArray<string>): string {
  return parts.join('|')
}

function listNormalizedEntityRefParts(refs: ClientActionEntityRefs): string[] {
  return ENTITY_REF_ORDER.flatMap((key) => {
    const value = normalizeOptionalString(refs[key] ?? null)
    return value ? [`${key}:${value}`] : []
  })
}

function assertHasIdempotencyAnchor(refs: ClientActionEntityRefs): void {
  const refParts = listNormalizedEntityRefParts(refs)

  if (refParts.length === 0) {
    throw new Error(
      'clientActions/idempotency: at least one entity reference is required to build idempotency keys.',
    )
  }
}

export function buildClientActionRecipientFingerprint(
  args: ClientActionIdempotencyInput['recipient'],
): string {
  const clientId = normalizeOptionalString(args.clientId)
  const professionalId = normalizeOptionalString(args.professionalId)
  const recipientEmail = normalizeEmail(args.recipientEmail)
  const recipientPhone = normalizePhone(args.recipientPhone)

  const serialized = serializeStableParts([
    `clientId:${clientId ?? 'null'}`,
    `professionalId:${professionalId ?? 'null'}`,
    `email:${recipientEmail ?? 'null'}`,
    `phone:${recipientPhone ?? 'null'}`,
  ])

  return sha256(serialized)
}

export function buildClientActionBaseKey(
  args: ClientActionIdempotencyInput,
): string {
  assertHasIdempotencyAnchor(args.refs)

  const entityParts = listNormalizedEntityRefParts(args.refs)
  const recipientFingerprint = buildClientActionRecipientFingerprint(
    args.recipient,
  )

  const serialized = serializeStableParts([
    `actionType:${args.actionType}`,
    ...entityParts,
    `recipient:${recipientFingerprint}`,
  ])

  return `client-action:${slugifyActionType(args.actionType)}:${sha256(serialized)}`
}

function resolveSendCycleDiscriminator(
  args: ClientActionIdempotencyArgs,
): string {
  /**
   * Retrying the same delivery attempt should resolve to the same send cycle.
   * Intentional resend should resolve to a different send cycle.
   */
  if (args.resendMode === 'INITIAL_SEND' || args.resendMode === 'RETRY') {
    return 'initial'
  }

  const sendVersion = normalizeOptionalString(args.sendVersion)
  if (sendVersion) {
    return `resend:${sendVersion}`
  }

  /**
   * Fallback keeps the API usable before every caller has a resend version,
   * but callers should pass sendVersion for real resend support.
   */
  return 'resend:default'
}

export function buildClientActionSendKey(
  args: ClientActionIdempotencyArgs,
): string {
  const baseKey = buildClientActionBaseKey(args)
  const sendCycle = resolveSendCycleDiscriminator(args)

  return `${baseKey}:send:${sha256(sendCycle)}`
}

export function buildClientActionIdempotencyKeys(
  args: ClientActionIdempotencyArgs,
): ClientActionIdempotencyKeys {
  const baseKey = buildClientActionBaseKey(args)
  const sendKey = buildClientActionSendKey(args)

  return {
    baseKey,
    sendKey,
  }
}

export function listClientActionIdempotencyAnchors(
  refs: ClientActionEntityRefs,
): string[] {
  return listNormalizedEntityRefParts(refs)
}