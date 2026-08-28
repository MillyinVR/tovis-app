// lib/waitlist/offerNotificationCopy.test.ts
import { describe, expect, it } from 'vitest'
import { ServiceLocationType } from '@prisma/client'

import { buildWaitlistOfferNotificationBody } from './offerNotificationCopy'

const BASE = {
  proName: 'Tori',
  when: 'Fri, Sep 4 at 10:00 AM',
  serviceName: 'Balayage',
}

describe('buildWaitlistOfferNotificationBody', () => {
  it('says the pro COMES TO YOU for a mobile offer', () => {
    const body = buildWaitlistOfferNotificationBody({
      ...BASE,
      locationType: ServiceLocationType.MOBILE,
    })

    expect(body).toBe(
      "Tori can come to you Fri, Sep 4 at 10:00 AM for your Balayage. Tap to confirm before it's gone.",
    )
    // The defect this fixes: the in-salon wording invited the client to confirm
    // a home visit while reading a sentence about a slot being "open".
    expect(body).not.toContain('open for your')
  })

  it('leaves the in-salon sentence exactly as it was', () => {
    // Byte-for-byte the original §12 NC1 #25 copy. Nothing about a salon offer
    // changed, and this asserts the literal so a future edit to the mobile half
    // cannot quietly reword the other one.
    expect(
      buildWaitlistOfferNotificationBody({
        ...BASE,
        locationType: ServiceLocationType.SALON,
      }),
    ).toBe(
      "Tori has Fri, Sep 4 at 10:00 AM open for your Balayage. Tap to confirm before it's gone.",
    )
  })

  it('keeps the urgency clause on both modes', () => {
    for (const locationType of [
      ServiceLocationType.SALON,
      ServiceLocationType.MOBILE,
    ]) {
      expect(
        buildWaitlistOfferNotificationBody({ ...BASE, locationType }),
      ).toContain("Tap to confirm before it's gone.")
    }
  })

  it('🔴 never carries an address, on either mode', () => {
    // This body is rendered verbatim onto a PUSH notification — a lock screen.
    // "Comes to you" is what the client needs to decide whether to open it;
    // WHICH address belongs on the offer card, behind the session.
    for (const locationType of [
      ServiceLocationType.SALON,
      ServiceLocationType.MOBILE,
    ]) {
      const body = buildWaitlistOfferNotificationBody({
        ...BASE,
        locationType,
        // A caller cannot smuggle one in: there is no address parameter, and an
        // extra key is both a type error and ignored here.
        ...{ formattedAddress: '77 Orange Ave, Coronado, CA 92118' },
      })

      expect(body).not.toContain('Orange Ave')
      expect(body).not.toContain('Coronado')
    }
  })
})
