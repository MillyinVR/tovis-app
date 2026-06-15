// lib/clientActions/idempotency.ts

import { sha256Hex } from '@/lib/auth/timingSafe'
import { asTrimmedString } from '@/lib/guards'
import {
  normalizeEmailForLookup,
  normalizePhoneForLookup,
} from '@/lib/security/contactNormalization'

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

function slugifyActionType(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

function serializeStableParts(parts: ReadonlyArray<string>): string {
  return parts.join('|')
}

function listNormalizedEntityRefParts(refs: ClientActionEntityRefs): string[] {
  return ENTITY_REF_ORDER.flatMap((key) => {
    const value = asTrimmedString(refs[key] ?? null)
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
  const clientId = asTrimmedString(args.clientId)
  const professionalId = asTrimmedString(args.professionalId)
  const recipientEmail = normalizeEmailForLookup(args.recipientEmail)
  const recipientPhone = normalizePhoneForLookup(args.recipientPhone)

  const serialized = serializeStableParts([
    `clientId:${clientId ?? 'null'}`,
    `professionalId:${professionalId ?? 'null'}`,
    `email:${recipientEmail ?? 'null'}`,
    `phone:${recipientPhone ?? 'null'}`,
  ])

  return sha256Hex(serialized)
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

  return `client-action:${slugifyActionType(args.actionType)}:${sha256Hex(
    serialized,
  )}`
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

  const sendVersion = asTrimmedString(args.sendVersion)
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

  return `${baseKey}:send:${sha256Hex(sendCycle)}`
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