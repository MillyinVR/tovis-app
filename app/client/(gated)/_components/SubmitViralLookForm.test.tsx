// The submit sequence is three round-trips that can each fail on their own:
// create the request, PUT the bytes, then record the URL on the request. What
// these tests pin down is the part no type checks: a retry must not submit the
// look a second time for an admin to moderate twice.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRefresh = vi.hoisted(() => vi.fn())

const mocks = vi.hoisted(() => ({
  uploadWithProgress: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/lib/media/processImageForUpload', () => ({
  compressImageForUpload: vi.fn(async (file: File) => file),
}))

vi.mock('@/lib/media/uploadWithProgress', () => ({
  uploadWithProgress: mocks.uploadWithProgress,
}))

import SubmitViralLookForm from './SubmitViralLookForm'

const CREATE_URL = '/api/v1/viral-service-requests'
const SIGN_URL = '/api/v1/viral-service-requests/upload'
const PERSIST_URL = '/api/v1/viral-service-requests/request_1'
const PUBLIC_URL =
  'https://project.supabase.co/storage/v1/object/public/media-public/viral-requests/request_1/uploads/inspo.jpg'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeImageFile(name = 'inspo.jpg', sizeBytes?: number): File {
  const file = new File(['bytes'], name, { type: 'image/jpeg' })
  if (typeof sizeBytes === 'number') {
    Object.defineProperty(file, 'size', { value: sizeBytes })
  }
  return file
}

type FetchCall = { url: string; init: RequestInit | undefined }

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => Response,
): FetchCall[] {
  const calls: FetchCall[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      calls.push({ url, init })
      return handler(url, init)
    }),
  )

  return calls
}

function bodyOf(call: FetchCall | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body ?? '{}'))
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(/name this look/i), 'Wolf cut')
  await user.click(screen.getByRole('button', { name: /submit for review/i }))
}

describe('SubmitViralLookForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mocks.uploadWithProgress.mockResolvedValue({ error: null })
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('submits without a file in a single round-trip', async () => {
    const user = userEvent.setup()
    const calls = installFetch(() =>
      jsonResponse({ ok: true, request: { id: 'request_1' } }, 201),
    )

    render(<SubmitViralLookForm />)
    await fillAndSubmit(user)

    await waitFor(() =>
      expect(screen.getByText(/our team is reviewing it now/i)).toBeTruthy(),
    )

    expect(calls.map((call) => call.url)).toEqual([CREATE_URL])
    expect(mocks.uploadWithProgress).not.toHaveBeenCalled()
  })

  it('creates the request, uploads the file, then records the URL on it', async () => {
    const user = userEvent.setup()
    const calls = installFetch((url) => {
      if (url === CREATE_URL) {
        return jsonResponse({ ok: true, request: { id: 'request_1' } }, 201)
      }
      if (url === SIGN_URL) {
        return jsonResponse({
          ok: true,
          bucket: 'media-public',
          path: 'viral-requests/request_1/uploads/inspo.jpg',
          token: 'token_123',
          publicUrl: PUBLIC_URL,
        })
      }
      return jsonResponse({ ok: true, request: { id: 'request_1' } })
    })

    render(<SubmitViralLookForm />)
    await user.upload(
      screen.getByLabelText(/add a photo or video/i),
      makeImageFile(),
    )
    await fillAndSubmit(user)

    await waitFor(() =>
      expect(screen.getByText(/submitted with your file/i)).toBeTruthy(),
    )

    expect(calls.map((call) => call.url)).toEqual([
      CREATE_URL,
      SIGN_URL,
      PERSIST_URL,
    ])

    // The signing route is asked for THIS request's folder…
    expect(bodyOf(calls[1])).toMatchObject({
      requestId: 'request_1',
      fileName: 'inspo.jpg',
      contentType: 'image/jpeg',
    })

    // …the PUT goes to the pointer it minted…
    expect(mocks.uploadWithProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'media-public',
        path: 'viral-requests/request_1/uploads/inspo.jpg',
        token: 'token_123',
      }),
    )

    // …and only the URL it handed back is persisted.
    expect(calls[2]?.init?.method).toBe('PATCH')
    expect(bodyOf(calls[2])).toEqual({ mediaUrl: PUBLIC_URL })
  })

  it('resumes at the failed leg instead of submitting the look twice', async () => {
    const user = userEvent.setup()
    let persistShouldFail = true

    const calls = installFetch((url) => {
      if (url === CREATE_URL) {
        return jsonResponse({ ok: true, request: { id: 'request_1' } }, 201)
      }
      if (url === SIGN_URL) {
        return jsonResponse({
          ok: true,
          bucket: 'media-public',
          path: 'viral-requests/request_1/uploads/inspo.jpg',
          token: 'token_123',
          publicUrl: PUBLIC_URL,
        })
      }
      if (persistShouldFail) {
        persistShouldFail = false
        return jsonResponse({ ok: false, error: 'Storage hiccup.' }, 500)
      }
      return jsonResponse({ ok: true, request: { id: 'request_1' } })
    })

    render(<SubmitViralLookForm />)
    await user.upload(
      screen.getByLabelText(/add a photo or video/i),
      makeImageFile(),
    )
    await fillAndSubmit(user)

    // The look IS submitted — the copy has to say so, or "try again" reads as
    // "nothing was saved".
    await waitFor(() =>
      expect(screen.getByText(/your look is submitted/i)).toBeTruthy(),
    )

    // …and a 5xx body never reaches the client: the signing route's own 500s
    // carry storage hostnames.
    expect(screen.queryByText(/storage hiccup/i)).toBeNull()
    expect(screen.getByText(/couldn’t attach your file/i)).toBeTruthy()
    expect(calls.map((call) => call.url)).toEqual([
      CREATE_URL,
      SIGN_URL,
      PERSIST_URL,
    ])

    await user.click(screen.getByRole('button', { name: /attach/i }))

    await waitFor(() =>
      expect(screen.getByText(/submitted with your file/i)).toBeTruthy(),
    )

    // No second create, and no second PUT — the bytes are already up there.
    expect(calls.map((call) => call.url)).toEqual([
      CREATE_URL,
      SIGN_URL,
      PERSIST_URL,
      PERSIST_URL,
    ])
    expect(mocks.uploadWithProgress).toHaveBeenCalledTimes(1)
  })

  it('refuses a file over the upload cap before anything is submitted', async () => {
    const user = userEvent.setup()
    const calls = installFetch(() => jsonResponse({ ok: true }))

    render(<SubmitViralLookForm />)
    await user.upload(
      screen.getByLabelText(/add a photo or video/i),
      makeImageFile('huge.jpg', 31 * 1024 * 1024),
    )

    await waitFor(() => expect(screen.getByText(/over 30MB/i)).toBeTruthy())
    expect(calls).toHaveLength(0)
  })
})
