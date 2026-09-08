import { isRecord } from '@/lib/guards'

/** Only version-pinned look proposals carry resolved times, not typed guesses. */
export function lookProposalDurationMinutes(raw: unknown): number | null {
  if (!isRecord(raw) || typeof raw.lookBriefVersionId !== 'string' || !raw.lookBriefVersionId ||
    !Array.isArray(raw.items) || !raw.items.length) return null
  let total = 0
  for (const item of raw.items) {
    if (!isRecord(item) || typeof item.durationMinutes !== 'number' ||
      !Number.isSafeInteger(item.durationMinutes) || item.durationMinutes <= 0) return null
    total += item.durationMinutes
  }
  return Number.isSafeInteger(total) ? total : null
}
