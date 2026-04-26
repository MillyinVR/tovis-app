// app/pro/profile/public-profile/_data/proProfileManagementTypes.ts
import type {
  MediaType,
  PaymentCollectionTiming,
  VerificationStatus,
} from '@prisma/client'

import type { LooksPortfolioTileDto } from '@/lib/looks/types'

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
}

export type ProProfileManagementEditProfileInitial = {
  businessName: string | null
  bio: string | null
  location: string | null
  avatarUrl: string | null
  professionType: string | null
  handle: string | null
  isPremium: boolean
}

export type ProProfileManagementTipSuggestion = {
  label: string
  percent: number
}

export type ProProfileManagementPaymentSettingsInitial = {
  collectPaymentAt: PaymentCollectionTiming
  acceptCash: boolean
  acceptCardOnFile: boolean
  acceptTapToPay: boolean
  acceptVenmo: boolean
  acceptZelle: boolean
  acceptAppleCash: boolean
  tipsEnabled: boolean
  allowCustomTip: boolean
  tipSuggestions: ProProfileManagementTipSuggestion[] | null
  venmoHandle: string | null
  zelleHandle: string | null
  appleCashHandle: string | null
  paymentNote: string | null
}

export type ProProfileManagementServiceOption = {
  id: string
  name: string
}

export type ProProfileManagementReviewMedia = {
  id: string
  url: string
  thumbUrl: string | null
  mediaType: MediaType
  isFeaturedInPortfolio: boolean
}

export type ProProfileManagementReview = {
  id: string
  rating: number
  headline: string | null
  body: string | null
  createdAt: string
  clientName: string
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
}

export type ProProfileManagementPortfolio = {
  tiles: LooksPortfolioTileDto[]
  serviceOptions: ProProfileManagementServiceOption[]
  hasLooksEligibleBridge: boolean
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

  portfolio: ProProfileManagementPortfolio
  reviews: ProProfileManagementReviews
}