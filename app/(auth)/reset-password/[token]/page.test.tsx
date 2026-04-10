import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockResetPasswordClient = vi.hoisted(() => vi.fn())

vi.mock('../../_components/reset/ResetPasswordClient', () => ({
  default: ({ token }: { token: string }) => {
    mockResetPasswordClient(token)
    return <div>reset-token:{token}</div>
  },
}))

import Page from './page'

describe('app/(auth)/reset-password/[token]/page', () => {
  it('passes the route token to ResetPasswordClient', async () => {
    const result = await Page({
      params: Promise.resolve({ token: 'reset_token_123' }),
    })

    render(result)

    expect(mockResetPasswordClient).toHaveBeenCalledWith('reset_token_123')
    expect(screen.getByText('reset-token:reset_token_123')).toBeInTheDocument()
  })
})