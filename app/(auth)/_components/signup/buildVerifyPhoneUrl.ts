// app/(auth)/_components/signup/buildVerifyPhoneUrl.ts
// 'skipped' = the channel was verified by the claim-link click, so no
// verification message exists to retry — only an explicit `false` (attempted
// and failed) raises the retry flags below.
type VerificationSendState = boolean | 'pending' | 'skipped'

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