// lib/proSession/closeoutChecklist.test.ts
import { describe, expect, it } from 'vitest'

import {
  buildProSessionCloseoutChecklist,
  CLOSEOUT_BLOCKED_HELP_TEXT,
  CLOSEOUT_READY_HELP_TEXT,
} from './closeoutChecklist'

describe('buildProSessionCloseoutChecklist', () => {
  it('marks closeout blocked when every requirement is missing', () => {
    const checklist = buildProSessionCloseoutChecklist({
      afterCount: 0,
      hasAfterPhoto: false,
      hasAftercareDraft: false,
      hasFinalizedAftercare: false,
      hasPaymentCollected: false,
      hasCheckoutClosed: false,
      hasConsultationApproved: false,
    })

    expect(checklist.canComplete).toBe(false)
    expect(checklist.helpText).toBe(CLOSEOUT_BLOCKED_HELP_TEXT)

    expect(checklist.items).toEqual([
      {
        key: 'afterPhotos',
        title: 'After photos',
        subtitle: 'Missing',
        done: false,
      },
      {
        key: 'aftercare',
        title: 'Aftercare sent to client',
        subtitle: 'missing',
        done: false,
      },
      {
        key: 'payment',
        title: 'Payment collected',
        subtitle: 'not collected',
        done: false,
      },
      {
        key: 'checkout',
        title: 'Checkout paid or waived',
        subtitle: 'not closed',
        done: false,
      },
      {
        key: 'consultation',
        title: 'Consultation approved',
        subtitle: 'not approved',
        done: false,
      },
    ])
  })

  it('shows draft saved when aftercare exists but has not been sent', () => {
    const checklist = buildProSessionCloseoutChecklist({
      afterCount: 1,
      hasAfterPhoto: true,
      hasAftercareDraft: true,
      hasFinalizedAftercare: false,
      hasPaymentCollected: true,
      hasCheckoutClosed: true,
      hasConsultationApproved: true,
    })

    expect(checklist.canComplete).toBe(false)
    expect(checklist.helpText).toBe(CLOSEOUT_BLOCKED_HELP_TEXT)

    expect(
      checklist.items.find((item) => item.key === 'aftercare'),
    ).toMatchObject({
      subtitle: 'draft saved',
      done: false,
    })
  })

  it('marks closeout ready only when every requirement is satisfied', () => {
    const checklist = buildProSessionCloseoutChecklist({
      afterCount: 3,
      hasAfterPhoto: true,
      hasAftercareDraft: true,
      hasFinalizedAftercare: true,
      hasPaymentCollected: true,
      hasCheckoutClosed: true,
      hasConsultationApproved: true,
    })

    expect(checklist.canComplete).toBe(true)
    expect(checklist.helpText).toBe(CLOSEOUT_READY_HELP_TEXT)

    expect(checklist.items.every((item) => item.done)).toBe(true)

    expect(
      checklist.items.find((item) => item.key === 'afterPhotos'),
    ).toMatchObject({
      subtitle: '3 photos captured',
      done: true,
    })

    expect(
      checklist.items.find((item) => item.key === 'aftercare'),
    ).toMatchObject({
      subtitle: 'finalized + sent',
      done: true,
    })
  })

  it.each([
    ['after photo missing', { hasAfterPhoto: false }],
    ['aftercare not finalized', { hasFinalizedAftercare: false }],
    ['payment not collected', { hasPaymentCollected: false }],
    ['checkout not closed', { hasCheckoutClosed: false }],
    ['consultation not approved', { hasConsultationApproved: false }],
  ])('blocks closeout when %s', (_label, override) => {
    const checklist = buildProSessionCloseoutChecklist({
      afterCount: 1,
      hasAfterPhoto: true,
      hasAftercareDraft: true,
      hasFinalizedAftercare: true,
      hasPaymentCollected: true,
      hasCheckoutClosed: true,
      hasConsultationApproved: true,
      ...override,
    })

    expect(checklist.canComplete).toBe(false)
    expect(checklist.helpText).toBe(CLOSEOUT_BLOCKED_HELP_TEXT)
  })
})