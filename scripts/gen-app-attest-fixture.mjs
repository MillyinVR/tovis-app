// Regenerates lib/auth/appAttest.fixtures.ts — a hermetic App Attest attestation
// signed by a THROWAWAY root CA (real EC cert chain via openssl + the Apple nonce
// extension) so lib/auth/appAttest.test.ts can exercise the full verifier with no
// runtime openssl and no real device. Run: `node scripts/gen-app-attest-fixture.mjs`.
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// ---- tiny CBOR encoder (subset: uint, negint, bytes, text, array, map) ----
function cborUint(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n])
  if (n < 256) return Buffer.from([(major << 5) | 24, n])
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff])
  const b = Buffer.alloc(5)
  b[0] = (major << 5) | 26
  b.writeUInt32BE(n, 1)
  return b
}
function enc(v) {
  if (typeof v === 'number') {
    if (v < 0) return cborUint(1, -v - 1)
    return cborUint(0, v)
  }
  if (Buffer.isBuffer(v)) return Buffer.concat([cborUint(2, v.length), v])
  if (typeof v === 'string') {
    const b = Buffer.from(v, 'utf8')
    return Buffer.concat([cborUint(3, b.length), b])
  }
  if (Array.isArray(v))
    return Buffer.concat([cborUint(4, v.length), ...v.map(enc)])
  if (v && v.__map) {
    const entries = v.entries
    return Buffer.concat([
      cborUint(5, entries.length),
      ...entries.flatMap(([k, val]) => [enc(k), enc(val)]),
    ])
  }
  throw new Error('cannot encode ' + typeof v)
}
const cmap = (entries) => ({ __map: true, entries })

// ---- DER helpers for the nonce extension value ----
function der(tag, value) {
  const len =
    value.length < 128
      ? Buffer.from([value.length])
      : (() => {
          const bytes = []
          let n = value.length
          while (n > 0) {
            bytes.unshift(n & 0xff)
            n >>= 8
          }
          return Buffer.from([0x80 | bytes.length, ...bytes])
        })()
  return Buffer.concat([Buffer.from([tag]), len, value])
}

const dir = mkdtempSync(join(tmpdir(), 'appattest-'))
const p = (f) => join(dir, f)
const ossl = (args) =>
  execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })

// 1. root
ossl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', p('root.key')])
ossl(['req', '-x509', '-new', '-key', p('root.key'), '-subj', '/CN=Test App Attest Root', '-days', '3650', '-out', p('root.crt')])
// 2. intermediate
ossl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', p('int.key')])
ossl(['req', '-new', '-key', p('int.key'), '-subj', '/CN=Test App Attest CA', '-out', p('int.csr')])
writeFileSync(p('int.ext'), 'basicConstraints=critical,CA:TRUE\n')
ossl(['x509', '-req', '-in', p('int.csr'), '-CA', p('root.crt'), '-CAkey', p('root.key'), '-CAcreateserial', '-days', '3650', '-extfile', p('int.ext'), '-out', p('int.crt')])
// 3. leaf key
ossl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', p('leaf.key')])

const leafPubPem = ossl(['ec', '-in', p('leaf.key'), '-pubout']).toString()
const leafPubKey = crypto.createPublicKey(leafPubPem)
const jwk = leafPubKey.export({ format: 'jwk' })
const x = Buffer.from(jwk.x, 'base64url')
const y = Buffer.from(jwk.y, 'base64url')
const uncompressedPoint = Buffer.concat([Buffer.from([0x04]), x, y]) // 65 bytes
const credId = crypto.createHash('sha256').update(uncompressedPoint).digest() // 32

// Neutral, non-brand app id — the fixture just needs internal consistency, and
// the brand-string guard scans generated .ts. Real app id comes from env in prod.
const APP_ID = '00A0B0C0D0.com.example.appattest'
const rpIdHash = crypto.createHash('sha256').update(APP_ID).digest()
const aaguid = Buffer.from('appattestdevelop', 'ascii') // 16 bytes, development env
const cose = enc(
  cmap([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, x],
    [-3, y],
  ]),
)
const credIdLen = Buffer.from([0x00, 0x20])
const flags = Buffer.from([0x40]) // AT set
const signCount = Buffer.from([0, 0, 0, 0])
const authData = Buffer.concat([
  rpIdHash,
  flags,
  signCount,
  aaguid,
  credIdLen,
  credId,
  cose,
])

// clientData mirrors computeRegistrationClientDataHash(): "email\nphone\ntimestamp".
// A FIXED timestamp lets the gate test pin Date.now() inside the freshness window.
const FIXTURE_EMAIL = 'att-client@example.com'
const FIXTURE_PHONE = '+15555550123'
// Must sit inside the generated chain's 10-year validity (issued ~now), since
// the verifier enforces cert validity against this instant. 2027-01-15.
const FIXTURE_TIMESTAMP = 1800000000000
const clientDataHash = crypto
  .createHash('sha256')
  .update(`${FIXTURE_EMAIL}\n${FIXTURE_PHONE}\n${FIXTURE_TIMESTAMP}`, 'utf8')
  .digest()
const nonce = crypto
  .createHash('sha256')
  .update(Buffer.concat([authData, clientDataHash]))
  .digest()

// nonce extension value = SEQUENCE { [1] { OCTET STRING nonce } }
const octet = der(0x04, nonce)
const ctx1 = der(0xa1, octet)
const seq = der(0x30, ctx1)
writeFileSync(p('leaf.ext'), `1.2.840.113635.100.8.2=DER:${seq.toString('hex')}\n`)
ossl(['req', '-new', '-key', p('leaf.key'), '-subj', '/CN=Test App Attest Leaf', '-out', p('leaf.csr')])
ossl(['x509', '-req', '-in', p('leaf.csr'), '-CA', p('int.crt'), '-CAkey', p('int.key'), '-CAcreateserial', '-days', '3650', '-extfile', p('leaf.ext'), '-out', p('leaf.crt')])

const pemToDer = (pem) => {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return Buffer.from(b64, 'base64')
}
const leafDer = pemToDer(readFileSync(p('leaf.crt'), 'utf8'))
const intDer = pemToDer(readFileSync(p('int.crt'), 'utf8'))
const rootPem = readFileSync(p('root.crt'), 'utf8').trim()

const attestation = enc(
  cmap([
    ['fmt', 'apple-appattest'],
    [
      'attStmt',
      cmap([
        ['x5c', [leafDer, intDer]],
        ['receipt', Buffer.from('test-receipt')],
      ]),
    ],
    ['authData', authData],
  ]),
)

const fixture = {
  APP_ID,
  keyId: credId.toString('base64'),
  attestationBase64: attestation.toString('base64'),
  clientDataHashBase64: clientDataHash.toString('base64'),
  rootCaPem: rootPem,
  email: FIXTURE_EMAIL,
  phone: FIXTURE_PHONE,
  timestamp: FIXTURE_TIMESTAMP,
}

const ts = `// lib/auth/appAttest.fixtures.ts
//
// GENERATED test fixture — a self-contained App Attest attestation signed by a
// THROWAWAY root CA (not Apple's), so lib/auth/appAttest.test.ts can exercise the
// full verifier hermetically (no runtime openssl, no real device). Regenerate
// with \`node scripts/gen-app-attest-fixture.mjs\`.

/** The throwaway root the fixture chain is signed by (NOT the Apple root). */
export const FIXTURE_ROOT_CA_PEM = \`${fixture.rootCaPem}\`

/** App id ("TEAMID.bundleId") baked into the fixture's rpIdHash. */
export const FIXTURE_APP_ID = '${fixture.APP_ID}'

/** base64 key id = SHA256 of the attested public key. */
export const FIXTURE_KEY_ID = '${fixture.keyId}'

/** base64 clientDataHash the fixture attestation's nonce was computed over. */
export const FIXTURE_CLIENT_DATA_HASH_B64 = '${fixture.clientDataHashBase64}'

// The registration inputs the fixture's clientDataHash was derived from, i.e.
// SHA256(\`\${FIXTURE_EMAIL}\\n\${FIXTURE_PHONE}\\n\${FIXTURE_TIMESTAMP}\`). Pin
// Date.now() near FIXTURE_TIMESTAMP to exercise the gate's freshness window.
export const FIXTURE_EMAIL = '${fixture.email}'
export const FIXTURE_PHONE = '${fixture.phone}'
export const FIXTURE_TIMESTAMP = ${fixture.timestamp}

/** base64 CBOR attestation object (fmt apple-appattest). */
export const FIXTURE_ATTESTATION_B64 =
  '${fixture.attestationBase64}'
`

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'auth', 'appAttest.fixtures.ts')
writeFileSync(outPath, ts)
console.log(`wrote ${outPath}`)
