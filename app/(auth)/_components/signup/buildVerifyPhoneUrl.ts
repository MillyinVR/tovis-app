// app/(auth)/_components/signup/buildVerifyPhoneUrl.ts
// 'skipped' = the channel was verified by the claim-link click (or, for a
// social signup, by the provider vouching for the email), so no verification
// message exists to retry — only an explicit `false` (attempted and failed)
// raises the retry flags below.
export type VerificationSendState = boolean | 'pending' | 'skipped'

/**
 * Read one of the two `*VerificationSent` fields off a signup response.
 *
 * All three signup forms need this and each had grown its own copy — and the
 * pro form's copy had no 'skipped' arm at all, so a skipped send would have
 * read as `false` and told the pro to retry a message that was never sent.
 */
export function readVerificationSendState(
  data: Record<string, unknown> | null,
  key: string,
): VerificationSendState {
  const value = data?.[key]
  if (value === 'pending') return 'pending'
  if (value === 'skipped') return 'skipped'
  return value === true
}

export function buildVerifyPhoneUrl(args: {
  nextUrl: string | null
  emailVerificationSent: VerificationSendState
  phoneVerificationSent: VerificationSendState
}): string {
  const params = new URLSearchParams()

  if (args.nextUrl) {
    params.set('next', args.nextUrl)
  }

  if (args.emailVerificationSent === false) {
    params.set('email', 'retry')
  }

  if (args.phoneVerificationSent === false) {
    params.set('sms', 'retry')
  }

  const qs = params.toString()
  return qs ? `/verify-phone?${qs}` : '/verify-phone'
}