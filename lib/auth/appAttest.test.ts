import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  computeRegistrationClientDataHash,
  extractNonceExtension,
  isNativeRegisterRequest,
  parseAuthData,
  verifyAppAttestAttestation,
  verifyNativeRegistrationGateOrFailOpen,
} from './appAttest'
import {
  FIXTURE_APP_ID,
  FIXTURE_ATTESTATION_B64,
  FIXTURE_CLIENT_DATA_HASH_B64,
  FIXTURE_EMAIL,
  FIXTURE_KEY_ID,
  FIXTURE_PHONE,
  FIXTURE_ROOT_CA_PEM,
  FIXTURE_TIMESTAMP,
} from './appAttest.fixtures'

const clientDataHash = Buffer.from(FIXTURE_CLIENT_DATA_HASH_B64, 'base64')

function validArgs() {
  return {
    attestationBase64: FIXTURE_ATTESTATION_B64,
    keyId: FIXTURE_KEY_ID,
    clientDataHash,
    appId: FIXTURE_APP_ID,
    rootCaPem: FIXTURE_ROOT_CA_PEM,
    allowDevelopment: true,
  }
}

describe('verifyAppAttestAttestation', () => {
  it('accepts a valid attestation and returns the key id', () => {
    const result = verifyAppAttestAttestation(validArgs())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.keyId.toString('base64')).toBe(FIXTURE_KEY_ID)
    }
  })

  it('rejects when the chain does not anchor to the pinned root (real Apple root)', () => {
    // Omitting rootCaPem falls back to the pinned Apple root, which did not sign
    // this throwaway fixture chain.
    const { rootCaPem, ...rest } = validArgs()
    void rootCaPem
    const result = verifyAppAttestAttestation(rest)
    expect(result.ok).toBe(false)
  })

  it('rejects a wrong app id (rpIdHash mismatch)', () => {
    const result = verifyAppAttestAttestation({
      ...validArgs(),
      appId: '9999999999.com.someone.else',
    })
    expect(result).toEqual({ ok: false, reason: 'rpid_mismatch' })
  })

  it('rejects a clientDataHash the attestation was not bound to (nonce mismatch)', () => {
    const result = verifyAppAttestAttestation({
      ...validArgs(),
      clientDataHash: crypto.createHash('sha256').update('different').digest(),
    })
    expect(result).toEqual({ ok: false, reason: 'nonce_mismatch' })
  })

  it('rejects a key id that does not match the attested key', () => {
    const result = verifyAppAttestAttestation({
      ...validArgs(),
      keyId: crypto.randomBytes(32).toString('base64'),
    })
    expect(result).toEqual({ ok: false, reason: 'keyid_mismatch' })
  })

  it('rejects the development aaguid when development is not allowed', () => {
    const result = verifyAppAttestAttestation({
      ...validArgs(),
      allowDevelopment: false,
    })
    expect(result).toEqual({ ok: false, reason: 'bad_aaguid' })
  })

  it('rejects empty / garbage attestation bytes', () => {
    expect(verifyAppAttestAttestation({ ...validArgs(), attestationBase64: '' }).ok).toBe(false)
    expect(
      verifyAppAttestAttestation({ ...validArgs(), attestationBase64: 'bm90LWNib3I=' }).ok,
    ).toBe(false)
  })
})

describe('parseAuthData', () => {
  it('slices the fixed authenticator-data layout', () => {
    const rpIdHash = crypto.randomBytes(32)
    const aaguid = Buffer.from('appattestdevelop', 'ascii')
    const credId = crypto.randomBytes(32)
    const authData = Buffer.concat([
      rpIdHash,
      Buffer.from([0x40]), // flags
      Buffer.from([0, 0, 0, 0]), // signCount
      aaguid,
      Buffer.from([0x00, 0x20]), // credId length
      credId,
    ])
    const parsed = parseAuthData(authData)
    expect(parsed).not.toBeNull()
    expect(parsed?.rpIdHash.equals(rpIdHash)).toBe(true)
    expect(parsed?.signCount).toBe(0)
    expect(parsed?.aaguid.equals(aaguid)).toBe(true)
    expect(parsed?.credId.equals(credId)).toBe(true)
  })

  it('returns null when the buffer is too short for the credential id', () => {
    const truncated = Buffer.concat([
      crypto.randomBytes(37),
      Buffer.from([0x00, 0x20]), // claims 32-byte credId that isn't there
    ])
    expect(parseAuthData(truncated)).toBeNull()
  })
})

describe('extractNonceExtension', () => {
  it('returns null for a certificate without the App Attest extension', () => {
    // The pinned Apple root has no nonce extension.
    const der = new crypto.X509Certificate(FIXTURE_ROOT_CA_PEM).raw
    expect(extractNonceExtension(der)).toBeNull()
  })
})

describe('computeRegistrationClientDataHash', () => {
  it('is deterministic and matches the fixture derivation', () => {
    const hash = computeRegistrationClientDataHash({
      email: FIXTURE_EMAIL,
      phone: FIXTURE_PHONE,
      timestamp: FIXTURE_TIMESTAMP,
    })
    expect(hash.equals(clientDataHash)).toBe(true)
  })

  it('changes when any input changes', () => {
    const base = computeRegistrationClientDataHash({
      email: 'a@b.com',
      phone: '+1',
      timestamp: 1,
    })
    const other = computeRegistrationClientDataHash({
      email: 'a@b.com',
      phone: '+1',
      timestamp: 2,
    })
    expect(base.equals(other)).toBe(false)
  })
})

describe('isNativeRegisterRequest', () => {
  const req = (headers: Record<string, string>) =>
    new Request('https://x.test', { headers })

  it('is true only when X-Tovis-Native: ios is present', () => {
    expect(isNativeRegisterRequest(req({ 'x-tovis-native': 'ios' }))).toBe(true)
    expect(isNativeRegisterRequest(req({ 'X-Tovis-Native': 'IOS' }))).toBe(true)
    expect(isNativeRegisterRequest(req({}))).toBe(false)
    expect(isNativeRegisterRequest(req({ 'x-tovis-native': 'android' }))).toBe(false)
  })
})

describe('verifyNativeRegistrationGateOrFailOpen', () => {
  const envKeys = [
    'AUTH_APP_ATTEST_FAIL_OPEN',
    'APPLE_APP_ATTEST_APP_ID',
    'APPLE_APP_ATTEST_ROOT_CA_PEM',
    'APPLE_APP_ATTEST_ALLOW_DEVELOPMENT',
    'VERCEL_ENV',
  ] as const
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of envKeys) saved[k] = process.env[k]
    for (const k of envKeys) delete process.env[k]
  })
  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    vi.useRealTimers()
  })

  const freshAtt = () => ({
    keyId: FIXTURE_KEY_ID,
    attestation: FIXTURE_ATTESTATION_B64,
    timestamp: Date.now(),
  })

  it('fails closed when no attestation and fail-open is off', async () => {
    const result = await verifyNativeRegistrationGateOrFailOpen({
      appAttest: null,
      email: 'a@b.com',
      phone: '+1',
    })
    expect(result).toEqual({
      ok: false,
      code: 'APP_ATTEST_REQUIRED',
      message: expect.any(String),
    })
  })

  it('fails open (dev only) when no attestation and the escape hatch is set', async () => {
    process.env.AUTH_APP_ATTEST_FAIL_OPEN = '1'
    const result = await verifyNativeRegistrationGateOrFailOpen({
      appAttest: null,
      email: 'a@b.com',
      phone: '+1',
    })
    expect(result).toEqual({ ok: true, failOpen: true, reason: 'no_attestation_dev' })
  })

  it('rejects a malformed attestation payload', async () => {
    const result = await verifyNativeRegistrationGateOrFailOpen({
      appAttest: { keyId: 'x' }, // missing attestation + timestamp
      email: 'a@b.com',
      phone: '+1',
    })
    expect(result).toMatchObject({ ok: false, code: 'APP_ATTEST_MALFORMED' })
  })

  it('rejects a stale timestamp', async () => {
    const result = await verifyNativeRegistrationGateOrFailOpen({
      appAttest: {
        keyId: FIXTURE_KEY_ID,
        attestation: FIXTURE_ATTESTATION_B64,
        timestamp: Date.now() - 10 * 60 * 1000,
      },
      email: 'a@b.com',
      phone: '+1',
    })
    expect(result).toMatchObject({ ok: false, code: 'APP_ATTEST_STALE' })
  })

  it('reports unavailable when the app id is unconfigured and no fail-open', async () => {
    const result = await verifyNativeRegistrationGateOrFailOpen({
      appAttest: freshAtt(),
      email: 'a@b.com',
      phone: '+1',
    })
    expect(result).toMatchObject({ ok: false, code: 'APP_ATTEST_UNAVAILABLE' })
  })

  it('rejects a valid attestation bound to a different identity', async () => {
    process.env.APPLE_APP_ATTEST_APP_ID = FIXTURE_APP_ID
    process.env.APPLE_APP_ATTEST_ROOT_CA_PEM = FIXTURE_ROOT_CA_PEM
    // Fresh clock + correct crypto, but the email doesn't match what the nonce
    // was bound to — so the recomputed clientDataHash (and nonce) won't match.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FIXTURE_TIMESTAMP + 1000))
    const result = await verifyNativeRegistrationGateOrFailOpen({
      appAttest: {
        keyId: FIXTURE_KEY_ID,
        attestation: FIXTURE_ATTESTATION_B64,
        timestamp: FIXTURE_TIMESTAMP,
      },
      email: 'someone-else@example.com',
      phone: FIXTURE_PHONE,
    })
    expect(result).toMatchObject({ ok: false, code: 'APP_ATTEST_INVALID' })
  })

  it('accepts a valid attestation bound to the registering identity', async () => {
    process.env.APPLE_APP_ATTEST_APP_ID = FIXTURE_APP_ID
    process.env.APPLE_APP_ATTEST_ROOT_CA_PEM = FIXTURE_ROOT_CA_PEM
    // Pin the clock just inside the freshness window around the fixture timestamp.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FIXTURE_TIMESTAMP + 1000))
    const result = await verifyNativeRegistrationGateOrFailOpen({
      appAttest: {
        keyId: FIXTURE_KEY_ID,
        attestation: FIXTURE_ATTESTATION_B64,
        timestamp: FIXTURE_TIMESTAMP,
      },
      email: FIXTURE_EMAIL,
      phone: FIXTURE_PHONE,
    })
    expect(result).toEqual({ ok: true, failOpen: false })
  })
})
