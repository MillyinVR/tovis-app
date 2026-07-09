import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The vanity route's only job is to resolve the handle to a ProfessionalProfile
// id and delegate to the shared full-profile view. The full-profile render
// (hero/tabs/gating/pending-verification) is covered by
// app/professionals/[id]/page.test.tsx, so here we mock the shared view and
// assert the handle→id resolution + delegation.

const mockNotFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
)

const mocks = vi.hoisted(() => ({
  prisma: {
    professionalProfile: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/app/professionals/[id]/_components/PublicProfileView', () => ({
  default: ({ id }: { id: string }) => (
    <div data-testid="public-profile-view">id:{id}</div>
  ),
}))

import VanityProfilePage from './page'

async function renderPage(args?: { handle?: string }) {
  const ui = await VanityProfilePage({
    params: Promise.resolve({ handle: args?.handle ?? 'TOVISStudio' }),
  })

  return render(ui)
}

describe('app/p/[handle]/page', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.prisma.professionalProfile.findUnique.mockResolvedValue({
      id: 'pro_1',
    })
  })

  it('resolves the vanity handle to a professional id and renders the full public profile', async () => {
    await renderPage()

    expect(mocks.prisma.professionalProfile.findUnique).toHaveBeenCalledWith({
      where: { handleNormalized: 'tovisstudio' },
      select: { id: true },
    })

    expect(screen.getByTestId('public-profile-view')).toHaveTextContent(
      'id:pro_1',
    )
  })

  it('calls notFound when the vanity handle does not resolve to a professional profile', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  it('calls notFound without a DB lookup when the handle normalizes to empty', async () => {
    await expect(renderPage({ handle: '   ' })).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mockNotFound).toHaveBeenCalled()
    expect(
      mocks.prisma.professionalProfile.findUnique,
    ).not.toHaveBeenCalled()
  })
})
