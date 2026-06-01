// lib/security/contactLookup.ts
import { normalizePhoneForVerification } from '@/lib/security/contactNormalization'
import {
  emailLookupHashV2,
  phoneLookupHashV2,
  type ContactLookupHashV2,
} from '@/lib/security/crypto/hashLookup'

export type UserContactLookupWriteData = {
  emailHash?: string | null
  emailHashV2?: string | null
  emailHashKeyVersion?: number | null
  phoneHash?: string | null
  phoneHashV2?: string | null
  phoneHashKeyVersion?: number | null
}

export type ClientProfileContactLookupWriteData = {
  emailHash?: string | null
  emailHashV2?: string | null
  emailHashKeyVersion?: number | null
  phoneHash?: string | null
  phoneHashV2?: string | null
  phoneHashKeyVersion?: number | null
}

type BuildContactLookupDataInput = {
  email?: unknown
  phone?: unknown
}

/**
 * Builds contact lookup write data.
 *
 * Contract:
 * - omitted field / `undefined` means leave existing DB value unchanged
 * - provided valid value means clear legacy SHA-256 hash and write HMAC v2 hash
 * - provided invalid/null/empty value means clear legacy + v2 hash fields
 */
function buildContactLookupData(
  input: BuildContactLookupDataInput,
): UserContactLookupWriteData {
  const data: UserContactLookupWriteData = {}

  if (input.email !== undefined) {
    Object.assign(data, buildEmailLookupWriteData(input.email))
  }

  if (input.phone !== undefined) {
    Object.assign(data, buildPhoneLookupWriteData(input.phone))
  }

  return data
}

export function buildUserContactLookupData(
  input: BuildContactLookupDataInput,
): UserContactLookupWriteData {
  return buildContactLookupData(input)
}

export function buildClientProfileContactLookupData(
  input: BuildContactLookupDataInput,
): ClientProfileContactLookupWriteData {
  return buildContactLookupData(input)
}

export function buildEmailLookupHashV2ForContactInput(
  value: unknown,
): ContactLookupHashV2 | null {
  return emailLookupHashV2(value)
}

export function buildPhoneLookupHashV2ForContactInput(
  value: unknown,
): ContactLookupHashV2 | null {
  return phoneLookupHashV2(value)
}

/**
 * Verification flows historically expect an empty string for invalid/missing
 * phone values. Keep that behavior here so callers do not reimplement phone
 * normalization locally.
 */
export function buildVerificationPhoneLookupValue(value: unknown): string {
  return normalizePhoneForVerification(value) ?? ''
}

function buildEmailLookupWriteData(value: unknown): Pick<
  UserContactLookupWriteData,
  'emailHash' | 'emailHashV2' | 'emailHashKeyVersion'
> {
  const hmacHash = emailLookupHashV2(value)

  return {
    emailHash: null,
    emailHashV2: hmacHash?.hash ?? null,
    emailHashKeyVersion: hmacHash?.keyVersion ?? null,
  }
}

function buildPhoneLookupWriteData(value: unknown): Pick<
  UserContactLookupWriteData,
  'phoneHash' | 'phoneHashV2' | 'phoneHashKeyVersion'
> {
  const hmacHash = phoneLookupHashV2(value)

  return {
    phoneHash: null,
    phoneHashV2: hmacHash?.hash ?? null,
    phoneHashKeyVersion: hmacHash?.keyVersion ?? null,
  }
}