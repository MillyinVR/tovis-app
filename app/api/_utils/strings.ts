// app/api/_utils/strings.ts

/**
 * Safe string helpers for API routes.
 * Keep this file tiny + dependency-free so it can be reused everywhere.
 */

export function upper(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

export function lower(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}

export function trimOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}
