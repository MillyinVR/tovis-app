// lib/auth/middlewareToken.ts

const jwtSecret = process.env.JWT_SECRET?.trim()

if (!jwtSecret) {
  throw new Error('JWT_SECRET is not set in environment variables')
}

const JWT_SECRET: string = jwtSecret

export type MiddlewareAuthRole = 'CLIENT' | 'PRO' | 'ADMIN'
export type MiddlewareAuthSessionKind = 'ACTIVE' | 'VERIFICATION'

export type MiddlewareAuthTokenPayload = {
  userId: string
  role: MiddlewareAuthRole
  sessionKind: MiddlewareAuthSessionKind
  authVersion: number
}

type JwtHeader = {
  alg?: unknown
  typ?: unknown
}

type JwtPayloadRecord = Record<string, unknown>

const textEncoder = new TextEncoder()

let hmacKeyPromise: Promise<CryptoKey> | null = null

function uint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function encodeUtf8(input: string): ArrayBuffer {
  return uint8ArrayToArrayBuffer(textEncoder.encode(input))
}

function getHmacKey(): Promise<CryptoKey> {
  if (!hmacKeyPromise) {
    hmacKeyPromise = crypto.subtle.importKey(
      'raw',
      encodeUtf8(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
  }

  return hmacKeyPromise
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isAuthRole(value: unknown): value is MiddlewareAuthRole {
  return value === 'CLIENT' || value === 'PRO' || value === 'ADMIN'
}

function isAuthSessionKind(value: unknown): value is MiddlewareAuthSessionKind {
  return value === 'ACTIVE' || value === 'VERIFICATION'
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function isNumericDate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function normalizeBase64Url(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (!/^[A-Za-z0-9\-_]+$/.test(trimmed)) return null

  const base64 = trimmed.replace(/-/g, '+').replace(/_/g, '/')
  const paddingNeeded = (4 - (base64.length % 4)) % 4

  return base64 + '='.repeat(paddingNeeded)
}

function decodeBase64UrlToArrayBuffer(input: string): ArrayBuffer | null {
  const normalized = normalizeBase64Url(input)
  if (!normalized) return null

  try {
    if (typeof atob === 'function') {
      const binary = atob(normalized)
      const bytes = new Uint8Array(binary.length)

      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
      }

      return bytes.buffer
    }

    const bytes = Uint8Array.from(Buffer.from(normalized, 'base64'))
    return uint8ArrayToArrayBuffer(bytes)
  } catch {
    return null
  }
}

function decodeBase64UrlJson<T>(input: string): T | null {
  const buffer = decodeBase64UrlToArrayBuffer(input)
  if (!buffer) return null

  try {
    const json = new TextDecoder().decode(buffer)
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

function isValidHeader(header: JwtHeader | null): boolean {
  if (!header || !isRecord(header)) return false
  if (header.alg !== 'HS256') return false

  if (header.typ !== undefined && header.typ !== 'JWT') {
    return false
  }

  return true
}

function normalizePayload(
  payload: JwtPayloadRecord,
  nowSeconds: number,
): MiddlewareAuthTokenPayload | null {
  const userId = payload.userId
  const role = payload.role
  const sessionKind = payload.sessionKind
  const authVersion = payload.authVersion
  const exp = payload.exp
  const nbf = payload.nbf

  if (!isNonEmptyString(userId)) return null
  if (!isAuthRole(role)) return null
  if (!isAuthSessionKind(sessionKind)) return null
  if (!isPositiveInteger(authVersion)) return null

  if (!isNumericDate(exp)) return null
  if (exp <= nowSeconds) return null

  if (nbf !== undefined) {
    if (!isNumericDate(nbf)) return null
    if (nbf > nowSeconds) return null
  }

  return {
    userId,
    role,
    sessionKind,
    authVersion,
  }
}

export async function verifyMiddlewareToken(
  token: string | null | undefined,
): Promise<MiddlewareAuthTokenPayload | null> {
  if (!isNonEmptyString(token)) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [encodedHeader, encodedPayload, encodedSignature] = parts
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null

  const header = decodeBase64UrlJson<JwtHeader>(encodedHeader)
  if (!isValidHeader(header)) return null

  const payload = decodeBase64UrlJson<JwtPayloadRecord>(encodedPayload)
  if (!payload || !isRecord(payload)) return null

  const signatureBuffer = decodeBase64UrlToArrayBuffer(encodedSignature)
  if (!signatureBuffer) return null

  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signingInputBuffer = encodeUtf8(signingInput)

  try {
    const key = await getHmacKey()
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      signingInputBuffer,
    )

    if (!isValid) return null
  } catch {
    return null
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  return normalizePayload(payload, nowSeconds)
}