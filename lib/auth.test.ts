import { beforeAll, describe, expect, it } from 'vitest'

// lib/auth reads JWT_SECRET at import time.
beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value'
})

describe('lib/auth device-bound tokens', () => {
  it('round-trips a deviceId claim and exposes the issued-at seconds', async () => {
    const { createActiveToken, verifyToken } = await import('./auth')

    const token = createActiveToken({
      userId: 'user_1',
      role: 'CLIENT',
      authVersion: 1,
      deviceId: 'device_abc',
    })

    const payload = verifyToken(token)
    expect(payload).not.toBeNull()
    expect(payload?.userId).toBe('user_1')
    expect(payload?.sessionKind).toBe('ACTIVE')
    expect(payload?.deviceId).toBe('device_abc')
    expect(typeof payload?.issuedAtSeconds).toBe('number')
  })

  it('omits the deviceId claim for a deviceless (web) token', async () => {
    const { createActiveToken, verifyToken } = await import('./auth')

    const token = createActiveToken({
      userId: 'user_1',
      role: 'CLIENT',
      authVersion: 1,
    })

    const payload = verifyToken(token)
    expect(payload?.deviceId).toBeUndefined()
  })

  it('trims a whitespace-only deviceId down to no claim', async () => {
    const { createVerificationToken, verifyToken } = await import('./auth')

    const token = createVerificationToken({
      userId: 'user_1',
      role: 'PRO',
      authVersion: 2,
      deviceId: '   ',
    })

    const payload = verifyToken(token)
    expect(payload?.sessionKind).toBe('VERIFICATION')
    expect(payload?.deviceId).toBeUndefined()
  })
})
