import { describe, expect, it } from 'vitest'

import {
  WORKSPACE_MISMATCH_CODE,
  canReplayRequest,
  parseWorkspaceMismatch,
} from './mismatch'

describe('parseWorkspaceMismatch', () => {
  it('returns the target workspace for a tagged 403', () => {
    expect(
      parseWorkspaceMismatch(403, {
        ok: false,
        code: WORKSPACE_MISMATCH_CODE,
        requiredWorkspace: 'CLIENT',
      }),
    ).toBe('CLIENT')
  })

  it('ignores non-403 responses', () => {
    expect(
      parseWorkspaceMismatch(200, {
        code: WORKSPACE_MISMATCH_CODE,
        requiredWorkspace: 'CLIENT',
      }),
    ).toBeNull()
  })

  it('ignores 403s without the workspace-mismatch code', () => {
    expect(
      parseWorkspaceMismatch(403, { ok: false, error: 'Forbidden' }),
    ).toBeNull()
    expect(
      parseWorkspaceMismatch(403, {
        code: 'VERIFICATION_REQUIRED',
      }),
    ).toBeNull()
  })

  it('rejects an unknown / missing requiredWorkspace', () => {
    expect(
      parseWorkspaceMismatch(403, {
        code: WORKSPACE_MISMATCH_CODE,
        requiredWorkspace: 'SUPERUSER',
      }),
    ).toBeNull()
    expect(
      parseWorkspaceMismatch(403, { code: WORKSPACE_MISMATCH_CODE }),
    ).toBeNull()
  })

  it('tolerates non-object bodies', () => {
    expect(parseWorkspaceMismatch(403, null)).toBeNull()
    expect(parseWorkspaceMismatch(403, 'nope')).toBeNull()
    expect(parseWorkspaceMismatch(403, undefined)).toBeNull()
  })
})

describe('canReplayRequest', () => {
  it('replays a string URL with a JSON-string body (the common mutation)', () => {
    expect(
      canReplayRequest('/api/v1/looks/1/save', {
        method: 'POST',
        body: JSON.stringify({ boardId: 'b1' }),
      }),
    ).toBe(true)
  })

  it('replays a bodyless request (e.g. GET / DELETE)', () => {
    expect(canReplayRequest('/api/v1/boards', { method: 'GET' })).toBe(true)
    expect(canReplayRequest('/api/v1/looks/1/save')).toBe(true)
    expect(new URL('https://x.test/api/v1/boards')).toBeTruthy()
    expect(canReplayRequest(new URL('https://x.test/api/v1/boards'))).toBe(true)
  })

  it('refuses to replay a Request object (its body stream is single-use)', () => {
    expect(canReplayRequest(new Request('https://x.test/api/v1/boards'))).toBe(
      false,
    )
  })

  it('refuses to replay non-string bodies (FormData / streams)', () => {
    const form = new FormData()
    form.append('file', 'x')
    expect(canReplayRequest('/api/uploads', { method: 'POST', body: form })).toBe(
      false,
    )
  })
})
