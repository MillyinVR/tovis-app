// app/api/_utils/email.ts
import { pickString } from './pick'

export function normalizeEmail(v: unknown): string | null {
  const s = pickString(v)
  if (!s) return null

  const email = s.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null

  return email
}
