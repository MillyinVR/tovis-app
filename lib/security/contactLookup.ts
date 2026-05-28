// lib/security/contactLookup.ts

import {
  emailLookupHash,
  emailLookupHashV2,
  phoneLookupHash,
  phoneLookupHashV2,
} from '@/lib/security/crypto/hashLookup'
import { normalizePhoneForVerification } from '@/lib/security/contactNormalization'

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

function buildContactLookupData(
  input: BuildContactLookupDataInput,
): UserContactLookupWriteData {
  const data: UserContactLookupWriteData = {}

  if (input.email !== undefined) {
    const legacyEmailHash = emailLookupHash(input.email)
    const emailHashV2 = emailLookupHashV2(input.email)

    data.emailHash = legacyEmailHash
    data.emailHashV2 = emailHashV2?.hash ?? null
    data.emailHashKeyVersion = emailHashV2?.keyVersion ?? null
  }

  if (input.phone !== undefined) {
    const legacyPhoneHash = phoneLookupHash(input.phone)
    const phoneHashV2 = phoneLookupHashV2(input.phone)

    data.phoneHash = legacyPhoneHash
    data.phoneHashV2 = phoneHashV2?.hash ?? null
    data.phoneHashKeyVersion = phoneHashV2?.keyVersion ?? null
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
): ReturnType<typeof emailLookupHashV2> {
  return emailLookupHashV2(value)
}

export function buildPhoneLookupHashV2ForContactInput(
  value: unknown,
): ReturnType<typeof phoneLookupHashV2> {
  return phoneLookupHashV2(value)
}

export function buildVerificationPhoneLookupValue(value: unknown): string {
  return normalizePhoneForVerification(value) ?? ''
}