// tests/load/_vercelBypass.ts
//
// Vercel "Protection Bypass for Automation" support for load runs.
//
// Deployed load proofs target a Vercel *preview* deployment, which is protected
// by Deployment Protection (unauthenticated requests 302 → SSO). Generate a
// "Protection Bypass for Automation" secret in the Vercel project settings and
// expose it as VERCEL_AUTOMATION_BYPASS_SECRET; every load request then carries
// the bypass header and reaches the app directly. No-op (zero headers) when the
// secret is unset, so local/CI runs are unaffected.

export function vercelBypassHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
  return secret ? { 'x-vercel-protection-bypass': secret } : {}
}
