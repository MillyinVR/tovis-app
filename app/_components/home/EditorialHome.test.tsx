import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultHomeCopy } from '@/lib/brand/defaultHomeCopy'
import { editorialCampaign } from '@/lib/brand/editorialCampaign'
import EditorialHome from './EditorialHome'
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}))

describe('editorial homepage', () => {
  it('keeps the root campaign out of white-label defaults', () => {
    expect(defaultHomeCopy('Partner').campaign).toBeUndefined()
  })
  it('filters editorial samples, saves only within the preview, and switches actual screens', () => {
    const campaign = editorialCampaign()
    const [firstScreen, secondScreen] = campaign.screens
    if (!firstScreen || !secondScreen)
      throw new Error('Campaign must include both captured screens')
    render(
      <EditorialHome
        copy={defaultHomeCopy('Partner')}
        campaign={campaign}
        navigation={null}
        footer={null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Barbering' }))
    expect(
      screen.queryByRole('heading', { name: 'Length, with intention.' }),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Save A fresh perspective.' }),
    )
    expect(screen.getByText('1 saved in this preview')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: /Discover your next appointment/ }),
    )
    expect(screen.getByRole('img', { name: secondScreen.alt })).toBeTruthy()
    expect(screen.queryByRole('img', { name: firstScreen.alt })).toBeNull()
    expect(
      screen.getByRole('link', { name: /Find your look/ }).getAttribute('href'),
    ).toBe('/looks')
  })
})
