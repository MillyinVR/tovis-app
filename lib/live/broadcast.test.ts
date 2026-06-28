import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  broadcastLive,
  liveChannelForPro,
  liveChannelForUser,
} from './broadcast'

describe('live channel names', () => {
  it('builds audience-scoped channels and tolerates nullish ids', () => {
    expect(liveChannelForPro('pro_1')).toBe('pro:pro_1')
    expect(liveChannelForUser('usr_1')).toBe('user:usr_1')
    expect(liveChannelForPro(null)).toBeNull()
    expect(liveChannelForUser(undefined)).toBeNull()
  })
})

describe('broadcastLive', () => {
  const ORIGINAL = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is fail-open (returns false, no throw) when Realtime is unconfigured', async () => {
    delete process.env.SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(broadcastLive(['pro:1'], 'bookings')).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs one message per non-null channel to the Realtime broadcast endpoint', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.SUPABASE_URL = 'https://proj.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)

    const ok = await broadcastLive(['pro:1', null, 'user:2'], 'consultation')

    expect(ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://proj.supabase.co/realtime/v1/api/broadcast')
    const body = JSON.parse(init.body)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toMatchObject({
      topic: 'pro:1',
      event: 'changed',
      payload: { topic: 'consultation' },
    })
    expect(body.messages[1].topic).toBe('user:2')
    expect(init.headers.apikey).toBe('service-key')
  })

  it('never throws when the network call fails', async () => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(broadcastLive(['pro:1'], 'bookings')).resolves.toBe(false)
  })
})
