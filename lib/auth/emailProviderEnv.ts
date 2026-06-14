// lib/auth/emailProviderEnv.ts
//
// Single source of truth for reading email-provider (Postmark) environment
// variables. A missing or blank value throws EmailNotConfiguredError, which the
// email-send routes use to classify the failure as EMAIL_NOT_CONFIGURED (rather
// than a generic send failure) via isEmailNotConfiguredError — instead of
// substring-matching the thrown message across modules.
//
// The Error message intentionally preserves the historical
// `Missing env var: ${name}` text so existing logs/observability stay stable;
// classification keys off the type, not the string.

export class EmailNotConfiguredError extends Error {
  readonly envVar: string

  constructor(envVar: string) {
    super(`Missing env var: ${envVar}`)
    this.name = 'EmailNotConfiguredError'
    this.envVar = envVar
  }
}

export function isEmailNotConfiguredError(error: unknown): boolean {
  return error instanceof EmailNotConfiguredError
}

export function requireEmailEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new EmailNotConfiguredError(name)
  }
  return value
}
