// lib/security/safeNextUrl.ts
import { Prisma } from '@prisma/client'

import { isRecord } from '@/lib/guards'

export function safeNextUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  return s
}

export function nextUrlFromPayloadJson(payloadJson: Prisma.JsonValue): string | null {
  if (!isRecord(payloadJson)) return null
  return safeNextUrl(payloadJson.nextUrl)
}
