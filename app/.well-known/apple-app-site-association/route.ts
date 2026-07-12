// app/.well-known/apple-app-site-association/route.ts
//
// Apple App Site Association (AASA) — served at the fixed, un-redirected path
// `/.well-known/apple-app-site-association` so iOS can associate the native app
// with this domain and open Universal Links in-app instead of Safari.
//
// Associated paths (tapping on a device with the app installed opens the native
// screen instead of the web page; everything else keeps opening in the browser):
// - `/reset-password/<token>` — the password-reset link `lib/auth/passwordReset.ts`
//   emails → native "set a new password" screen (tovis-ios ResetPasswordView).
// - `/claim/<token>` — the account-claim link the client-claim invite delivers
//   (§27 claim flow) → native ClaimView with the token, so a pro's client who taps
//   their claim link lands in the app's claim-acceptance screen (paired iOS #106).
//
// Notes:
// - Must be served with `Content-Type: application/json` and NO redirect. A
//   route handler guarantees both (a `public/` static file would be
//   `application/octet-stream`, which Apple rejects; the apex→www redirect would
//   also break the fetch). Next serves this handler on whichever host resolves
//   the deployment, so both `tovis.app` and `www.tovis.app` are covered.
// - `appID` (legacy, pre-iOS 13) and `appIDs`/`components` (iOS 13+) are both
//   emitted for the widest device coverage. The app id is <TeamID>.<bundleId> =
//   `SB3J675LNU.app.tovis.Tovis` (the App Attest / real bundle id, NOT the
//   Sign-in-with-Apple services id).

const APP_ID = 'SB3J675LNU.app.tovis.Tovis'

// Universal Link path patterns that open in-app. Add a pattern here (and update
// the AASA test) when a new emailed/SMS'd link should deep-link into the app.
const ASSOCIATED_PATHS = ['/reset-password/*', '/claim/*'] as const

const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appID: APP_ID,
        appIDs: [APP_ID],
        paths: [...ASSOCIATED_PATHS],
        components: ASSOCIATED_PATHS.map((path) => ({ '/': path })),
      },
    ],
  },
} as const

export const dynamic = 'force-static'

export function GET() {
  return new Response(JSON.stringify(AASA), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Let Apple's CDN cache it; it changes only when the app id / paths change.
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
