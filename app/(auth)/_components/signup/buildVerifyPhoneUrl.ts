// app/(auth)/_components/signup/buildVerifyPhoneUrl.ts
type VerificationSendState = boolean | 'pending'

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