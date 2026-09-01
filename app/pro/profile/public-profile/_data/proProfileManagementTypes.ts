// app/pro/profile/public-profile/_data/proProfileManagementTypes.ts
import type {
  DepositScope,
  DepositType,
  MediaType,
  PaymentCollectionTiming,
  ProNameDisplay,
  VerificationStatus,
} from '@prisma/client'

import type { PairedBeforeDto } from '@/lib/media/pairedBefore'
import type { ProPortfolioPageModel } from '@/app/pro/portfolio/_data/proPortfolioTypes'

/**
 * The pro's own profile is their library, the way it is in every app they
 * already use: one grid under the header, and services / reviews beside it.
 *
 * 🔴 `portfolio` is the DEFAULT. It was briefly a separate screen at
 * `/pro/portfolio` — merged with what used to be "My media" — and nothing in
 * the app linked to it, so the library was unreachable for any pro who didn't
 * already know the URL. It is a tab again, and `/pro/portfolio` redirects here.
 */
export type ProProfileManagementTab = 'portfolio' | 'services' | 'reviews'

export type ProProfileManagementSearchParams = Record<
  string,
  string | string[] | undefined
>

export type ProProfileManagementRoutes = {
  proHome: string
  messages: string
  proMediaNew: string
  proPublicProfile: string
  looks: string
}

export const PRO_PROFILE_MANAGEMENT_ROUTES: ProProfileManagementRoutes = {
  proHome: '/pro/dashboard',
  messages: '/messages',
  proMediaNew: '/pro/media/new',
  proPublicProfile: '/pro/profile/public-profile',
  looks: '/looks',
}

export type ProProfileManagementStatKey =
  | 'rating'
  | 'reviews'
  | 'favorites'
  | 'looks'
  | 'followers'

export type ProProfileManagementStat = {
  key: ProProfileManagementStatKey
  label: string
  value: string
  /**
   * Where the tile leads, when it leads anywhere. `looks` carries the pro's
   * creator analytics — which used to be a "Your Looks performance" row buried
   * in a settings list, and was the ONLY link to `/pro/dashboard` anywhere in
   * the product. Moving it onto the number it describes is why that row could
   * go; dropping the row without this would have orphaned the dashboard the
   * same way the library was orphaned.
   */
  href?: string
}

export type ProProfileManagementEditProfileInitial = {
  businessName: string | null
  bio: string | null
  location: string | null
  avatarUrl: string | null
  professionType: string | null
  handle: string | null
  nameDisplay: ProNameDisplay
  isPremium: boolean
  instagramHandle: string | null
  tiktokHandle: string | null
  websiteUrl: string | null
}

export type ProProfileManagementTipSuggestion = {
  label: string
  percent: number
}

export type ProProfileManagementPaymentSettingsInitial = {
  collectPaymentAt: PaymentCollectionTiming
  depositEnabled: boolean
  depositType: DepositType
  depositFlatAmount: string | null
  depositPercent: number | null
  depositScope: DepositScope
  acceptCash: boolean
  acceptCardOnFile: boolean
  acceptTapToPay: boolean
  acceptVenmo: boolean
  acceptZelle: boolean
  acceptAppleCash: boolean
  acceptPaypal: boolean
  acceptApplePay: boolean
  tipsEnabled: boolean
  allowCustomTip: boolean
  tipSuggestions: ProProfileManagementTipSuggestion[] | null
  venmoHandle: string | null
  zelleHandle: string | null
  appleCashHandle: string | null
  paypalHandle: string | null
  paymentNote: string | null
}

export type ProProfileManagementReviewMedia = {
  id: string
  url: string
  thumbUrl: string | null
  mediaType: MediaType
  isFeaturedInPortfolio: boolean
  before: PairedBeforeDto | null
}

export type ProProfileManagementReview = {
  id: string
  rating: number
  headline: string | null
  body: string | null
  createdAt: string
  clientName: string
  clientHref: string | null
  mediaAssets: ProProfileManagementReviewMedia[]
}

export type ProProfileManagementProfile = {
  id: string
  handle: string | null
  verificationStatus: VerificationStatus
  isApproved: boolean
  isPremium: boolean
  canEditHandle: boolean

  displayName: string
  subtitle: string
  location: string | null
  bio: string | null
  avatarUrl: string | null
  professionType: string | null

  publicUrl: string
  livePublicUrl: string | null

  // Vanity (name.tovis.me) link surface.
  vanityHost: string | null // e.g. "tori.tovis.me" (null until a handle is set)
  vanityUrl: string | null // e.g. "https://tori.tovis.me"
  vanityQrSvg: string | null // inline SVG QR, present only when the link is live
}

export type ProProfileManagementReviews = {
  items: ProProfileManagementReview[]
  reviewCount: number
  averageRatingLabel: string | null
}

export type ProProfileManagementPageModel = {
  brandDisplayName: string
  routes: ProProfileManagementRoutes
  tab: ProProfileManagementTab

  profile: ProProfileManagementProfile
  stats: ProProfileManagementStat[]
  unreadNotificationCount: number

  editProfileInitial: ProProfileManagementEditProfileInitial
  paymentSettingsInitial: ProProfileManagementPaymentSettingsInitial | null
  /**
   * Phase 2 revenue protection flag (server-side `noShowProtectionEnabled()`).
   * Gates the "No-show & late-cancel fees" section in the payment settings modal.
   */
  noShowFeatureEnabled: boolean

  /**
   * The library, present only while the portfolio tab is the active one — it is
   * several queries deep, and the services/reviews tabs must not pay for it.
   */
  portfolio: ProPortfolioPageModel | null

  reviews: ProProfileManagementReviews
}