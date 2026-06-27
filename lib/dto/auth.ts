// lib/dto/auth.ts
//
// Wire DTOs for the auth + workspace-switch endpoints. These responses carry the
// session token in the JSON body (native persists it in secure storage and
// replays it as `Authorization: Bearer`). All shapes are JSON-safe — verification
// timestamps are already coerced to booleans (`isPhoneVerified` etc.).
//
// Note: jsonOk injects `ok: true`; the verify/resend endpoints additionally pass
// `ok` in their literal, so those DTOs carry it to match the route exactly. The
// token-minting endpoints (login/register/refresh/switch) omit it.

import type { Role } from '@prisma/client'

// Minimal user identity echoed in login/register responses.
export type AuthUserDTO = {
  id: string
  email: string
  role: Role
}

// POST /api/v1/auth/login
export type AuthLoginResponseDTO = {
  user: AuthUserDTO
  token: string
  nextUrl: string | null
  isPhoneVerified: boolean
  isEmailVerified: boolean
  isFullyVerified: boolean
}

// POST /api/v1/auth/register
export type AuthRegisterResponseDTO = {
  user: AuthUserDTO
  token: string
  nextUrl: string | null
  requiresPhoneVerification: boolean
  phoneVerificationSent: string
  phoneVerificationErrorCode: string | null
  requiresEmailVerification: boolean
  isPhoneVerified: boolean
  isEmailVerified: boolean
  isFullyVerified: boolean
  emailVerificationSent: string
  needsManualLicenseUpload: boolean
  manualLicensePendingReview: boolean
}

// POST /api/v1/auth/refresh
export type AuthRefreshResponseDTO = {
  token: string
}

// POST /api/v1/auth/phone-login/send — always generic (enumeration-safe).
export type AuthPhoneLoginSendResponseDTO = {
  message: string
}

// POST /api/v1/auth/phone-login/verify reuses AuthLoginResponseDTO.

// POST /api/v1/auth/phone/verify — token is null until the session is fully
// verified (and on the already-verified early return, which mints no new token).
export type AuthPhoneVerifyResponseDTO = {
  ok: true
  alreadyVerified?: boolean
  isPhoneVerified: boolean
  isEmailVerified: boolean
  isFullyVerified: boolean
  requiresEmailVerification: boolean
  token: string | null
}

// POST /api/v1/auth/email/verify — token is null when the caller is not the owner.
export type AuthEmailVerifyResponseDTO = {
  ok: true
  alreadyVerified: boolean
  isPhoneVerified: boolean
  isEmailVerified: boolean
  isFullyVerified: boolean
  requiresPhoneVerification: boolean
  token: string | null
}

// POST /api/v1/auth/resend-phone-code — `to` is masked.
export type AuthResendPhoneCodeResponseDTO = {
  ok: true
  to: string
  status: string
}

// POST /api/v1/auth/verify-phone-code — `phone` is masked.
export type AuthVerifyPhoneCodeResponseDTO = {
  ok: true
  phone: string
  status: string
}

// POST /api/v1/workspace/switch — re-minted token carries the new acting role.
export type WorkspaceSwitchResponseDTO = {
  workspace: Role
  href: string
  token: string
}
