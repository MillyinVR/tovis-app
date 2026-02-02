// app/(auth)/reset-password/[token]/page.tsx

import ResetPasswordClient from '../../_components/reset/ResetPasswordClient'

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <ResetPasswordClient token={token} />
}
