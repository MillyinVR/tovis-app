// lib/security/auditClientIp.ts
//
// The caller's IP as recorded in an AUDIT field — a consent record, a
// password-reset request row, a signup ticket.
//
// ⚠️ This is NOT an authorization input, and it is deliberately not
// lib/trustedClientIp.ts. It reads the first hop of `x-forwarded-for`, which a
// client can set to anything it likes; that is acceptable precisely because
// nothing branches on the value. It is written down so a human can look at it
// later. Anything that GRANTS or REFUSES on the basis of an IP — rate-limit
// identity, geo gating — must use the trusted resolver instead, which knows
// which proxy hops it is allowed to believe.
//
// One copy, because there were three: app/api/v1/auth/register/route.ts's
// getClientIp, lib/auth/passwordReset.ts's getPasswordResetRequestIp, and a
// third that the social signup ticket was about to add.

export function getAuditClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.trim()
  if (!forwarded) return null

  const first = forwarded.split(',')[0]?.trim()
  return first || null
}
