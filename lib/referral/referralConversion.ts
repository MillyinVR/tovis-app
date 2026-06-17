import {
  NotificationEventKey,
  ReferralRewardTier,
  ReferralStatus,
} from '@prisma/client'

import { createClientNotification } from '@/lib/notifications/clientNotifications'
import { prisma } from '@/lib/prisma'

export async function convertReferralOnBooking(args: {
  clientId: string
  bookingId: string
  professionalId: string
}): Promise<void> {
  const referral = await prisma.referral.findFirst({
    where: {
      referredClientId: args.clientId,
      status: ReferralStatus.CONFIRMED,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      referrerClientId: true,
      referredClient: { select: { firstName: true } },
    },
  })

  if (!referral) return

  const proSettings = await prisma.professionalPaymentSettings.findUnique({
    where: { professionalId: args.professionalId },
    select: {
      referralRewardEnabled: true,
      referralRewardTier: true,
      referralDiscountPercent: true,
      referralCreditAmount: true,
    },
  })

  const rewardEnabled = proSettings?.referralRewardEnabled ?? false
  const tier = rewardEnabled
    ? (proSettings?.referralRewardTier ?? ReferralRewardTier.RECOGNITION)
    : ReferralRewardTier.RECOGNITION

  let rewardValue: number | null = null
  if (tier === ReferralRewardTier.DISCOUNT) {
    rewardValue = proSettings?.referralDiscountPercent ?? null
  } else if (tier === ReferralRewardTier.CREDIT) {
    rewardValue = proSettings?.referralCreditAmount
      ? Number(proSettings.referralCreditAmount)
      : null
  }

  const isRecognitionOnly = tier === ReferralRewardTier.RECOGNITION

  await prisma.referral.update({
    where: { id: referral.id },
    data: {
      status: isRecognitionOnly
        ? ReferralStatus.REWARDED
        : ReferralStatus.CONVERTED,
      convertedAt: new Date(),
      triggerBookingId: args.bookingId,
      professionalId: args.professionalId,
      rewardTier: tier,
      rewardValue: rewardValue,
      ...(isRecognitionOnly ? { rewardAppliedAt: new Date() } : {}),
    },
  })

  const referredName = referral.referredClient?.firstName?.trim() || 'Your referral'

  let rewardDesc = ''
  if (tier === ReferralRewardTier.DISCOUNT && rewardValue) {
    rewardDesc = ` You earned ${rewardValue}% off your next booking.`
  } else if (tier === ReferralRewardTier.CREDIT && rewardValue) {
    rewardDesc = ` You earned $${rewardValue} off your next booking.`
  }

  await createClientNotification({
    clientId: referral.referrerClientId,
    eventKey: NotificationEventKey.REFERRAL_CONVERTED,
    title: `${referredName} just booked!`,
    body: `Your referral led to a booking.${rewardDesc}`,
    href: '/client/referrals',
    dedupeKey: `REFERRAL_CONVERTED:${referral.id}`,
  })
}

export async function applyReferralRewardOnBooking(args: {
  clientId: string
  bookingId: string
  professionalId: string
}): Promise<void> {
  const referral = await prisma.referral.findFirst({
    where: {
      referrerClientId: args.clientId,
      professionalId: args.professionalId,
      status: ReferralStatus.CONVERTED,
      rewardTier: { in: [ReferralRewardTier.DISCOUNT, ReferralRewardTier.CREDIT] },
    },
    orderBy: { convertedAt: 'asc' },
    select: {
      id: true,
      rewardTier: true,
      rewardValue: true,
    },
  })

  if (!referral || !referral.rewardValue) return

  const booking = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    select: {
      subtotalSnapshot: true,
      discountAmount: true,
      totalAmount: true,
    },
  })

  if (!booking) return

  const subtotal = Number(booking.subtotalSnapshot)
  const existingDiscount = Number(booking.discountAmount ?? 0)
  let additionalDiscount = 0

  if (referral.rewardTier === ReferralRewardTier.DISCOUNT) {
    additionalDiscount = subtotal * (Number(referral.rewardValue) / 100)
  } else if (referral.rewardTier === ReferralRewardTier.CREDIT) {
    additionalDiscount = Math.min(Number(referral.rewardValue), subtotal - existingDiscount)
  }

  if (additionalDiscount <= 0) return

  const newDiscount = existingDiscount + additionalDiscount
  const newTotal = subtotal - newDiscount

  await prisma.$transaction([
    prisma.booking.update({
      where: { id: args.bookingId },
      data: {
        discountAmount: newDiscount,
        totalAmount: Math.max(newTotal, 0),
      },
    }),
    prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: ReferralStatus.REWARDED,
        rewardAppliedAt: new Date(),
        rewardBookingId: args.bookingId,
      },
    }),
  ])
}
