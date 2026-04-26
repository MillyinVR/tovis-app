// app/pro/profile/public-profile/page.test.tsx
import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PaymentCollectionTiming, VerificationStatus } from '@prisma/client'

import type { ProProfileManagementPageModel } from './_data/proProfileManagementTypes'

const mockLoadProProfileManagementPage = vi.hoisted(() => vi.fn())

vi.mock('./_data/loadProProfileManagementPage', () => ({
  loadProProfileManagementPage: mockLoadProProfileManagementPage,
}))

vi.mock('./_components/ProProfileManagementShell', () => ({
  default: ({ model }: { model: ProProfileManagementPageModel }) => (
    <div
      data-testid="pro-profile-management-shell"
      data-tab={model.tab}
      data-profile-id={model.profile.id}
      data-display-name={model.profile.displayName}
      data-approved={String(model.profile.isApproved)}
    >
      ProProfileManagementShell
    </div>
  ),
}))

import ProPublicProfilePage from './page'

type TestSearchParams = Record<string, string | string[] | undefined>

function makeModel(
  patch?: Partial<ProProfileManagementPageModel>,
): ProProfileManagementPageModel {
  return {
    brandDisplayName: 'TOVIS',
    routes: {
      proHome: '/pro/dashboard',
      messages: '/messages',
      proMediaNew: '/pro/media/new',
      proPublicProfile: '/pro/profile/public-profile',
      looks: '/looks',
    },
    tab: 'portfolio',

    profile: {
      id: 'pro_1',
      handle: 'tovisstudio',
      verificationStatus: VerificationStatus.APPROVED,
      isApproved: true,
      isPremium: true,
      canEditHandle: true,

      displayName: 'TOVIS Studio',
      subtitle: 'Barber',
      location: 'San Diego, CA',
      bio: 'Trusted beauty pro.',
      avatarUrl: null,
      professionType: 'BARBER',

      publicUrl: '/professionals/pro_1',
      livePublicUrl: '/professionals/pro_1',
    },

    stats: [
      {
        key: 'rating',
        label: 'Rating',
        value: '–',
      },
      {
        key: 'reviews',
        label: 'Reviews',
        value: '0',
      },
      {
        key: 'favorites',
        label: 'Favs',
        value: '7',
      },
      {
        key: 'looks',
        label: 'Looks',
        value: '3',
      },
      {
        key: 'followers',
        label: 'Followers',
        value: '11',
      },
    ],

    unreadNotificationCount: 0,

    editProfileInitial: {
      businessName: 'TOVIS Studio',
      bio: 'Trusted beauty pro.',
      location: 'San Diego, CA',
      avatarUrl: null,
      professionType: 'BARBER',
      handle: 'tovisstudio',
      isPremium: true,
    },

    paymentSettingsInitial: {
      collectPaymentAt: PaymentCollectionTiming.AFTER_SERVICE,
      acceptCash: true,
      acceptCardOnFile: false,
      acceptTapToPay: false,
      acceptVenmo: false,
      acceptZelle: false,
      acceptAppleCash: false,
      tipsEnabled: true,
      allowCustomTip: true,
      tipSuggestions: null,
      venmoHandle: null,
      zelleHandle: null,
      appleCashHandle: null,
      paymentNote: null,
    },

    portfolio: {
      tiles: [],
      serviceOptions: [],
      hasLooksEligibleBridge: false,
    },

    reviews: {
      items: [],
      reviewCount: 0,
      averageRatingLabel: null,
    },

    ...patch,
  }
}

async function renderPage(searchParams: TestSearchParams = {}) {
  const ui = await ProPublicProfilePage({
    searchParams: Promise.resolve(searchParams),
  })

  return render(ui)
}

describe('app/pro/profile/public-profile/page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadProProfileManagementPage.mockResolvedValue(makeModel())
  })

  it('loads the profile management model with resolved search params', async () => {
    await renderPage({ tab: 'services', add: '1' })

    expect(mockLoadProProfileManagementPage).toHaveBeenCalledTimes(1)
    expect(mockLoadProProfileManagementPage).toHaveBeenCalledWith({
      searchParams: {
        tab: 'services',
        add: '1',
      },
    })
  })

  it('renders the profile management shell with the loaded model', async () => {
    mockLoadProProfileManagementPage.mockResolvedValue(
      makeModel({
        tab: 'reviews',
        profile: {
          ...makeModel().profile,
          id: 'pro_2',
          displayName: 'Glow House',
          isApproved: false,
          canEditHandle: false,
          livePublicUrl: null,
          verificationStatus: VerificationStatus.PENDING,
        },
      }),
    )

    await renderPage({ tab: 'reviews' })

    const shell = screen.getByTestId('pro-profile-management-shell')

    expect(shell).toHaveTextContent('ProProfileManagementShell')
    expect(shell).toHaveAttribute('data-tab', 'reviews')
    expect(shell).toHaveAttribute('data-profile-id', 'pro_2')
    expect(shell).toHaveAttribute('data-display-name', 'Glow House')
    expect(shell).toHaveAttribute('data-approved', 'false')
  })

  it('propagates loader errors such as redirects', async () => {
    mockLoadProProfileManagementPage.mockRejectedValue(
      new Error(
        'NEXT_REDIRECT:/login?from=%2Fpro%2Fprofile%2Fpublic-profile',
      ),
    )

    await expect(renderPage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?from=%2Fpro%2Fprofile%2Fpublic-profile',
    )
  })
})