// app/_components/ClientProfileLink.test.tsx
//
// The pro-side mirror of ProProfileLink.test.tsx. What matters here is the
// no-href direction: a private client has no public page by design, and a pro
// past the chart window has nowhere to go — both must render plain text, not a
// link that refuses on arrival.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import ClientProfileLink from './ClientProfileLink'

describe('ClientProfileLink', () => {
  it('links the name to the resolved href', () => {
    render(<ClientProfileLink href="/u/ada" label="Ada Lovelace" />)

    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute(
      'href',
      '/u/ada',
    )
  })

  it('links a chart href just the same — it does not care which', () => {
    render(<ClientProfileLink href="/pro/clients/cl_1" label="Ada Lovelace" />)

    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute(
      'href',
      '/pro/clients/cl_1',
    )
  })

  it('renders plain text with NO anchor when href is null', () => {
    const { container } = render(
      <ClientProfileLink href={null} label="Ada Lovelace" />,
    )

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(container.querySelector('a')).toBeNull()
  })

  it('treats undefined and a blank href as null', () => {
    const { container: a } = render(<ClientProfileLink label="Ada" />)
    expect(a.querySelector('a')).toBeNull()

    const { container: b } = render(<ClientProfileLink href="   " label="Ada" />)
    expect(b.querySelector('a')).toBeNull()
  })

  it('falls back to "Client" when the name is blank', () => {
    render(<ClientProfileLink href="/u/ada" label="   " />)

    expect(screen.getByRole('link', { name: 'Client' })).toBeInTheDocument()
  })

  // An avatar-only link carries no text of its own, so it would announce as a
  // bare "link" without this.
  it('names an avatar-only link for screen readers', () => {
    render(
      <ClientProfileLink href="/u/ada" label="Ada Lovelace" underline={false}>
        <img alt="" src="/a.jpg" />
      </ClientProfileLink>,
    )

    expect(
      screen.getByRole('link', { name: "View Ada Lovelace's profile" }),
    ).toBeInTheDocument()
  })

  // The inert case is styled separately because the link's hover/underline
  // classes read as "clickable" on text that is not.
  it('applies inertClassName only when inert', () => {
    const { container: inert } = render(
      <ClientProfileLink
        href={null}
        label="Ada"
        className="linked"
        inertClassName="plain"
      />,
    )
    expect(inert.querySelector('span')).toHaveClass('plain')
    expect(inert.querySelector('span')).not.toHaveClass('linked')

    const { container: linked } = render(
      <ClientProfileLink
        href="/u/ada"
        label="Ada"
        className="linked"
        inertClassName="plain"
      />,
    )
    expect(linked.querySelector('a')).toHaveClass('linked')
    expect(linked.querySelector('a')).not.toHaveClass('plain')
  })

  // A tooltip promising a profile is itself a dead end when there isn't one.
  it('renders no default tooltip on inert text', () => {
    const { container } = render(<ClientProfileLink href={null} label="Ada" />)

    expect(container.querySelector('span')).not.toHaveAttribute('title')
  })
})
