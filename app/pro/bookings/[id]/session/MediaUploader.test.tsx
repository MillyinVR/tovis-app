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

const SIGN_URL = '/api/pro/uploads'
const MEDIA_URL = '/api/pro/bookings/booking_1/media'

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
      storageBucket: 'media-private',
      storagePath: 'bookings/booking_1/before/main.jpg',
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
    expect(screen.getByTestId('media-fill')).toBeInTheDocument()

    const retry = screen.getByRole('button', { name: /retry upload/i })
    expect(retry).toBeInTheDocument()

    // Retry now succeeds (default mock) and completes the pipeline.
    await userEvent.click(retry)

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })

    expect(fetchMock.mock.calls.some(([u]) => u === MEDIA_URL)).toBe(true)
  })

  it('does not start an upload for an over-limit file', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    render(<MediaUploader bookingId="booking_1" phase="BEFORE" />)

    // 26MB image — over the 25MB image limit.
    const tooBig = makeImageFile('huge.jpg', 26 * 1024 * 1024)
    await userEvent.upload(fileInput(), tooBig)

    expect(
      screen.getByText(/over the 25MB limit/i),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.uploadWithProgress).not.toHaveBeenCalled()
  })
})
