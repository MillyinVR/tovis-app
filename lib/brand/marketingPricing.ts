import {
  CLIENT_CONVENIENCE_FEE_PERCENT,
  CLIENT_CONVENIENCE_FEE_MIN_CENTS,
  CLIENT_CONVENIENCE_FEE_MAX_CENTS,
  PRO_DISCOVERY_FEE_CENTS,
} from '@/lib/booking/discoveryFee'

/** Shared public fee explanation; the server supplies the charging switch. */
export function marketingPricing(feesEnabled: boolean) {
  return {
    title: 'Clear costs. Before you book.',
    commission:
      '0% commission on service revenue. Standard card processing is separate.',
    subscription:
      '$0 for the essential booking tools. Optional paid memberships add business features.',
    professional: feesEnabled
      ? `A one-time professional discovery fee of up to $${PRO_DISCOVERY_FEE_CENTS / 100} applies to qualifying first-time discovery bookings with a deposit. It is capped at the deposit and may be waived by an eligible membership.`
      : 'Professional discovery fees are not currently being charged.',
    client: feesEnabled
      ? `On qualifying first-time discovery bookings with a deposit, the client pays ${CLIENT_CONVENIENCE_FEE_PERCENT}% of the deposit, with a $${CLIENT_CONVENIENCE_FEE_MIN_CENTS / 100} minimum and $${CLIENT_CONVENIENCE_FEE_MAX_CENTS / 100} maximum, in addition to the deposit.`
      : 'Client discovery fees are not currently being charged. The appointment price and any professional-required deposit still apply.',
    scope:
      'Discovery fees concern new matches made through the Looks feed or Discovery. Returning relationships and qualifying direct bookings are exempt. A refunded discovery booking can become eligible again. Review the amounts shown before confirming.',
    processing:
      'Standard card processing applies to card payments. Check the payment terms for your account and payment method.',
    payout:
      'Card payments use the professional’s connected Stripe account. Processing and payout timing follow the applicable payment terms.',
    link: 'How the money works',
  }
}
export type MarketingPricing = ReturnType<typeof marketingPricing>
