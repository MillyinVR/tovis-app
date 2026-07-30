import { Badge } from '@/app/_components/ui'
import {
  deriveRelationshipBadge,
  type RelationshipBadgeBookingRow,
} from '@/lib/booking/relationshipLabel'

/**
 * NR/NNR/RR/RNR client-relationship mark (K5) — mapped from the per-booking
 * SNAPSHOT column by THE one helper (lib/booking/relationshipLabel.ts), shared
 * by the pro bookings list and the client chart. `significant` gates it so
 * unclassified history (UNKNOWN — imported / pro-created / legacy) renders
 * nothing. The pill prints the mark; the plain-words expansion rides `title`
 * for hover and assistive tech.
 */
export default function RelationshipBadgePill({
  booking,
}: {
  booking: RelationshipBadgeBookingRow
}) {
  const badge = deriveRelationshipBadge(booking)
  if (!badge.significant) return null

  return (
    <span title={badge.description}>
      <Badge tone={badge.tone}>{badge.label}</Badge>
    </span>
  )
}
