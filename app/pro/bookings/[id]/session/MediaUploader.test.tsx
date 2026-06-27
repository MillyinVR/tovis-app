import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRefresh = vi.hoisted(() => vi.fn())

const mocks = vi.hoisted(() => ({
  processImageForUpload: vi.fn(),
  uploadWithProgress: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}))

// MediaFill pulls in next/image + video machinery we don't need here; a thin
// stand-in is enough to assert that a preview rendered.
vi.mock('@/app/_components/media/MediaFill', () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    React.createElement('img', { 'data-testid': 'media-fill', src, alt }),
}))

vi.mock('@/lib/media/processImageForUpload', () => ({
  processImageForUpload: mocks.processImageForUpload,
  formatBytes: (bytes: number) => `${bytes}B`,
}))

vi.mock('@/lib/media/uploadWithProgress', () => ({
  uploadWithProgress: mocks.uploadWithProgress,
}))

import MediaUploader from './MediaUploader'

const SIGN_URL = '/api/v1/pro/uploads'
const MEDIA_URL = '/api/v1/pro/bookings/booking_1/media'

function jsonResponse(payload: unknown, ok = true): Response {
  return new Response(JSON.stringify(payload), {
    status: ok ? 200 : 400,
    headers: { 'content-type': 'application/json' },
  })
}

function signOk() {
  return jsonResponse({
    ok: true,
    kind: 'CONSULT_PRIVATE',
    bucket: 'media-private',
    path: 'bookings/booking_1/before/main.jpg',
    token: 'signed-token',
    signedUrl: 'https://storage.example/signed-put',
    publicUrl: null,
    isPublic: false,
    cacheBuster: null,
    uploadSessionId: 'us_1',
  })
}

function makeImageFile(name = 'before.jpg', sizeBytes?: number): File {
  const file = new File(['fake-image-bytes'], name, { type: 'image/jpeg' })
  if (typeof sizeBytes === 'number') {
    Object.defineProperty(file, 'size', { value: sizeBytes })
  }
  return file
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(/upload (before|after) media/i)
}

/**
 * Routes the three-step upload pipeline. The PUT to storage is handled by the
 * mocked uploadWithProgress, so only the sign + register calls hit fetch.
 */
function mockFetch() {
  return vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url === SIGN_URL) return Promise.resolve(signOk())
    if (url === MEDIA_URL) {
      return Promise.resolve(jsonResponse({ ok: true, id: 'media_1' }))
    }

    throw new Error(`Unexpected fetch: ${url}`)
  })
}

describe('MediaUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // jsdom has no object-URL support; the component guards it, but stubbing
    // lets the preview render so we can assert on it.
    vi.stubGlobal(
      'URL',
      Object.assign(globalThis.URL, {
        createObjectURL: vi.fn(() => 'blob:preview'),
        revokeObjectURL: vi.fn(),
      }),
    )

    // Identity compression: hand back the same file, no size win so no note.
    mocks.processImageForUpload.mockImplementation((file: File) =>
      Promise.resolve({
        file,
        originalBytes: file.size,
        processedBytes: file.size,
      }),
    )

    mocks.uploadWithProgress.mockImplementation(
      (args: { onProgress: (n: number) => void }) => {
        args.onProgress(100)
        return Promise.resolve({ error: null })
      },
    )
  })

  it('shows no manual upload button at idle', () => {
    render(<MediaUploader bookingId="booking_1" phase="BEFORE" />)

    expect(
      screen.queryByRole('button', { name: /upload/i }),
    ).not.toBeInTheDocument()
  })

  it('auto-uploads the moment a file is selected — no button press', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    render(<MediaUploader bookingId="booking_1" phase="BEFORE" />)

    await userEvent.upload(fileInput(), makeImageFile())

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })

    expect(mocks.processImageForUpload).toHaveBeenCalledTimes(1)
    expect(mocks.uploadWithProgress).toHaveBeenCalledTimes(1)

    const signCall = fetchMock.mock.calls.find(([u]) => u === SIGN_URL)
    expect(signCall).toBeDefined()

    const registerCall = fetchMock.mock.calls.find(([u]) => u === MEDIA_URL)
    expect(registerCall).toBeDefined()

    const body = JSON.parse(String(registerCall?.[1]?.body)) as Record<
      string,
      unknown
    >
    expect(body).toMatchObject({
      uploadSessionId: 'us_1',
      mediaType: 'IMAGE',
      phase: 'BEFORE',
    })
  })

  it('attaches the typed caption and the AFTER phase to the register call', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    render(<MediaUploader bookingId="booking_1" phase="AFTER" />)

    await userEvent.type(
      screen.getByPlaceholderText(/after: blended caramel/i),
      'Glossy finish',
    )

    await userEvent.upload(fileInput(), makeImageFile())

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })

    const registerCall = fetchMock.mock.calls.find(([u]) => u === MEDIA_URL)
    const body = JSON.parse(String(registerCall?.[1]?.body)) as Record<
      string,
      unknown
    >
    expect(body.caption).toBe('Glossy finish')
    expect(body.phase).toBe('AFTER')
  })

  it('keeps the file and surfaces a Retry when the upload fails', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    mocks.uploadWithProgress.mockResolvedValueOnce({
      error: 'Upload failed (500).',
    })

    render(<MediaUploader bookingId="booking_1" phase="BEFORE" />)

    await userEvent.upload(fileInput(), makeImageFile())

    // Error is shown, the register call never happened, and the file is kept.
    await waitFor(() => {
      expect(screen.getByText('Upload failed (500).')).toBeInTheDocument()
    })

    expect(fetchMock.mock.calls.some(([u]) => u === MEDIA_URL)).toBe(false)
    expect(mockRefresh).not.toHaveBeenCalled()
    // On failure the preview shows an error state (file kept for retry), not a
    // blob preview / "Missing media".
    expect(
      screen.getByText('Upload failed — retry below.'),
    ).toBeInTheDocument()

    const retry = screen.getByRole('button', { name: /retry upload/i })
    expect(retry).toBeInTheDocument()

    // Retry now succeeds (default mock) and completes the pipeline.
    await userEvent.click(retry)

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })

    expect(fetchMock.mock.calls.some(([u]) => u === MEDIA_URL)).toBe(true)
  })

  it('does not start an upload for an image over the source ceiling', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    render(<MediaUploader bookingId="booking_1" phase="BEFORE" />)

    // 76MB image — over the 75MB source ceiling (too big even to compress).
    const tooBig = makeImageFile('huge.jpg', 76 * 1024 * 1024)
    await userEvent.upload(fileInput(), tooBig)

    expect(screen.getByText(/over the 75MB limit/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.uploadWithProgress).not.toHaveBeenCalled()
  })

  it('uploads a large image that compresses under the cap', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    // 26MB original (was previously rejected outright) — compression brings it
    // under the server cap, so the full pipeline now runs.
    mocks.processImageForUpload.mockImplementationOnce((file: File) =>
      Promise.resolve({
        file: makeImageFile('compressed.jpg', 4 * 1024 * 1024),
        originalBytes: file.size,
        processedBytes: 4 * 1024 * 1024,
      }),
    )

    render(<MediaUploader bookingId="booking_1" phase="BEFORE" />)

    await userEvent.upload(
      fileInput(),
      makeImageFile('big.jpg', 26 * 1024 * 1024),
    )

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })

    expect(fetchMock.mock.calls.some(([u]) => u === MEDIA_URL)).toBe(true)
  })

  it('blocks an image whose compressed output still exceeds the cap', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    // Compression failed (component keeps the original); a 31MB original is
    // over the 30MB server cap, so we stop client-side with a clear message
    // rather than letting the signing route 400.
    mocks.processImageForUpload.mockRejectedValueOnce(new Error('decode failed'))

    render(<MediaUploader bookingId="booking_1" phase="BEFORE" />)

    await userEvent.upload(
      fileInput(),
      makeImageFile('raw.jpg', 31 * 1024 * 1024),
    )

    await waitFor(() => {
      expect(screen.getByText(/over the 30MB limit/i)).toBeInTheDocument()
    })
    expect(fetchMock.mock.calls.some(([u]) => u === SIGN_URL)).toBe(false)
    expect(mocks.uploadWithProgress).not.toHaveBeenCalled()
  })

  it('derives a distinct idempotency key per uploaded object', async () => {
    const paths = [
      'bookings/booking_1/after/one.jpg',
      'bookings/booking_1/after/two.jpg',
    ]
    let signCall = 0

    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === SIGN_URL) {
        const path = paths[signCall] ?? paths[paths.length - 1]
        signCall += 1
        return Promise.resolve(
          jsonResponse({
            ok: true,
            kind: 'CONSULT_PRIVATE',
            bucket: 'media-private',
            path,
            token: 'signed-token',
            signedUrl: 'https://storage.example/signed-put',
            publicUrl: null,
            isPublic: false,
            cacheBuster: null,
          }),
        )
      }
      if (url === MEDIA_URL) {
        return Promise.resolve(jsonResponse({ ok: true, id: 'media_1' }))
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<MediaUploader bookingId="booking_1" phase="AFTER" />)

    await userEvent.upload(fileInput(), makeImageFile('a.jpg'))
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))

    await userEvent.upload(fileInput(), makeImageFile('b.jpg'))
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(2))

    const keys = fetchMock.mock.calls
      .filter(([u]) => u === MEDIA_URL)
      .map(([, init]) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        return headers['Idempotency-Key']
      })

    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    // Two distinct uploaded objects must not collide on the same key — the bug
    // that surfaced as "idempotency key already used with a different request
    // body" when uploading a second after-photo.
    expect(keys[0]).not.toBe(keys[1])
  })
})
