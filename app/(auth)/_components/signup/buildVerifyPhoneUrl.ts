// app/(auth)/_components/signup/buildVerifyPhoneUrl.ts
export function buildVerifyPhoneUrl(args: {
  nextUrl: string | null
  emailVerificationSent: boolean
  phoneVerificationSent: boolean
}): string {
  const params = new URLSearchParams()

  if (args.nextUrl) {
    params.set('next', args.nextUrl)
  }

  if (!args.emailVerificationSent) {
    params.set('email', 'retry')
  }

  if (!args.phoneVerificationSent) {
    params.set('sms', 'retry')
  }

  const qs = params.toString()
  return qs ? `/verify-phone?${qs}` : '/verify-phone'
}