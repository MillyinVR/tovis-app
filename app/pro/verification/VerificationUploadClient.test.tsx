import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VerificationDocumentType } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRefresh = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}))

import VerificationUploadClient, {
  type VerificationMethodOption,
} from './VerificationUploadClient'

const METHODS: VerificationMethodOption[] = [
  {
    type: VerificationDocumentType.LICENSE,
    title: 'State license',
    description: 'A clear photo of your license.',
  },
  {
    type: VerificationDocumentType.ID_CARD,
    title: 'Government ID',
    description: 'A government-issued photo ID.',
  },
]

function jsonResponse(payload: unknown, ok = true): Response {
  return new Response(JSON.stringify(payload), {
    status: ok ? 200 : 400,
    headers: { 'content-type': 'application/json' },
  })
}

function makeImageFile(name = 'license.jpg'): File {
  return new File(['fake-image-bytes'], name, { type: 'image/jpeg' })
}

function fileInput(): HTMLInputElement {
  const input = screen.getByLabelText<HTMLInputElement>(
    'Verification document photo',
  )
  return input
}

function mockUploadFlowFetch() {
  return vi
    .fn()
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/pro/uploads') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            signedUrl: 'https://storage.example/signed-put',
            bucket: 'media-private',
            path: 'pro/pro_1/verify_private/2026-06/123_abc.jpg',
          }),
        )
      }

      if (url === 'https://storage.example/signed-put') {
        expect(init?.method).toBe('PUT')
        return Promise.resolve(new Response(null, { status: 200 }))
      }

      if (url === '/api/pro/verification-docs') {
        return Promise.resolve(jsonResponse({ ok: true, id: 'doc_1' }))
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
}

describe('VerificationUploadClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders one selectable option per verification method', () => {
    render(<VerificationUploadClient methods={METHODS} />)

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)

    expect(screen.getByText('State license')).toBeInTheDocument()
    expect(screen.getByText('Government ID')).toBeInTheDocument()

    // First method is selected by default.
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    expect(radios[1]).toHaveAttribute('aria-checked', 'false')
  })

  it('renders nothing when no methods are available', () => {
    const { container } = render(<VerificationUploadClient methods={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('uploads using the default method type', async () => {
    const fetchMock = mockUploadFlowFetch()
    vi.stubGlobal('fetch', fetchMock)

    render(<VerificationUploadClient methods={METHODS} />)

    await userEvent.upload(fileInput(), makeImageFile())

    await waitFor(() => {
      expect(screen.getByText(/Uploaded/)).toBeInTheDocument()
    })

    const createCall = fetchMock.mock.calls.find(
      ([url]) => url === '/api/pro/verification-docs',
    )
    expect(createCall).toBeDefined()

    const body = JSON.parse(String(createCall?.[1]?.body)) as Record<
      string,
      unknown
    >
    expect(body).toEqual({
      type: VerificationDocumentType.LICENSE,
      label: 'State license (pro upload)',
      url: 'supabase://media-private/pro/pro_1/verify_private/2026-06/123_abc.jpg',
    })

    expect(mockRefresh).toHaveBeenCalled()
  })

  it('uploads with the selected method type after switching', async () => {
    const fetchMock = mockUploadFlowFetch()
    vi.stubGlobal('fetch', fetchMock)

    render(<VerificationUploadClient methods={METHODS} />)

    await userEvent.click(screen.getByRole('radio', { name: /Government ID/ }))

    expect(
      screen.getByRole('radio', { name: /Government ID/ }),
    ).toHaveAttribute('aria-checked', 'true')

    await userEvent.upload(fileInput(), makeImageFile('id.jpg'))

    await waitFor(() => {
      expect(screen.getByText(/Uploaded/)).toBeInTheDocument()
    })

    const createCall = fetchMock.mock.calls.find(
      ([url]) => url === '/api/pro/verification-docs',
    )
    const body = JSON.parse(String(createCall?.[1]?.body)) as Record<
      string,
      unknown
    >
    expect(body.type).toBe(VerificationDocumentType.ID_CARD)
    expect(body.label).toBe('Government ID (pro upload)')
  })

  it('rejects non-image files without calling the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<VerificationUploadClient methods={METHODS} />)

    const pdf = new File(['fake-pdf'], 'license.pdf', {
      type: 'application/pdf',
    })

    // applyAccept: false — the accept="image/*" attribute would make
    // userEvent skip the file entirely; we want to exercise the JS guard.
    await userEvent.upload(fileInput(), pdf, { applyAccept: false })

    await waitFor(() => {
      expect(
        screen.getByText('Please upload an image file (jpg, png, etc.).'),
      ).toBeInTheDocument()
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('shows the API error when the upload cannot start', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ ok: false, error: 'Upload too large.' }, false),
      )
    vi.stubGlobal('fetch', fetchMock)

    render(<VerificationUploadClient methods={METHODS} />)

    await userEvent.upload(fileInput(), makeImageFile())

    await waitFor(() => {
      expect(screen.getByText('Upload too large.')).toBeInTheDocument()
    })

    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
