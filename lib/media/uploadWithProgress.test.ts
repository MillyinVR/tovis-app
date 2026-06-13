import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { uploadWithProgress } from '@/lib/media/uploadWithProgress'

// A minimal fake XMLHttpRequest that records what the uploader sent and lets
// the test drive the lifecycle (load / error / abort).
class FakeXHR {
  static instances: FakeXHR[] = []

  method = ''
  url = ''
  status = 0
  responseText = ''
  headers: Record<string, string> = {}
  sentBody: unknown = undefined

  upload = { addEventListener: () => {} }
  private listeners: Record<string, (e: unknown) => void> = {}

  constructor() {
    FakeXHR.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value
  }

  addEventListener(type: string, cb: (e: unknown) => void) {
    this.listeners[type] = cb
  }

  send(body: unknown) {
    this.sentBody = body
  }

  abort() {
    this.listeners['abort']?.(undefined)
  }

  // Test helpers
  emitLoad(status: number, responseText = '') {
    this.status = status
    this.responseText = responseText
    this.listeners['load']?.(undefined)
  }
}

function makeFile() {
  return new File([new Uint8Array([1, 2, 3])], 'after.jpg', {
    type: 'image/jpeg',
  })
}

function args(overrides: Partial<Parameters<typeof uploadWithProgress>[0]> = {}) {
  return {
    bucket: 'media-private',
    path: 'bookings/booking_1/after/2026/06/13/123_abc.jpg',
    token: 'signed-token-xyz',
    file: makeFile(),
    contentType: 'image/jpeg',
    onProgress: vi.fn(),
    signal: new AbortController().signal,
    ...overrides,
  }
}

describe('uploadWithProgress', () => {
  beforeEach(() => {
    FakeXHR.instances = []
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_anon_key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('uploads via PUT with the token as sole authorizer (not POST, no anon bearer)', async () => {
    const promise = uploadWithProgress(args())

    const xhr = FakeXHR.instances[0]
    if (!xhr) throw new Error('expected an XHR to be created')

    // The signed-upload endpoint only honors the token (and bypasses RLS) on PUT.
    // POST is treated as a normal anon insert and fails media-private's
    // deny-by-default INSERT RLS with "new row violates row-level security policy".
    expect(xhr.method).toBe('PUT')

    expect(xhr.url).toContain('/storage/v1/object/upload/sign/')
    expect(xhr.url).toContain('token=signed-token-xyz')

    // apikey is required for the API gateway to route the request...
    expect(xhr.headers['apikey']).toBe('sb_publishable_anon_key')
    // ...but Authorization must NOT be sent — the token is the authorizer.
    expect(xhr.headers['Authorization']).toBeUndefined()

    expect(xhr.headers['x-upsert']).toBe('false')

    xhr.emitLoad(200)
    await expect(promise).resolves.toEqual({ error: null })
  })

  it('surfaces the Supabase error message on a non-2xx response', async () => {
    const promise = uploadWithProgress(args())
    const xhr = FakeXHR.instances[0]
    if (!xhr) throw new Error('expected an XHR to be created')

    xhr.emitLoad(
      403,
      JSON.stringify({ message: 'new row violates row-level security policy' }),
    )

    await expect(promise).resolves.toEqual({
      error: 'new row violates row-level security policy',
    })
  })

  it('no-ops when the request is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      uploadWithProgress(args({ signal: controller.signal })),
    ).resolves.toEqual({ error: null })

    expect(FakeXHR.instances).toHaveLength(0)
  })
})
