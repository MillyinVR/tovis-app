import { describe, expect, it } from 'vitest'
import { WaitlistStatus } from '@prisma/client'
import { labelForWaitlistStatus } from './statusLabel'

describe('labelForWaitlistStatus', () => {
  it('renders every status in sentence case', () => {
    expect(labelForWaitlistStatus(WaitlistStatus.ACTIVE)).toBe('Position active')
    expect(labelForWaitlistStatus(WaitlistStatus.NOTIFIED)).toBe('Notified')
    expect(labelForWaitlistStatus(WaitlistStatus.BOOKED)).toBe('Booked')
    expect(labelForWaitlistStatus(WaitlistStatus.CANCELLED)).toBe('Cancelled')
  })
})
