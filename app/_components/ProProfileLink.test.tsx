// app/_components/ProProfileLink.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import ProProfileLink from './ProProfileLink'

describe('ProProfileLink', () => {
  it('links the pro name to their public profile', () => {
    render(<ProProfileLink proId="pro_1" label="Glow Studio" />)

    expect(screen.getByRole('link', { name: 'Glow Studio' })).toHaveAttribute(
      'href',
      '/professionals/pro_1',
    )
  })

  it('encodes ids that are not URL-safe', () => {
    render(<ProProfileLink proId="pro/1 2" label="Glow Studio" />)

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/professionals/pro%2F1%202',
    )
  })

  it('renders inert text with NO href when the pro id is missing', () => {
    render(<ProProfileLink proId={null} label="Glow Studio" />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Glow Studio')).toBeInTheDocument()
  })

  // A blank-but-present id is the shape that produced `/professionals/` — a
  // link to a 404 reads as "clickable" until it's tapped.
  it('treats a blank id as missing', () => {
    render(<ProProfileLink proId="   " label="Glow Studio" />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('falls back to "Professional" when the label is blank', () => {
    render(<ProProfileLink proId="pro_1" label="  " />)

    expect(screen.getByRole('link', { name: 'Professional' })).toBeInTheDocument()
  })

  // An avatar-only link has no text of its own; without a name it announces as
  // a bare "link" to a screen reader.
  it('names an avatar-only link after the pro', () => {
    render(
      <ProProfileLink proId="pro_1" label="Glow Studio" underline={false}>
        <img alt="" src="/a.png" />
      </ProProfileLink>,
    )

    expect(
      screen.getByRole('link', { name: "View Glow Studio's profile" }),
    ).toHaveAttribute('href', '/professionals/pro_1')
  })

  it('keeps the children as the body when the id is missing', () => {
    render(
      <ProProfileLink proId={null} label="Glow Studio">
        <span>GS</span>
      </ProProfileLink>,
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('GS')).toBeInTheDocument()
  })
})
