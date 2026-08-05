import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  broadcastLive: vi.fn(),
  professionalProfileFindUnique: vi.fn(),
}))

vi.mock('./broadcast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./broadcast')>()

  return {
    ...actual,
    broadcastLive: mocks.broadcastLive,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalProfile: {
      findUnique: mocks.professionalProfileFindUnique,
    },
  },
}))

import { broadcastChange, liveChannelsForProfessional } from './broadcastAudience'

describe('liveChannelsForProfessional', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.broadcastLive.mockResolvedValue(true)
  })

  it("includes the pro's OWN user channel, not just the salon channel", async () => {
    // The whole point: iOS builds its channel list from the session JWT, which
    // carries userId and no professional-profile id — so it subscribes to
    // `user:{userId}` only. A `pro:` ping alone is inaudible on the phone.
    mocks.professionalProfileFindUnique.mockResolvedValue({ userId: 'usr_pro' })

    await expect(liveChannelsForProfessional('pro_1')).resolves.toEqual([
      'pro:pro_1',
      'user:usr_pro',
    ])
  })

  it('degrades to the salon channel alone when the profile cannot be resolved', async () => {
    mocks.professionalProfileFindUnique.mockResolvedValue(null)

    await expect(liveChannelsForProfessional('pro_1')).resolves.toEqual([
      'pro:pro_1',
    ])
  })

  it('returns nothing for a nullish professional and never queries', async () => {
    await expect(liveChannelsForProfessional(null)).resolves.toEqual([])
    expect(mocks.professionalProfileFindUnique).not.toHaveBeenCalled()
  })
})

describe('broadcastChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.broadcastLive.mockResolvedValue(true)
  })

  it('sends to the pro (both channels) and to each named user', async () => {
    mocks.professionalProfileFindUnique.mockResolvedValue({ userId: 'usr_pro' })

    await broadcastChange({
      topic: 'consultation',
      professionalId: 'pro_1',
      userIds: ['usr_client'],
    })

    expect(mocks.broadcastLive).toHaveBeenCalledWith(
      ['pro:pro_1', 'user:usr_pro', 'user:usr_client'],
      'consultation',
    )
  })

  it('deduplicates when the pro is also the named user', async () => {
    mocks.professionalProfileFindUnique.mockResolvedValue({ userId: 'usr_pro' })

    await broadcastChange({
      topic: 'bookings',
      professionalId: 'pro_1',
      userIds: ['usr_pro', null, undefined],
    })

    expect(mocks.broadcastLive).toHaveBeenCalledWith(
      ['pro:pro_1', 'user:usr_pro'],
      'bookings',
    )
  })

  it('is fail-open when the profile lookup throws — the write already committed', async () => {
    mocks.professionalProfileFindUnique.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      broadcastChange({
        topic: 'bookings',
        professionalId: 'pro_1',
        userIds: ['usr_client'],
      }),
    ).resolves.toBeUndefined()

    // The client still gets told even though the pro lookup failed.
    expect(mocks.broadcastLive).toHaveBeenCalledWith(
      ['pro:pro_1', 'user:usr_client'],
      'bookings',
    )
  })

  it('never throws when the transport itself fails', async () => {
    mocks.professionalProfileFindUnique.mockResolvedValue({ userId: 'usr_pro' })
    mocks.broadcastLive.mockRejectedValue(new Error('realtime down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      broadcastChange({ topic: 'bookings', professionalId: 'pro_1' }),
    ).resolves.toBeUndefined()
  })
})
