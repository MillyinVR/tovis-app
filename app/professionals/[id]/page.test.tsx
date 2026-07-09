import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The route page is a thin wrapper: resolve the id + searchParams and delegate
// to PublicProfileView. The full render/data behavior is covered by
// _components/PublicProfileView.test.tsx.

const mockNotFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
)

vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
}))

vi.mock('./_components/PublicProfileView', () => ({
  default: ({
    id,
    searchParams,
  }: {
    id: string
    searchParams?: { tab?: string | string[] }
  }) => (
    <div data-testid="public-profile-view">
      <div>id:{id}</div>
      <div>tab:{typeof searchParams?.tab === 'string' ? searchParams.tab : 'none'}</div>
    </div>
  ),
}))

import PublicProfessionalProfilePage from './page'

async function renderPage(args?: {
  id?: string
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const ui = await PublicProfessionalProfilePage({
    params: Promise.resolve({ id: args?.id ?? 'pro_1' }),
    ...(args?.searchParams
      ? { searchParams: Promise.resolve(args.searchParams) }
      : {}),
  })

  return render(ui)
}

describe('app/professionals/[id]/page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to PublicProfileView with the resolved id', async () => {
    await renderPage()

    expect(screen.getByTestId('public-profile-view')).toHaveTextContent(
      'id:pro_1',
    )
  })

  it('forwards resolved searchParams to PublicProfileView', async () => {
    await renderPage({ searchParams: { tab: 'services' } })

    expect(screen.getByTestId('public-profile-view')).toHaveTextContent(
      'tab:services',
    )
  })

  it('calls notFound when the id is missing', async () => {
    await expect(renderPage({ id: '' })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })
})
