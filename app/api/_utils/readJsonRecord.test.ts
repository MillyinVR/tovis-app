import { describe, expect, it } from 'vitest'
import { readJsonRecord } from './readJsonRecord'

function jsonReq(body: string): Request {
  return new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

describe('readJsonRecord', () => {
  it('returns the parsed object for a JSON object body', async () => {
    await expect(readJsonRecord(jsonReq('{"a":1,"b":"x"}'))).resolves.toEqual({
      a: 1,
      b: 'x',
    })
  })

  it('returns {} for a malformed body', async () => {
    await expect(readJsonRecord(jsonReq('not json'))).resolves.toEqual({})
  })

  it('returns {} for a JSON array (not a record)', async () => {
    await expect(readJsonRecord(jsonReq('[1,2,3]'))).resolves.toEqual({})
  })

  it('returns {} for a JSON primitive', async () => {
    await expect(readJsonRecord(jsonReq('42'))).resolves.toEqual({})
    await expect(readJsonRecord(jsonReq('null'))).resolves.toEqual({})
  })

  it('returns {} when there is no body', async () => {
    await expect(
      readJsonRecord(new Request('http://localhost/x', { method: 'POST' })),
    ).resolves.toEqual({})
  })
})
