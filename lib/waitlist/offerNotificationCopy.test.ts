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
  it('says the pro COMES TO YOU, and WHICH of your addresses', () => {
    const body = buildWaitlistOfferNotificationBody({
      ...BASE,
      locationType: ServiceLocationType.MOBILE,
      addressLabel: 'Home',
    })

    expect(body).toBe(
      "Tori can come to you at Home on Fri, Sep 4 at 10:00 AM for your Balayage. Tap to confirm before it's gone.",
    )
    // The defect this fixes: the in-salon wording invited the client to confirm
    // a home visit while reading a sentence about a slot being "open".
    expect(body).not.toContain('open for your')
  })

  it('omits the address when the client never named it', () => {
    // Rather than guessing a word for it. The sentence still reads.
    expect(
      buildWaitlistOfferNotificationBody({
        ...BASE,
        locationType: ServiceLocationType.MOBILE,
        addressLabel: null,
      }),
    ).toBe(
      "Tori can come to you on Fri, Sep 4 at 10:00 AM for your Balayage. Tap to confirm before it's gone.",
    )
  })

  it('reads naturally for a label that is not "Home"', () => {
    // A client's label is free text — "Mum's", "Office", "the studio". The
    // sentence must not assume a possessive or a proper noun.
    expect(
      buildWaitlistOfferNotificationBody({
        ...BASE,
        locationType: ServiceLocationType.MOBILE,
        addressLabel: "Mum's",
      }),
    ).toContain("can come to you at Mum's on Fri, Sep 4 at 10:00 AM")
  })

  it('DROPS an oversized label rather than truncating it mid-word', () => {
    // A label has no length limit in the schema. Truncating would render a
    // half-word and push the urgency clause out of a push preview; dropping it
    // falls back to a sentence that is still correct, just less specific.
    const body = buildWaitlistOfferNotificationBody({
      ...BASE,
      locationType: ServiceLocationType.MOBILE,
      addressLabel: 'x'.repeat(41),
    })

    expect(body).not.toContain('xxx')
    expect(body).toBe(
      "Tori can come to you on Fri, Sep 4 at 10:00 AM for your Balayage. Tap to confirm before it's gone.",
    )
  })

  it('ignores a whitespace-only label', () => {
    expect(
      buildWaitlistOfferNotificationBody({
        ...BASE,
        locationType: ServiceLocationType.MOBILE,
        addressLabel: '   ',
      }),
    ).not.toContain('at  ')
  })

  it('never names an address on a SALON offer, even if a label is passed', () => {
    // The client is going to the pro; their own address label has nothing to do
    // with this appointment.
    expect(
      buildWaitlistOfferNotificationBody({
        ...BASE,
        locationType: ServiceLocationType.SALON,
        addressLabel: 'Home',
      }),
    ).not.toContain('Home')
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

  it('🔴 never carries a STREET address, on either mode', () => {
    // This body is rendered verbatim onto a PUSH notification — a lock screen,
    // read by whoever is holding the phone. The client's own LABEL for the
    // place is fine there and answers "which of my addresses"; the street line
    // is not, and stays on the offer card behind the session.
    for (const locationType of [
      ServiceLocationType.SALON,
      ServiceLocationType.MOBILE,
    ]) {
      const body = buildWaitlistOfferNotificationBody({
        ...BASE,
        locationType,
        // The LABEL is welcome — it names which saved address, and discloses
        // nothing about where it is. The street line is not: there is no
        // parameter for it, and an extra key is both a type error and ignored.
        addressLabel: 'Home',
        ...{ formattedAddress: '77 Orange Ave, Coronado, CA 92118' },
      })

      expect(body).not.toContain('Orange Ave')
      expect(body).not.toContain('Coronado')
      expect(body).not.toContain('92118')
    }
  })
})
