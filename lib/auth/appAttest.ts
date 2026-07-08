// lib/auth/appAttest.ts
//
// Verifies an Apple App Attest attestation (DeviceCheck App Attest) so a NATIVE
// client can register without solving a Cloudflare Turnstile captcha. Native
// apps can't render Turnstile, so instead of a bot-vs-human challenge we prove
// "a genuine, unmodified build of OUR app running on a real Apple device made
// this request" — a stronger signal for a native surface.
//
// Flow (see Apple's "Validating apps that connect to your server"):
//   - The app generates a fresh Secure-Enclave key per signup and attests it
//     over `clientDataHash = SHA256("<email>\n<phone>\n<timestampMs>")`.
//   - We recompute that hash from the SAME email/phone the request registers
//     with, so an attestation is cryptographically bound to THIS identity — it
//     can't be replayed for a different signup (the nonce won't match), and
//     replaying it for the same email/phone hits the duplicate-account guard.
//   - We verify the attestation's certificate chain up to Apple's App Attest
//     Root CA, the embedded nonce, the app id (rpIdHash), the sign counter, the
//     aaguid (production vs development), and that the key id matches the public
//     key. All of that has to hold or we reject.
//
// No new dependency: Node's `crypto` gives us X.509 chain verification and
// hashing; the small CBOR/DER readers below cover the constrained shapes App
// Attest actually emits.

import crypto, { X509Certificate, type KeyObject } from 'node:crypto'

import { readOptionalEnv, isDeployedRuntime } from '@/lib/env'
import { isNonEmptyString, isRecord } from '@/lib/guards'

/**
 * Apple App Attest Root CA — the trust anchor for every attestation chain.
 * Pinned from Apple's published PEM
 * (https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem,
 * SHA256 fingerprint 1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32).
 * Overridable via `APPLE_APP_ATTEST_ROOT_CA_PEM` (used by tests with a throwaway
 * root; ops should never need to set it — the pin is the real one).
 */
export const APPLE_APP_ATTEST_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`

// DER encoding of the App Attest nonce extension OID 1.2.840.113635.100.8.2.
const NONCE_OID_DER = Buffer.from([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02,
])

// aaguid marks the attestation environment: production vs the "develop" value a
// dev-signed build produces.
const AAGUID_PROD = Buffer.concat([Buffer.from('appattest', 'ascii'), Buffer.alloc(7)])
const AAGUID_DEV = Buffer.from('appattestdevelop', 'ascii')

const FRESHNESS_WINDOW_MS = 5 * 60 * 1000

const AUTH_APP_ATTEST_FAIL_OPEN_ENV = 'AUTH_APP_ATTEST_FAIL_OPEN'

/* =========================================================
   Minimal CBOR reader (App Attest emits a constrained subset)
========================================================= */

type CborValue =
  | number
  | string
  | Buffer
  | CborValue[]
  | Map<string | number, CborValue>

class CborReader {
  private offset = 0
  constructor(private readonly buf: Buffer) {}

  read(): CborValue {
    const initial = this.byte()
    const major = initial >> 5
    const info = initial & 0x1f
    const arg = this.argument(info)

    switch (major) {
      case 0: // unsigned int
        return arg
      case 1: // negative int
        return -1 - arg
      case 2: // byte string
        return this.take(arg)
      case 3: // text string
        return this.take(arg).toString('utf8')
      case 4: {
        // array
        const arr: CborValue[] = []
        for (let i = 0; i < arg; i++) arr.push(this.read())
        return arr
      }
      case 5: {
        // map
        const map = new Map<string | number, CborValue>()
        for (let i = 0; i < arg; i++) {
          const key = this.read()
          if (typeof key !== 'string' && typeof key !== 'number') {
            throw new Error('cbor: unsupported map key')
          }
          map.set(key, this.read())
        }
        return map
      }
      default:
        throw new Error(`cbor: unsupported major type ${major}`)
    }
  }

  private argument(info: number): number {
    if (info < 24) return info
    if (info === 24) return this.byte()
    if (info === 25) {
      const v = this.buf.readUInt16BE(this.offset)
      this.offset += 2
      return v
    }
    if (info === 26) {
      const v = this.buf.readUInt32BE(this.offset)
      this.offset += 4
      return v
    }
    if (info === 27) {
      const v = this.buf.readBigUInt64BE(this.offset)
      this.offset += 8
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('cbor: int too large')
      return Number(v)
    }
    throw new Error(`cbor: unsupported additional info ${info}`)
  }

  private byte(): number {
    const b = this.buf[this.offset++]
    if (b === undefined) throw new Error('cbor: unexpected end')
    return b
  }

  private take(len: number): Buffer {
    if (this.offset + len > this.buf.length) throw new Error('cbor: unexpected end')
    const slice = this.buf.subarray(this.offset, this.offset + len)
    this.offset += len
    return slice
  }
}

/* =========================================================
   Minimal DER reader (just enough to pull the nonce extension)
========================================================= */

type Tlv = {
  tag: number
  contentStart: number
  contentEnd: number
}

function readTlv(buf: Buffer, offset: number): Tlv {
  const tag = buf[offset]
  const lengthByte = buf[offset + 1]
  if (tag === undefined || lengthByte === undefined) {
    throw new Error('der: truncated')
  }
  let cursor = offset + 2
  let length: number
  if (lengthByte & 0x80) {
    const numBytes = lengthByte & 0x7f
    if (numBytes === 0 || numBytes > 4) throw new Error('der: bad length')
    length = 0
    for (let i = 0; i < numBytes; i++) {
      const b = buf[cursor++]
      if (b === undefined) throw new Error('der: length overrun')
      length = (length << 8) | b
    }
  } else {
    length = lengthByte
  }
  const contentStart = cursor
  const contentEnd = cursor + length
  if (contentEnd > buf.length) throw new Error('der: length overrun')
  return { tag, contentStart, contentEnd }
}

/**
 * Pull the 32-byte App Attest nonce out of the leaf certificate's
 * `1.2.840.113635.100.8.2` extension. The extension value decodes to
 * `SEQUENCE { [1] { OCTET STRING nonce } }`. Returns null if absent/malformed.
 */
export function extractNonceExtension(leafDer: Buffer): Buffer | null {
  try {
    const oidIdx = leafDer.indexOf(NONCE_OID_DER)
    if (oidIdx < 0) return null

    // The extnValue OCTET STRING immediately follows the OID (this extension is
    // non-critical, so there is no BOOLEAN in between).
    const extnValue = readTlv(leafDer, oidIdx + NONCE_OID_DER.length)
    if (extnValue.tag !== 0x04) return null

    const seq = readTlv(leafDer, extnValue.contentStart)
    if (seq.tag !== 0x30) return null

    const ctx = readTlv(leafDer, seq.contentStart)
    if (ctx.tag !== 0xa1) return null

    const octet = readTlv(leafDer, ctx.contentStart)
    if (octet.tag !== 0x04) return null
    if (octet.contentEnd - octet.contentStart !== 32) return null

    return leafDer.subarray(octet.contentStart, octet.contentEnd)
  } catch {
    return null
  }
}

/* =========================================================
   authData
========================================================= */

export type ParsedAuthData = {
  rpIdHash: Buffer
  signCount: number
  aaguid: Buffer
  credId: Buffer
}

/**
 * Slice the fixed App Attest authenticator-data layout: 32-byte rpIdHash, 1-byte
 * flags, 4-byte signCount, then attested-credential-data (16-byte aaguid, 2-byte
 * credential-id length, credential id). The trailing COSE public key is ignored.
 */
export function parseAuthData(authData: Buffer): ParsedAuthData | null {
  if (authData.length < 55) return null
  const rpIdHash = authData.subarray(0, 32)
  const signCount = authData.readUInt32BE(33)
  const aaguid = authData.subarray(37, 53)
  const credIdLen = authData.readUInt16BE(53)
  const credIdEnd = 55 + credIdLen
  if (authData.length < credIdEnd) return null
  const credId = authData.subarray(55, credIdEnd)
  return { rpIdHash, signCount, aaguid, credId }
}

/** SHA256 of the leaf's uncompressed EC public key point (0x04 || X || Y). */
function keyIdFromLeaf(leaf: X509Certificate): Buffer | null {
  const jwk = leaf.publicKey.export({ format: 'jwk' })
  if (!isRecord(jwk) || !isNonEmptyString(jwk.x) || !isNonEmptyString(jwk.y)) {
    return null
  }
  const x = Buffer.from(jwk.x, 'base64url')
  const y = Buffer.from(jwk.y, 'base64url')
  if (x.length !== 32 || y.length !== 32) return null
  const point = Buffer.concat([Buffer.from([0x04]), x, y])
  return crypto.createHash('sha256').update(point).digest()
}

/* =========================================================
   Attestation verification
========================================================= */

export type AttestationVerifyResult =
  | { ok: true; keyId: Buffer; publicKey: KeyObject }
  | { ok: false; reason: string }

export type VerifyAttestationArgs = {
  attestationBase64: string
  /** base64 key id the client generated (SHA256 of the attested public key). */
  keyId: string
  /** SHA256 the client attested over; we recompute and pass it in. */
  clientDataHash: Buffer
  /** "TEAMID.bundleId" — the App Attest app id. */
  appId: string
  /** PEM trust anchor (defaults to the pinned Apple root). */
  rootCaPem?: string
  /** Accept the "development" aaguid (dev-signed builds). */
  allowDevelopment: boolean
}

/**
 * Fully verify an App Attest attestation object. Returns `{ ok: false }` (never
 * throws) on any failure so callers can treat it as a single boolean gate.
 */
export function verifyAppAttestAttestation(
  args: VerifyAttestationArgs,
): AttestationVerifyResult {
  try {
    const raw = Buffer.from(args.attestationBase64, 'base64')
    if (raw.length === 0) return { ok: false, reason: 'empty_attestation' }

    const decoded = new CborReader(raw).read()
    if (!(decoded instanceof Map)) return { ok: false, reason: 'not_a_map' }

    const fmt = decoded.get('fmt')
    if (fmt !== 'apple-appattest') return { ok: false, reason: 'bad_fmt' }

    const attStmt = decoded.get('attStmt')
    const authData = decoded.get('authData')
    if (!(attStmt instanceof Map) || !Buffer.isBuffer(authData)) {
      return { ok: false, reason: 'bad_shape' }
    }

    const x5c = attStmt.get('x5c')
    if (!Array.isArray(x5c) || x5c.length < 2) return { ok: false, reason: 'bad_x5c' }
    const [leafDer, intermediateDer] = x5c
    if (!Buffer.isBuffer(leafDer) || !Buffer.isBuffer(intermediateDer)) {
      return { ok: false, reason: 'bad_x5c_entries' }
    }

    const leaf = new X509Certificate(leafDer)
    const intermediate = new X509Certificate(intermediateDer)
    const root = new X509Certificate(args.rootCaPem ?? APPLE_APP_ATTEST_ROOT_CA_PEM)

    // 1. Certificate chain: leaf ← intermediate ← pinned root.
    if (!leaf.checkIssued(intermediate)) return { ok: false, reason: 'leaf_not_issued' }
    if (!leaf.verify(intermediate.publicKey)) return { ok: false, reason: 'leaf_sig' }
    if (!intermediate.checkIssued(root)) return { ok: false, reason: 'intermediate_not_issued' }
    if (!intermediate.verify(root.publicKey)) return { ok: false, reason: 'intermediate_sig' }
    const now = Date.now()
    for (const cert of [leaf, intermediate, root]) {
      if (Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) < now) {
        return { ok: false, reason: 'cert_expired' }
      }
    }

    // 2. Nonce: SHA256(authData || clientDataHash) must equal the value pinned in
    //    the leaf's App Attest extension.
    const certNonce = extractNonceExtension(leafDer)
    if (!certNonce) return { ok: false, reason: 'no_nonce_ext' }
    const expectedNonce = crypto
      .createHash('sha256')
      .update(Buffer.concat([authData, args.clientDataHash]))
      .digest()
    if (!crypto.timingSafeEqual(certNonce, expectedNonce)) {
      return { ok: false, reason: 'nonce_mismatch' }
    }

    // 3. authData fields.
    const parsed = parseAuthData(authData)
    if (!parsed) return { ok: false, reason: 'bad_authdata' }

    const expectedRpIdHash = crypto.createHash('sha256').update(args.appId).digest()
    if (!crypto.timingSafeEqual(parsed.rpIdHash, expectedRpIdHash)) {
      return { ok: false, reason: 'rpid_mismatch' }
    }

    if (parsed.signCount !== 0) return { ok: false, reason: 'bad_sign_count' }

    const aaguidMatch =
      parsed.aaguid.equals(AAGUID_PROD) ||
      (args.allowDevelopment && parsed.aaguid.equals(AAGUID_DEV))
    if (!aaguidMatch) return { ok: false, reason: 'bad_aaguid' }

    // 4. The credential id (= key id) must be the hash of the attested key, and
    //    match the key id the client claims.
    const derivedKeyId = keyIdFromLeaf(leaf)
    if (!derivedKeyId) return { ok: false, reason: 'bad_leaf_key' }
    if (!crypto.timingSafeEqual(parsed.credId, derivedKeyId)) {
      return { ok: false, reason: 'credid_mismatch' }
    }
    const claimedKeyId = Buffer.from(args.keyId, 'base64')
    if (
      claimedKeyId.length !== derivedKeyId.length ||
      !crypto.timingSafeEqual(claimedKeyId, derivedKeyId)
    ) {
      return { ok: false, reason: 'keyid_mismatch' }
    }

    return { ok: true, keyId: derivedKeyId, publicKey: leaf.publicKey }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.name : 'error' }
  }
}

/* =========================================================
   Registration gate (drop-in alongside Turnstile)
========================================================= */

/** The client data the app attests over, recomputed from the registration. */
export function computeRegistrationClientDataHash(args: {
  email: string
  phone: string
  timestamp: number
}): Buffer {
  const material = `${args.email}\n${args.phone}\n${args.timestamp}` // pii-plaintext-read-ok: raw request email/phone hashed to rebind the attestation nonce — not a DB read, never stored or logged
  return crypto.createHash('sha256').update(material, 'utf8').digest()
}

/**
 * True when the request comes from the native app (which can't render Turnstile).
 * The native client stamps every request with the `x-tovis-native: ios` header.
 */
export function isNativeRegisterRequest(request: Request): boolean {
  return request.headers.get('x-tovis-native')?.trim().toLowerCase() === 'ios'
}

/**
 * Dev-only escape hatch mirroring Turnstile's fail-open: the iOS Simulator can't
 * produce an App Attest attestation, so a native signup there has none. Allow it
 * ONLY off a deployed runtime and only when explicitly opted in — this can never
 * engage in production or preview.
 */
function appAttestFailOpenAllowed(): boolean {
  if (isDeployedRuntime()) return false
  return (
    process.env.NODE_ENV !== 'production' &&
    readOptionalEnv(AUTH_APP_ATTEST_FAIL_OPEN_ENV) === '1'
  )
}

/** Accept the development aaguid off deployed runtimes, or when opted in. */
function developmentAaguidAllowed(): boolean {
  if (readOptionalEnv('APPLE_APP_ATTEST_ALLOW_DEVELOPMENT') === '1') return true
  return !isDeployedRuntime()
}

export type NativeGateResult =
  | { ok: true; failOpen: boolean; reason?: string }
  | { ok: false; code: string; message: string }

/**
 * Verify the native App Attest gate in lieu of a Turnstile token. Returns the
 * same shape the Turnstile check does so the register route can treat both
 * identically. `email`/`phone` MUST be the raw request strings the client hashed.
 */
export async function verifyNativeRegistrationGateOrFailOpen(args: {
  appAttest: unknown
  email: string
  phone: string
}): Promise<NativeGateResult> {
  const att = isRecord(args.appAttest) ? args.appAttest : null

  if (!att) {
    if (appAttestFailOpenAllowed()) {
      return { ok: true, failOpen: true, reason: 'no_attestation_dev' }
    }
    return {
      ok: false,
      code: 'APP_ATTEST_REQUIRED',
      message: 'This device could not be verified. Update the app and try again.',
    }
  }

  const keyId = isNonEmptyString(att.keyId) ? att.keyId : null
  const attestationBase64 = isNonEmptyString(att.attestation) ? att.attestation : null
  const timestamp = typeof att.timestamp === 'number' ? att.timestamp : null
  if (!keyId || !attestationBase64 || timestamp === null) {
    return {
      ok: false,
      code: 'APP_ATTEST_MALFORMED',
      message: 'Device verification is malformed. Please try again.',
    }
  }

  if (Math.abs(Date.now() - timestamp) > FRESHNESS_WINDOW_MS) {
    return {
      ok: false,
      code: 'APP_ATTEST_STALE',
      message: 'Device verification expired. Please try again.',
    }
  }

  const appId = readOptionalEnv('APPLE_APP_ATTEST_APP_ID')
  if (!appId) {
    // Not configured. Off a deployed runtime allow the dev fail-open; on a
    // deployment fail closed rather than silently accepting.
    if (appAttestFailOpenAllowed()) {
      return { ok: true, failOpen: true, reason: 'appid_unconfigured_dev' }
    }
    return {
      ok: false,
      code: 'APP_ATTEST_UNAVAILABLE',
      message: 'Device verification is temporarily unavailable. Please try again.',
    }
  }

  const clientDataHash = computeRegistrationClientDataHash({
    email: args.email,
    phone: args.phone,
    timestamp,
  })

  const result = verifyAppAttestAttestation({
    attestationBase64,
    keyId,
    clientDataHash,
    appId,
    rootCaPem: readOptionalEnv('APPLE_APP_ATTEST_ROOT_CA_PEM') ?? undefined,
    allowDevelopment: developmentAaguidAllowed(),
  })

  if (!result.ok) {
    return {
      ok: false,
      code: 'APP_ATTEST_INVALID',
      message: 'Device verification failed. Please try again.',
    }
  }

  return { ok: true, failOpen: false }
}
