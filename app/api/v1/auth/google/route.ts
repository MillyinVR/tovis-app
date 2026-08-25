// app/api/v1/auth/google/route.ts
//
// "Sign in with Google" for the web app (and reusable by native). The client
// sends Google's identity token (the `credential` from Google Identity
// Services) + a stable deviceId.
//
// Two outcomes, both 200 (see AuthSocialSignInResponseDTO): an identity that
// already has an account signs in with the SAME session payload as
// email/password login, and one that does not gets a single-use signup ticket
// to finish at POST /api/v1/auth/social/complete. This route no longer creates
// accounts — the whole body lives in lib/auth/social/handleSocialSignIn.ts,
// shared with the Apple route it used to be a copy of.

import { handleSocialSignIn } from '@/lib/auth/social/handleSocialSignIn'
import { verifyGoogleIdentityToken } from '@/lib/auth/googleIdentity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  return handleSocialSignIn(request, {
    provider: 'GOOGLE',
    displayName: 'Google',
    bucket: 'auth:google',
    routeLabel: 'auth.google',
    invalidTokenCode: 'INVALID_GOOGLE_TOKEN',
    // given_name/family_name are claims inside the verified id-token.
    namesFrom: 'TOKEN',
    verifyIdentityToken: verifyGoogleIdentityToken,
  })
}
