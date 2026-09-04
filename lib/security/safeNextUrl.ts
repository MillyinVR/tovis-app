// lib/security/safeNextUrl.ts
import { Prisma } from '@prisma/client'

import { isRecord } from '@/lib/guards'
import { sanitizeInternalPath as sanitizeInternalPathStrict } from '@/lib/security/internalPath'

export function safeNextUrl(v: unknown): string | null {
  return sanitizeInternalPathStrict(v)
}

export function nextUrlFromPayloadJson(payloadJson: Prisma.JsonValue): string | null {
  if (!isRecord(payloadJson)) return null
  return safeNextUrl(payloadJson.nextUrl)
}
