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
// - `/looks/<id>` — a shared look → the native single-look detail (LookDetailView,
//   paired iOS #155). The app's OWN share sheet emits this URL, so without the
//   association it produced links it could not open.
// - `/looks/tags/<slug>` — a hashtag browse page → the native tag feed
//   (LookTagFeedView, routed by `LookTagLink` → `PushDeepLink.Target.lookTag`).
//   ⚠️ This path was EXCLUDED here for one stated reason — "native has no tag
//   screen" — and that premise expired: `LookTagFeedView` landed and replaced the
//   app's three SafariView ejects (the feed's overlay chips, Discover's trending
//   rail, the look detail's tag row). So the app rendered tag feeds natively from
//   the inside while every tapped tag LINK still went to Safari. An exclusion
//   carries its justification with it; when the justification stops being true,
//   the exclusion is just a bug with a comment. The bare `/looks/tags` index
//   stays excluded — web has no such page and neither does the app.
// - `/c/<shortCode>` — a client's shareable referral link (the invite card + its
//   QR emit this; `lib/referral/inviteCard.ts`). It redirects through the web NFC
//   tap-funnel (`/c → /t`), which is web-only BY DESIGN, so there is no native
//   funnel screen — instead the native handler opens this URL in the in-app
//   browser (SFSafariViewController). That still counts as "handling" the path
//   (the tap does something deterministic, not a no-op), and it keeps the
//   app-emitted invite/QR links inside the app rather than bouncing to system
//   Safari. ⚠️ The in-app browser is cookieless, so the
//   web funnel treats the tapper as anonymous → referral credit is only granted if
//   they complete signup there. A richer NATIVE signup-with-attribution flow (route
//   /c/ into ClientSignupView, plumb the tap intent through register/login) is
//   backlogged — see tovis-ios/BACKLOG.md.
// - `/u/<handle>/boards/<slug>` — a shared public board → the native public-board
//   viewer (PublicBoardView, routed by `PublicBoardLink` in `handleDeepLink`).
//   `BoardShareSection` emits exactly this URL, so without the association the app
//   produced share links it could not open.
// - `/u/<handle>` — a shared creator profile → the native `PublicClientViewerView`
//   (routed by `PushDeepLink.Target.publicClient`). Associated only once the app
//   gained that route; before then it was deliberately left out, because an
//   associated path the app can't handle is the silent no-op described below.
//   ⚠️ …and it became that no-op anyway. The app gained the route in its PUSH
//   parser (`PushDeepLink`), but its Universal-Link handler never consulted that
//   parser, so a TAPPED `/u/<handle>` opened the app and did nothing from the day
//   this line was added until tovis-ios #461 wired the two together. "The app
//   parses the path" is NOT the same claim as "the app handles the tap" — before
//   associating anything here, read the `.onOpenURL` side, not just the parser.
// - `/professionals/<id>` — a shared PRO profile → the native `ProProfileView`
//   (routed by `PushDeepLink.Target.publicPro`). The pro-side twin of `/u/<handle>`
//   above, and the same defect: `ProProfileView`'s own Share control emits exactly
//   this URL, so every stranger who tapped a shared pro profile was sent to Safari.
//   ⚠️ The handle-keyed mirror `/p/<handle>` stays OUT — resolving a handle to a
//   professionalId needs a lookup the native parser cannot do, so the app cannot
//   handle it and it must keep opening the web page.
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
//
// ⚠️ ORDER IS LOAD-BEARING. iOS evaluates these top-to-bottom and stops at the
// FIRST match, positive or negative — so an `exclude` must come BEFORE the
// broader pattern it carves out of, not after.
//
// ⚠️ Only associate a path the app can actually HANDLE. An associated path the
// app doesn't route is worse than no association: iOS opens the app, the app
// recognizes nothing, and the tap becomes a silent no-op instead of loading the
// web page. That's why the bare `/looks/tags` index is excluded — there is no
// such page on web and no such screen in the app.
//
// ⚠️ The converse costs just as much, and is harder to see: an exclusion whose
// premise has EXPIRED. `/looks/tags/*` sat here as "native has no tag screen"
// long after the app grew one, so the app's own tag chips opened natively while
// the same page reached by LINK bounced to Safari. Re-read the reason before
// trusting the entry — and pair every change here with the iOS parser that
// routes it (tovis-ios `LookTagLink`).
const ASSOCIATED_PATHS = [
  { path: '/reset-password/*' },
  { path: '/claim/*' },
  // A client's referral short-link → opened in the app's in-app browser (the
  // web funnel is web-only by design). No exclusion needed — `/c/` has a single
  // `{shortCode}` shape and no sub-paths.
  { path: '/c/*' },
  // Exclusion first — see the ordering note above. The bare `/looks/tags` index
  // is not a page on web (only `/looks/tags/[slug]` exists) and not a screen in
  // the app, so it stays in the browser. Its `/looks/tags/*` sibling does NOT:
  // that one is the tag feed, which the app has routed since `LookTagLink`.
  { path: '/looks/tags', exclude: true },
  // `/looks/{id}` → LookDetailView, `/looks/tags/{slug}` → LookTagFeedView. AASA
  // `*` spans `/`, so this one pattern covers both and the app's two parsers
  // (`LooksLink`, `LookTagLink`) decide between them.
  { path: '/looks/*' },
  // A shared public board → the native public-board viewer (PublicBoardView,
  // routed by `PublicBoardLink` in the app's `handleDeepLink`). `BoardShareSection`
  // emits exactly `/u/<handle>/boards/<slug>`. Listed BEFORE the bare profile
  // below so the more specific board pattern is the one that matches first.
  { path: '/u/*/boards/*' },
  // A creator's public profile → the native `PublicClientViewerView`, routed by
  // `PushDeepLink.Target.publicClient`. This was deliberately NOT associated
  // while the app had no route for it — an associated path the app can't handle
  // is the silent no-op described above. The app now routes it, and this is the
  // link the client Share sheet promises ("a Recreate this look link back to
  // your profile"), so leaving it in the browser sent every stranger who tapped
  // a shared profile out of the app.
  { path: '/u/*' },
  // Exclusion first — see the ordering note above. `/professionals/dashboard` is a
  // legacy redirect to `/pro`, not a pro id: the native parser takes the second
  // segment as a professionalId, so without this an associated tap would open the
  // app and fetch a pro called "dashboard". Nothing in the repo emits it any more,
  // but an old bookmark still can, and the web redirect is the honest answer.
  { path: '/professionals/dashboard', exclude: true },
  // A pro's public profile → the native `ProProfileView`, routed by
  // `PushDeepLink.Target.publicPro`. Same story as `/u/*` directly above: the
  // profile's own Share control emits exactly this link, so leaving it
  // unassociated sent every stranger who tapped a shared pro profile out of the
  // app. Deeper paths (`/professionals/<id>/anything`) don't exist on web and the
  // native parser rejects them, so there is nothing between the two to carve out.
  { path: '/professionals/*' },
] as const

const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appID: APP_ID,
        appIDs: [APP_ID],
        // Legacy (pre-iOS 13) form: exclusions are a "NOT " prefix.
        paths: ASSOCIATED_PATHS.map((entry) =>
          'exclude' in entry ? `NOT ${entry.path}` : entry.path,
        ),
        // iOS 13+ form: exclusions are an `exclude: true` key. Derived from the
        // same list so the two forms can never disagree.
        components: ASSOCIATED_PATHS.map((entry) =>
          'exclude' in entry
            ? { '/': entry.path, exclude: true }
            : { '/': entry.path },
        ),
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
