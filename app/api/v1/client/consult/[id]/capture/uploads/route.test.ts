import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  issueConsultCaptureUpload: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))
vi.mock('@/lib/consult/captureContract', () => ({
  issueConsultCaptureUpload: mocks.issueConsultCaptureUpload,
}))

import { ConsultWriteError } from '@/lib/consult/errors'
import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new Request('http://test/api/v1/client/consult/consult_1/capture/uploads', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const validBody = {
  idempotencyKey: 'issue-1',
  shotKey: 'hair_back',
  shotPackVersion: 1,
  schemaVersion: 1,
  contentType: 'image/jpeg',
  sizeBytes: 100,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClient.mockResolvedValue({
    ok: true,
    clientId: 'client_1',
    user: { id: 'user_1' },
  })
})
describe('POST consult capture upload', () => {
  it('does not parse the request before the locked prerequisite boundary permits it', async () => {
    const req = request(validBody)
    const jsonSpy = vi.spyOn(req, 'json')
    mocks.issueConsultCaptureUpload.mockRejectedValue(
      new ConsultWriteError('AGREEMENTS_REQUIRED', 'stale evidence'),
    )

    const response = await POST(req, { params: { id: 'consult_1' } })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'CONSULT_PREREQUISITES_REQUIRED',
    })
    expect(jsonSpy).not.toHaveBeenCalled()
  })

  it('passes only bounded fields after the boundary invokes loadInput', async () => {
    mocks.issueConsultCaptureUpload.mockImplementation(async (args) => {
      expect(await args.loadInput()).toEqual({
        ...validBody,
        checksumSha256: null,
      })
      return {
        replayed: false,
        upload: {
          uploadSessionId: 'upload_1',
          shotKey: 'hair_back',
          shotPackVersion: 1,
          schemaVersion: 1,
          contentType: 'image/jpeg',
          maxBytes: 100,
          expiresAt: '2026-08-07T01:00:00.000Z',
          rawExpiresAt: '2026-08-08T00:00:00.000Z',
          token: 'signed-secret',
          signedUrl: 'https://storage.test/signed-secret',
        },
      }
    })
    const response = await POST(request(validBody), {
      params: { id: 'consult_1' },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      replayed: false,
      upload: { uploadSessionId: 'upload_1' },
    })
  })

  it('never reflects private paths, signed credentials, or provider details in errors or logs', async () => {
    mocks.issueConsultCaptureUpload.mockRejectedValue(
      new Error(
        'consult-raw/v1/private.jpg signed-secret anthropic-provider-detail',
      ),
    )
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await POST(request(validBody), {
      params: { id: 'consult_1' },
    })
    expect(response.status).toBe(500)
    const serialized = JSON.stringify({
      response: await response.json(),
      logs: errorLog.mock.calls,
    })
    expect(serialized).not.toContain('consult-raw')
    expect(serialized).not.toContain('signed-secret')
    expect(serialized).not.toContain('anthropic-provider-detail')
    errorLog.mockRestore()
  })
})
