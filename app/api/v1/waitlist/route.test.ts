// app/api/v1/waitlist/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  waitlistFindFirst: vi.fn(),
  waitlistCreate: vi.fn(),
  serviceFindUnique: vi.fn(),
  messageCreate: vi.fn(),
  messageThreadUpdate: vi.fn(),
  participantUpdate: vi.fn(),
  transaction: vi.fn(),
  resolveMessageThread: vi.fn(),
  waitlistFindUnique: vi.fn(),
  cancelClientWaitlistEntry: vi.fn(),
  enforceRateLimit: vi.fn(),
  clientRateLimitKey: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  participantFindMany: vi.fn(),
  broadcastLive: vi.fn(),
  liveChannelForUser: vi.fn((userId: string) => `user:${userId}`),
  createProNotification: vi.fn(),
  kickNotificationDrain: vi.fn(),
  loadWaitlistHostability: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waitlistEntry: {
      findFirst: mocks.waitlistFindFirst,
      findUnique: mocks.waitlistFindUnique,
      create: mocks.waitlistCreate,
    },
    service: {
      findUnique: mocks.serviceFindUnique,
    },
    clientProfile: { findUnique: mocks.clientProfileFindUnique },
    message: { create: mocks.messageCreate },
    messageThread: { update: mocks.messageThreadUpdate },
    messageThreadParticipant: {
      update: mocks.participantUpdate,
      findMany: mocks.participantFindMany,
    },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  pickString: (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null),
  pickInt: (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
    return Number.isFinite(n) ? Math.trunc(n) : null
  },
  jsonOk: (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  jsonFail: (status: number, message: string) =>
    new Response(JSON.stringify({ ok: false, message }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

vi.mock('@/lib/messagesResolve', () => ({
  resolveMessageThread: mocks.resolveMessageThread,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  cancelClientWaitlistEntry: mocks.cancelClientWaitlistEntry,
}))

// The limiter is mocked, never driven: `.env.test.local` points at the SAME
// Upstash instance as prod, so a test must not touch real Redis state.
vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  clientRateLimitKey: mocks.clientRateLimitKey,
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: mocks.rateLimitExceededResponse,
}))

vi.mock('@/lib/live/broadcast', () => ({
  broadcastLive: mocks.broadcastLive,
  liveChannelForUser: mocks.liveChannelForUser,
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))

// The join now refuses a pro/service the pro cannot actually host. Only the
// LOOKUP is mocked — `waitlistRefusalMessage` is the real one, so these tests
// assert the sentence a client would really be shown.
vi.mock('@/lib/waitlist/hostability', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/waitlist/hostability')>()
  return {
    ...actual,
    loadWaitlistHostability: mocks.loadWaitlistHostability,
  }
})

import { DELETE, PATCH, POST } from './route'

const ALLOWED = {
  allowed: true,
  bucket: 'waitlist:write',
  key: 'user:user-1|client:client-1|ip:unknown-ip',
  limit: 20,
  remaining: 19,
  resetAt: new Date('2030-01-15T10:01:00.000Z'),
  retryAfterSeconds: 60,
  source: 'redis',
} as const

const BLOCKED = {
  allowed: false,
  bucket: 'waitlist:write',
  key: 'user:user-1|client:client-1|ip:unknown-ip',
  limit: 20,
  remaining: 0,
  resetAt: new Date('2030-01-15T10:01:00.000Z'),
  retryAfterSeconds: 60,
  source: 'redis',
  reason: 'rate_limited',
} as const

function postRequest(body: Record<string, unknown>): Request {
  return new Request('https://example.test/api/v1/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/waitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client-1',
      user: { id: 'user-1' },
    })
    mocks.waitlistFindFirst.mockResolvedValue(null)
    mocks.loadWaitlistHostability.mockResolvedValue({
      ok: true,
      offeringId: 'off-1',
      modes: ['SALON'],
    })
    mocks.waitlistCreate.mockResolvedValue({
      id: 'wl-1',
      status: 'ACTIVE',
      professionalId: 'pro-1',
      serviceId: 'svc-1',
      mediaId: null,
      notes: null,
      preferenceType: 'ANY_TIME',
      specificDate: null,
      timeOfDay: null,
      windowStartMin: null,
      windowEndMin: null,
    })
    mocks.serviceFindUnique.mockResolvedValue({ name: 'Balayage' })
    mocks.resolveMessageThread.mockResolvedValue({
      ok: true,
      thread: { id: 'thread-1' },
    })
    mocks.messageCreate.mockResolvedValue({
      id: 'msg-1',
      createdAt: new Date('2030-01-15T10:00:00.000Z'),
    })
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        message: { create: mocks.messageCreate },
        messageThread: { update: mocks.messageThreadUpdate },
        messageThreadParticipant: { update: mocks.participantUpdate },
      }),
    )
    mocks.participantFindMany.mockResolvedValue([{ userId: 'pro-user-1' }])
    mocks.clientProfileFindUnique.mockResolvedValue({
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
    mocks.broadcastLive.mockResolvedValue(undefined)
    mocks.createProNotification.mockResolvedValue({ id: 'notif-1' })
    mocks.enforceRateLimit.mockResolvedValue(ALLOWED)
    mocks.clientRateLimitKey.mockReturnValue(
      'user:user-1|client:client-1|ip:unknown-ip',
    )
  })

  it('creates the entry AND seeds a WAITLIST thread with a first message', async () => {
    const res = await POST(
      postRequest({
        professionalId: 'pro-1',
        serviceId: 'svc-1',
        preferenceType: 'ANY_TIME',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.entry.id).toBe('wl-1')

    // Thread materialized for the new entry with createIfMissing.
    expect(mocks.resolveMessageThread).toHaveBeenCalledTimes(1)
    expect(mocks.resolveMessageThread).toHaveBeenCalledWith({
      viewer: { clientProfile: { id: 'client-1' } },
      input: {
        contextType: 'WAITLIST',
        contextId: 'wl-1',
        createIfMissing: true,
      },
    })

    // Seed message created as the client, and lastMessageAt set so it surfaces in the inbox.
    expect(mocks.messageCreate).toHaveBeenCalledTimes(1)
    expect(mocks.messageCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      threadId: 'thread-1',
      senderUserId: 'user-1',
    })
    expect(mocks.messageThreadUpdate.mock.calls[0]?.[0]?.data?.lastMessageAt).toBeTruthy()
  })

  it('still succeeds (201) when thread seeding throws — best-effort, never fails the join', async () => {
    mocks.resolveMessageThread.mockRejectedValue(new Error('messaging down'))

    const res = await POST(
      postRequest({
        professionalId: 'pro-1',
        serviceId: 'svc-1',
        preferenceType: 'ANY_TIME',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.entry.id).toBe('wl-1')
    expect(mocks.messageCreate).not.toHaveBeenCalled()
  })

  // W2 — before this, joining a waitlist produced NO notification of any kind.
  // The seed message above was written with raw Prisma and never reached the
  // notification engine, so the pro's only signal was an unread inbox dot they
  // had to already be in the app to see.
  describe('WAITLIST_JOINED notification', () => {
    it('notifies the pro, deep-linked to the thread, deduped per entry', async () => {
      const res = await POST(
        postRequest({
          professionalId: 'pro-1',
          serviceId: 'svc-1',
          preferenceType: 'ANY_TIME',
        }),
      )

      expect(res.status).toBe(201)
      expect(mocks.createProNotification).toHaveBeenCalledTimes(1)
      expect(mocks.createProNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          professionalId: 'pro-1',
          eventKey: 'WAITLIST_JOINED',
          title: 'Ada Lovelace joined your waitlist',
          href: '/messages/thread/thread-1',
          // Per ENTRY: a client re-submitting their preferences refreshes this
          // row instead of stacking another one on the pro.
          dedupeKey: 'waitlist-joined:wl-1',
        }),
      )

      // Without the kick, the push/email waits for the next cron tick.
      expect(mocks.kickNotificationDrain).toHaveBeenCalled()
    })

    it('broadcasts live so an open pro inbox updates without a reload', async () => {
      await POST(
        postRequest({
          professionalId: 'pro-1',
          serviceId: 'svc-1',
          preferenceType: 'ANY_TIME',
        }),
      )

      expect(mocks.broadcastLive).toHaveBeenCalledWith(
        ['user:pro-user-1'],
        'messages',
      )
    })

    // The pro performed ONE act's worth of attention. WAITLIST_JOINED already
    // carries in-app + push + EMAIL and opens the same thread, so also firing
    // MESSAGE_RECEIVED for the seed message would just notify them twice.
    it('does not also fire a message notification for the seed message', async () => {
      await POST(
        postRequest({
          professionalId: 'pro-1',
          serviceId: 'svc-1',
          preferenceType: 'ANY_TIME',
        }),
      )

      const eventKeys = mocks.createProNotification.mock.calls.map(
        (call) => (call[0] as { eventKey: string }).eventKey,
      )
      expect(eventKeys).toEqual(['WAITLIST_JOINED'])
    })

    // The join has already committed. A notification problem must not turn a
    // successful join into a 500 the client retries.
    it('still returns 201 when the notification throws', async () => {
      mocks.createProNotification.mockRejectedValue(new Error('engine down'))

      const res = await POST(
        postRequest({
          professionalId: 'pro-1',
          serviceId: 'svc-1',
          preferenceType: 'ANY_TIME',
        }),
      )

      expect(res.status).toBe(201)
    })

    // Seeding is best-effort, but the pro must still be TOLD someone joined —
    // it just points at the waitlist instead of a thread that does not exist.
    it('still notifies, falling back to /pro/waitlist, when thread seeding fails', async () => {
      mocks.resolveMessageThread.mockRejectedValue(new Error('messaging down'))

      const res = await POST(
        postRequest({
          professionalId: 'pro-1',
          serviceId: 'svc-1',
          preferenceType: 'ANY_TIME',
        }),
      )

      expect(res.status).toBe(201)
      expect(mocks.createProNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          eventKey: 'WAITLIST_JOINED',
          href: '/pro/waitlist',
        }),
      )
    })
  })

  it('refuses over the waitlist:write ceiling BEFORE any DB read, keyed per client', async () => {
    const limitedResponse = new Response(
      JSON.stringify({ ok: false, code: 'RATE_LIMITED' }),
      { status: 429 },
    )
    mocks.enforceRateLimit.mockResolvedValueOnce(BLOCKED)
    mocks.rateLimitExceededResponse.mockReturnValueOnce(limitedResponse)

    const res = await POST(
      postRequest({
        professionalId: 'pro-1',
        serviceId: 'svc-1',
        preferenceType: 'ANY_TIME',
      }),
    )

    expect(res).toBe(limitedResponse)
    expect(res.status).toBe(429)

    expect(mocks.clientRateLimitKey).toHaveBeenCalledWith({
      clientId: 'client-1',
      userId: 'user-1',
      request: expect.any(Request),
    })
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'waitlist:write',
      key: 'user:user-1|client:client-1|ip:unknown-ip',
    })
    expect(mocks.rateLimitExceededResponse).toHaveBeenCalledWith(BLOCKED)

    // The point of enforcing before the duplicate check: the 409 path is itself
    // two unrated queries, so a refused join must not reach the DB at all.
    expect(mocks.waitlistFindFirst).not.toHaveBeenCalled()
    expect(mocks.waitlistCreate).not.toHaveBeenCalled()
    expect(mocks.resolveMessageThread).not.toHaveBeenCalled()
  })

  it('spends from the SAME bucket on PATCH and DELETE, so a join/leave cycle cannot dodge it', async () => {
    // PATCH — refused before the entry lookup.
    const patchLimited = new Response('{}', { status: 429 })
    mocks.enforceRateLimit.mockResolvedValueOnce(BLOCKED)
    mocks.rateLimitExceededResponse.mockReturnValueOnce(patchLimited)

    const patchRes = await PATCH(
      new Request('https://example.test/api/v1/waitlist', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'wl-1', preferenceType: 'ANY_TIME' }),
      }),
    )

    expect(patchRes).toBe(patchLimited)
    expect(mocks.waitlistFindUnique).not.toHaveBeenCalled()

    // DELETE — refused before the entry lookup and before the write boundary,
    // which is what takes the professional's schedule lock (B4).
    const deleteLimited = new Response('{}', { status: 429 })
    mocks.enforceRateLimit.mockResolvedValueOnce(BLOCKED)
    mocks.rateLimitExceededResponse.mockReturnValueOnce(deleteLimited)

    const deleteRes = await DELETE(
      new Request('https://example.test/api/v1/waitlist?id=wl-1', {
        method: 'DELETE',
      }),
    )

    expect(deleteRes).toBe(deleteLimited)
    expect(mocks.waitlistFindUnique).not.toHaveBeenCalled()
    expect(mocks.cancelClientWaitlistEntry).not.toHaveBeenCalled()

    // All three methods name one bucket — that is what makes a lap of the
    // join→leave cycle cost two tokens instead of one from each of two buckets.
    for (const call of mocks.enforceRateLimit.mock.calls) {
      expect(call[0].bucket).toBe('waitlist:write')
    }
  })

  it('rejects a duplicate active waitlist request (409) and does not seed a thread', async () => {
    mocks.waitlistFindFirst.mockResolvedValue({ id: 'existing' })

    const res = await POST(
      postRequest({
        professionalId: 'pro-1',
        serviceId: 'svc-1',
        preferenceType: 'ANY_TIME',
      }),
    )

    expect(res.status).toBe(409)
    expect(mocks.waitlistCreate).not.toHaveBeenCalled()
    expect(mocks.resolveMessageThread).not.toHaveBeenCalled()
  })

  // The join used to write the row without checking ANY of this, so a
  // mobile-only pro silently collected salon waitlisters their own offer
  // endpoint then refused one by one.
  describe('refuses a combination the pro cannot host', () => {
    it('refuses when the pro can host this service in NO mode, and writes nothing', async () => {
      mocks.loadWaitlistHostability.mockResolvedValue({
        ok: false,
        refusal: { kind: 'NO_HOSTABLE_MODE' },
      })

      const res = await POST(
        postRequest({
          professionalId: 'pro-1',
          serviceId: 'svc-1',
          preferenceType: 'ANY_TIME',
        }),
      )

      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.message).toContain('cannot take appointments')
      // The refusal must not blame a mode limit that no longer exists: a
      // mobile-only pro is now hostable, so "only in-salon" would send this
      // client to fix the wrong thing.
      expect(body.message).not.toContain('in-salon')
      // No row, no thread, and no "someone joined your waitlist" to a pro who
      // could never act on it.
      expect(mocks.waitlistCreate).not.toHaveBeenCalled()
      expect(mocks.resolveMessageThread).not.toHaveBeenCalled()
      expect(mocks.createProNotification).not.toHaveBeenCalled()
    })

    it('refuses when the pro has no active offering for the service', async () => {
      mocks.loadWaitlistHostability.mockResolvedValue({
        ok: false,
        refusal: { kind: 'NO_ACTIVE_OFFERING' },
      })

      const res = await POST(
        postRequest({
          professionalId: 'pro-1',
          serviceId: 'svc-1',
          preferenceType: 'ANY_TIME',
        }),
      )

      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.message).toContain('not currently offering this service')
      expect(mocks.waitlistCreate).not.toHaveBeenCalled()
    })

    it('is checked with the pro + service actually requested', async () => {
      await POST(
        postRequest({
          professionalId: 'pro-9',
          serviceId: 'svc-9',
          preferenceType: 'ANY_TIME',
        }),
      )

      expect(mocks.loadWaitlistHostability).toHaveBeenCalledWith({
        professionalId: 'pro-9',
        serviceId: 'svc-9',
      })
    })
  })
})

describe('DELETE /api/v1/waitlist', () => {
  function deleteRequest(id = 'wl-1'): Request {
    return new Request(`https://example.test/api/v1/waitlist?id=${id}`, {
      method: 'DELETE',
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client-1',
      user: { id: 'user-1' },
    })
    mocks.enforceRateLimit.mockResolvedValue(ALLOWED)
    mocks.waitlistFindUnique.mockResolvedValue({
      id: 'wl-1',
      clientId: 'client-1',
      status: 'NOTIFIED',
    })
  })

  // The pro's WAITLIST_CLIENT_LEFT row is enqueued inside the boundary's
  // transaction; without the kick it would sit until the next cron tick. The
  // route cannot know a notification happened except from this flag, which is
  // exactly why the boundary returns it.
  it('kicks the notification drain when the boundary notified the pro', async () => {
    mocks.cancelClientWaitlistEntry.mockResolvedValue({
      cancelled: true,
      releasedOffers: 1,
      notifiedProfessional: true,
    })

    const res = await DELETE(deleteRequest())

    expect(res.status).toBe(200)
    expect(mocks.kickNotificationDrain).toHaveBeenCalledTimes(1)
  })

  // The silent branch: a client leaving with no live offer enqueues nothing, so
  // there is nothing to drain. Asserted because a kick here would be the tell
  // that the route stopped reading the flag and started firing unconditionally.
  it('does NOT kick when the client left with no live offer', async () => {
    mocks.cancelClientWaitlistEntry.mockResolvedValue({
      cancelled: true,
      releasedOffers: 0,
      notifiedProfessional: false,
    })

    const res = await DELETE(deleteRequest())

    expect(res.status).toBe(200)
    expect(mocks.kickNotificationDrain).not.toHaveBeenCalled()
  })

  it('is a silent 200 for an already-cancelled entry, without touching the boundary', async () => {
    mocks.waitlistFindUnique.mockResolvedValue({
      id: 'wl-1',
      clientId: 'client-1',
      status: 'CANCELLED',
    })

    const res = await DELETE(deleteRequest())

    expect(res.status).toBe(200)
    expect(mocks.cancelClientWaitlistEntry).not.toHaveBeenCalled()
    expect(mocks.kickNotificationDrain).not.toHaveBeenCalled()
  })

  it('403s another client’s entry without reaching the boundary', async () => {
    mocks.waitlistFindUnique.mockResolvedValue({
      id: 'wl-1',
      clientId: 'someone-else',
      status: 'NOTIFIED',
    })

    const res = await DELETE(deleteRequest())

    expect(res.status).toBe(403)
    expect(mocks.cancelClientWaitlistEntry).not.toHaveBeenCalled()
  })
})
