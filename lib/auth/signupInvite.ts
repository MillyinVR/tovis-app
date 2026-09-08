import { createHash, randomBytes } from 'node:crypto'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

const CODE_PREFIX = 'TVS'
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const CODE_RANDOM_LENGTH = 20

type SignupInviteDb = {
  signupInvite: Pick<
    Prisma.TransactionClient['signupInvite'],
    'findUnique' | 'findUniqueOrThrow' | 'updateMany'
  >
}

export type SignupInviteFailureReason =
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'used'
  | 'revoked'

export class SignupInviteError extends Error {
  readonly reason: SignupInviteFailureReason

  constructor(reason: SignupInviteFailureReason) {
    super(`Signup invite rejected: ${reason}`)
    this.name = 'SignupInviteError'
    this.reason = reason
  }
}

export function normalizeSignupInviteCode(rawCode: string | null): string {
  return (rawCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function hashNormalizedCode(normalizedCode: string): string {
  return createHash('sha256').update(normalizedCode).digest('hex')
}

function codeHash(rawCode: string | null): string | null {
  const normalized = normalizeSignupInviteCode(rawCode)
  if (!normalized) return null
  return hashNormalizedCode(normalized)
}

export function generateSignupInviteCode(): string {
  const random = randomBytes(CODE_RANDOM_LENGTH)
  const body = Array.from(
    random,
    (byte) => CODE_ALPHABET[byte & 31] ?? CODE_ALPHABET[0],
  ).join('')
  const groups = body.match(/.{1,4}/g) ?? [body]
  return `${CODE_PREFIX}-${groups.join('-')}`
}

export function signupInviteCodeHash(rawCode: string): string {
  const normalized = normalizeSignupInviteCode(rawCode)
  if (!normalized) {
    throw new SignupInviteError('missing')
  }
  return hashNormalizedCode(normalized)
}

export function signupInviteCodeHint(rawCode: string): string {
  const normalized = normalizeSignupInviteCode(rawCode)
  return normalized.slice(-4)
}

const inviteStatusSelect = {
  id: true,
  label: true,
  expiresAt: true,
  usedAt: true,
  revokedAt: true,
} satisfies Prisma.SignupInviteSelect

type SignupInviteStatusRow = Prisma.SignupInviteGetPayload<{
  select: typeof inviteStatusSelect
}>

function failureReasonForRow(
  row: SignupInviteStatusRow | null,
  now: Date,
): SignupInviteFailureReason | null {
  if (!row) return 'invalid'
  if (row.revokedAt) return 'revoked'
  if (row.usedAt) return 'used'
  if (row.expiresAt <= now) return 'expired'
  return null
}

async function loadInviteStatus(args: {
  rawCode: string
  db: SignupInviteDb
}): Promise<SignupInviteStatusRow | null> {
  const hash = codeHash(args.rawCode)
  if (!hash) return null

  return args.db.signupInvite.findUnique({
    where: { codeHash: hash },
    select: inviteStatusSelect,
  })
}

/**
 * Read-only preflight used before expensive signup work and before consuming a
 * social signup ticket. Account creation repeats the decision atomically.
 */
export async function validateSignupInviteCode(args: {
  rawCode: string | null
  now?: Date
}): Promise<{ ok: true } | { ok: false; reason: SignupInviteFailureReason }> {
  if (!normalizeSignupInviteCode(args.rawCode)) {
    return { ok: false, reason: 'missing' }
  }

  const now = args.now ?? new Date()
  const row = await loadInviteStatus({ rawCode: args.rawCode ?? '', db: prisma })
  const reason = failureReasonForRow(row, now)
  return reason ? { ok: false, reason } : { ok: true }
}

/**
 * Atomically spends one invite inside the account-creation transaction. The
 * usedBy relation requires the User row to exist first; any rejection throws
 * and rolls that new User back with the surrounding transaction.
 */
export async function consumeSignupInvite(args: {
  rawCode: string | null
  userId: string
  tx: SignupInviteDb
  now?: Date
}): Promise<{ id: string; label: string }> {
  const hash = codeHash(args.rawCode)
  if (!hash) throw new SignupInviteError('missing')

  const now = args.now ?? new Date()
  const updated = await args.tx.signupInvite.updateMany({
    where: {
      codeHash: hash,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      usedAt: now,
      usedByUserId: args.userId,
    },
  })

  if (updated.count !== 1) {
    const row = await loadInviteStatus({ rawCode: args.rawCode ?? '', db: args.tx })
    throw new SignupInviteError(failureReasonForRow(row, now) ?? 'invalid')
  }

  const invite = await args.tx.signupInvite.findUniqueOrThrow({
    where: { codeHash: hash },
    select: { id: true, label: true },
  })

  return invite
}

export function signupInviteFailureMessage(
  reason: SignupInviteFailureReason,
): string {
  switch (reason) {
    case 'missing':
      return 'An invite code is required while signup is private.'
    case 'expired':
      return 'That invite code has expired. Ask for a new one.'
    case 'used':
      return 'That invite code has already been used. Each code creates one account.'
    case 'revoked':
      return 'That invite code is no longer active. Ask for a new one.'
    case 'invalid':
      return 'That invite code is not valid. Check it and try again.'
  }
}
