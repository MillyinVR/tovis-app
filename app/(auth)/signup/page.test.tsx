import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

vi.mock('next/link', () => ({
  default: (props: {
    href: string
    children: React.ReactNode
    className?: string
  }) =>
    React.createElement(
      'a',
      {
        href: props.href,
        className: props.className,
      },
      props.children,
    ),
}))

import SignupChooserPage from './page'

function makeRedirectError(href: string): Error {
  return new Error(`REDIRECT:${href}`)
}

async function renderPage(searchParams?: Record<string, string | string[] | undefined>) {
  const element = await SignupChooserPage({
    searchParams,
  })

  return renderToStaticMarkup(element)
}

describe('app/(auth)/signup/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.redirect.mockImplementation((href: string) => {
      throw makeRedirectError(href)
    })
  })

  it('renders chooser links and preserves handoff query params for client, pro, and login', async () => {
    const html = await renderPage({
      ti: 'ti_123',
      from: '/claim/tok_1',
      next: '/claim/tok_1',
      intent: 'CLAIM_INVITE',
      inviteToken: 'tok_1',
      name: 'Tori Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    expect(mocks.redirect).not.toHaveBeenCalled()

    expect(html).toContain('Create your account')

    expect(html).toContain(
      '/signup/pro?ti=ti_123&amp;from=%2Fclaim%2Ftok_1&amp;next=%2Fclaim%2Ftok_1&amp;intent=CLAIM_INVITE&amp;inviteToken=tok_1&amp;name=Tori+Morales&amp;phone=%2B16195551234&amp;email=tori%40example.com&amp;role=PRO',
    )

    expect(html).toContain(
      '/signup/client?ti=ti_123&amp;from=%2Fclaim%2Ftok_1&amp;next=%2Fclaim%2Ftok_1&amp;intent=CLAIM_INVITE&amp;inviteToken=tok_1&amp;name=Tori+Morales&amp;phone=%2B16195551234&amp;email=tori%40example.com&amp;role=CLIENT',
    )

    expect(html).toContain(
      '/login?ti=ti_123&amp;from=%2Fclaim%2Ftok_1&amp;next=%2Fclaim%2Ftok_1&amp;intent=CLAIM_INVITE&amp;inviteToken=tok_1&amp;name=Tori+Morales&amp;phone=%2B16195551234&amp;email=tori%40example.com',
    )
  })

  it('auto-redirects claim invite client flows directly to /signup/client', async () => {
    await expect(
      renderPage({
        role: 'CLIENT',
        intent: 'CLAIM_INVITE',
        from: '/claim/tok_1',
        next: '/claim/tok_1',
        inviteToken: 'tok_1',
        name: 'Tori Morales',
        email: 'tori@example.com',
        phone: '+16195551234',
      }),
    ).rejects.toThrow(/^REDIRECT:/)

    expect(mocks.redirect).toHaveBeenCalledTimes(1)
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/signup/client?from=%2Fclaim%2Ftok_1&next=%2Fclaim%2Ftok_1&intent=CLAIM_INVITE&inviteToken=tok_1&name=Tori+Morales&phone=%2B16195551234&email=tori%40example.com&role=CLIENT',
    )
  })

  it('does not auto-redirect claim invite flows when role is missing', async () => {
    const html = await renderPage({
      intent: 'CLAIM_INVITE',
      from: '/claim/tok_1',
      next: '/claim/tok_1',
      inviteToken: 'tok_1',
    })

    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(html).toContain('Create your account')
    expect(html).toContain('/signup/client?')
  })

  it('does not auto-redirect claim invite flows when role is PRO', async () => {
    const html = await renderPage({
      role: 'PRO',
      intent: 'CLAIM_INVITE',
      from: '/claim/tok_1',
      next: '/claim/tok_1',
      inviteToken: 'tok_1',
    })

    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(html).toContain('Create your account')
    expect(html).toContain('/signup/pro?')
  })

  it('uses the claim-specific helper copy when intent is claim invite', async () => {
    const html = await renderPage({
      intent: 'CLAIM_INVITE',
    })

    expect(html).toContain(
      'Create the right account first so we can attach your claimed history correctly.',
    )
  })

  it('uses the normal chooser copy for non-claim signup flows', async () => {
    const html = await renderPage({
      ti: 'ti_123',
    })

    expect(html).toContain('Pick what you’re here to do.')
  })
})