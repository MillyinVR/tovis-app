// lib/security/contactLookup.ts

import {
  emailLookupHash,
  phoneLookupHash,
} from '@/lib/security/crypto/hashLookup'

export function buildUserContactLookupData(input: {
  email?: string | null
  phone?: string | null
}): {
  emailHash?: string | null
  phoneHash?: string | null
} {
  return {
    emailHash:
      input.email === undefined ? undefined : emailLookupHash(input.email),
    phoneHash:
      input.phone === undefined ? undefined : phoneLookupHash(input.phone),
  }
}

export function buildClientProfileContactLookupData(input: {
  email?: string | null
  phone?: string | null
}): {
  emailHash?: string | null
  phoneHash?: string | null
} {
  return {
    emailHash:
      input.email === undefined ? undefined : emailLookupHash(input.email),
    phoneHash:
      input.phone === undefined ? undefined : phoneLookupHash(input.phone),
  }
}