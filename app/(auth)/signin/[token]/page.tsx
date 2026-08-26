// app/(auth)/signin/[token]/page.tsx
//
// Where the emailed magic link lands. It does NOT sign anyone in — it renders a
// button that does. See EmailSignInLandingClient for why that separation is the
// entire point of this page existing.

import EmailSignInLandingClient from '../../_components/login/EmailSignInLandingClient'

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <EmailSignInLandingClient token={token} />
}
