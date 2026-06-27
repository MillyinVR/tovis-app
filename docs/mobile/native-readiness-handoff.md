# Native iOS/Android Readiness — Handoff

> **Purpose:** This doc is a self-contained handoff for a fresh Claude Code session.
> It captures a full audit of the Tovis web app (Next.js 16, 247 API routes, Prisma +
> Supabase + Stripe + Twilio) done on 2026-06-26, scoped to: *what must be built, fixed,
> or consolidated before/so-that native iOS + Android clients can be built on top of the
> existing backend.*
>
> **Headline verdict:** The backend is mature and mobile-shaped. Recommended architecture
> is **native (Swift/Kotlin or React Native) + the existing REST API** — NOT a Capacitor/
> webview wrapper (the app's own security headers block it), and NOT a rewrite (the API is
> too good to throw away). The work below is **weeks, not months.**
>
> **How to use this doc:** Work top-to-bottom by priority tier. Each item has What / Why /
> Where (file:line) / Size. Tier 0 unblocks everything else — do it first.

---

## Guardrails for whoever picks this up

- Follow `CLAUDE.md` house rules: no `as any`/type escapes, no duplicate logic (search for an
  existing helper first — this whole doc is about *one source of truth*), Prisma schema is the
  data source of truth, all date/time via `@/lib/time`, white-label brand strings via `lib/brand`,
  tone color utilities not raw colors.
- Before pushing: `npm run typecheck && npm run lint && npm run check:static-guards` + relevant vitest.
- Start/end of session in sync with `origin/main` (see CLAUDE.md "Session sync").
- Branch off `origin/main`; don't stack PRs (past sessions got burned by stacking).

---

## TIER 0 — Hard blockers (native literally cannot work until these land)

> **✅ STATUS: SHIPPED (2026-06-26).** All of 0.1–0.3 implemented. New shared parser
> `lib/auth/bearerToken.ts` (`parseBearerToken`, used by both Node + Edge). `getCurrentUser`
> ([lib/currentUser.ts](../../lib/currentUser.ts)) and `proxy.ts` now fall back to
> `Authorization: Bearer`; `proxy.ts` skips the Origin/CSRF check for bearer-only requests
> (cookie present ⇒ check still runs). `token` is returned in the JSON body of login, register,
> phone-verify, email-verify and workspace-switch. New `POST /api/auth/refresh` re-issues an
> ACTIVE token (stateless, re-checks authVersion → revocation-safe, preserves acting role).
> Unit tests: `tests/auth/bearerToken.test.ts`. typecheck/lint/guards/auth-tests green.
> **Deferred:** native-specific shorter TTL + true short-access/long-refresh rotation — lands
> with the `DeviceToken` model (Tier 1.1 / 4.2), where per-device revocation makes it meaningful.

These two are the *only* reason a phone can't talk to the backend today. Both are small and
both live in the same two files. Ship them as **one focused PR** before any client work.

### 0.1 — Add a bearer-token auth path (today it's cookie-only)
- **What:** The session is already a self-contained HS256 JWT (`userId`/`role`/`sessionKind`/
  `authVersion`, 7-day expiry, revoked via `authVersion`). It is delivered ONLY as an httpOnly
  `tovis_token` cookie. There is no `Authorization: Bearer` path. Add one.
- **Why:** Native apps don't share a browser cookie jar; they hold a bearer token. Without a
  header path, no authenticated API call works from native.
- **Where:**
  - `lib/currentUser.ts:120-139` — `getCurrentUser()` reads the JWT only from
    `cookies().get('tovis_token')`. Add a fallback: read `Authorization: Bearer <jwt>`.
  - `proxy.ts:269` (the Next 16.2 edge middleware — renamed from `middleware.ts`) +
    `lib/auth/middlewareToken.ts` — edge verify also reads cookie-only. Add header fallback.
  - The verify logic itself (`lib/auth.ts:80-102`) is transport-agnostic — reuse it as-is.
  - Everything downstream (`requireUser`/`requireClient`/`requirePro` in
    `app/api/_utils/auth/requireUser.ts`, roles, `authVersion` revocation, workspace switching)
    needs **zero** change.
- **Size:** Small.

### 0.2 — Carve native (bearer) requests out of the Origin/CSRF guard
- **What:** `proxy.ts` enforces a same-site `Origin`/`Referer` check on every state-changing
  request and returns `403 INVALID_ORIGIN` when the header is missing. Native apps send no
  `Origin`/`Referer`, so every mutation (including login) is rejected. Skip the check when auth
  arrived via bearer header instead of cookie.
- **Why:** The Origin check IS the CSRF defense — it only exists because the session is a cookie.
  Bearer-token requests aren't CSRF-able, so the check is unnecessary (and fatal) for them.
- **Where:** `proxy.ts:202-266` — `shouldCheckOrigin` (`:202-224`), `isSameSiteOrigin`
  (`:168-200`), reject at `:261-266`. Make `shouldCheckOrigin` return false when the request
  carries a bearer token and no auth cookie.
- **Size:** Small.

### 0.3 — Return the token in auth JSON responses + add refresh/rotation
- **What:** Login/register/verify currently emit the JWT only as `Set-Cookie`. Native needs it
  in the JSON body to store in secure storage. Also add a refresh primitive.
- **Why:** Native must capture & persist the token (iOS Keychain / Android Keystore). And a
  7-day non-refreshable bearer token on a device is a long-lived key with no rotation.
- **Where:**
  - Add `token` to the JSON body in: `app/api/auth/login/route.ts:362`,
    `app/api/auth/register/route.ts:1320`, `app/api/auth/phone/verify/route.ts:92`,
    `app/api/auth/email/verify/route.ts:287`, `app/api/workspace/switch/route.ts:116`.
    Shared cookie helper: `app/api/_utils/auth/sessionCookie.ts:74-91`.
  - **No refresh endpoint exists today** — add one (or shorten the access-token TTL for native +
    issue a refresh token). Consider a shorter native TTL than the 7-day web default.
- **Size:** Small (return token) + Medium (refresh strategy).

---

## TIER 1 — Net-new builds (big, but additive; plan real time for these)

### 1.1 — Push notifications (APNs + FCM) — essentially greenfield
- **What:** There is NO push infrastructure today (no APNs/FCM, no device-token model, no
  web-push, no service worker). Build it.
- **Why:** Push is the core value of a native app. None of it exists.
- **The good news:** the notification *engine* is production-grade and ~60% of the work is done.
  Adding a `PUSH` channel is additive to the existing dispatch→delivery→event queue (leasing,
  retry backoff, idempotency, per-channel suppression, provider webhooks).
- **Where / what to build:**
  - New `DeviceToken` (or `PushSubscription`) Prisma model: `userId` + `platform` + `token` +
    refresh/invalidation. **There is no Device/Session table today** (auth is stateless JWT), so
    this is net-new. Migration required.
  - Registration + invalidation API endpoints for device tokens.
  - **1-dispatch → N-device fan-out** — current deliveries are 1 row = 1 destination string; push
    needs to fan one logical delivery out to all of a user's devices. New concept.
  - APNs + FCM provider clients + credentials, registered in
    `lib/notifications/delivery/runNotificationDrain.ts` and routed in `sendWithProvider()`'s
    switch (`lib/notifications/delivery/processDueDeliveries.ts:216`).
  - Add enum members: `PUSH` on `NotificationChannel` (`prisma/schema.prisma:582`) and a provider
    (`APNS`/`FCM`) on `NotificationProvider` (`:588`). Migration. The binding map
    `DELIVERY_PROVIDER_BINDINGS` (`lib/notifications/delivery/providerPolicy.ts:53`) is typed
    `Record<NotificationChannel, ...>` so the compiler will force the new entry — good.
  - Extend ~10 three-way `if IN_APP / SMS / else EMAIL` branches to a 4th arm:
    `lib/notifications/delivery/channelPolicy.ts:130-157`,
    `lib/notifications/dispatch/enqueueDispatch.ts:279-295`,
    capability flag `hasPushDestination` through `RecipientChannelCapabilities`
    (`channelPolicy.ts:35`, `getRecipientChannelCapabilities()` `:300`).
  - **Preferences are the one place NOT cleanly extensible** — channels are hardcoded boolean
    columns, not a normalized table. Add `pushEnabled` to BOTH
    `ProfessionalNotificationPreference` (`prisma/schema.prisma:919`) and
    `ClientNotificationPreference` (`:940`). Update `NotificationPreferenceLike`
    (`channelPolicy.ts:17`) and `isPreferenceEnabledForChannel()` (`:159`). Decide if push honors
    quiet hours (`channelUsesQuietHours()` `:176`) — almost certainly yes.
  - Per-event default channels: `lib/notifications/eventKeys.ts:45` (`defaultChannelsByRecipient`).
- **Size:** Large. Engine reuse saves the hardest parts; net-new = device lifecycle + providers +
  fan-out + preference column.

### 1.2 — (Optional) Real-time transport for messaging/presence
- **What:** Everything is HTTP polling today (messages 10s, unread badge ~15s, presence 30s
  heartbeat + 15-30s poll). There are NO websockets/SSE/Supabase-Realtime subscriptions. A latent
  Redis `publish()` exists for in-app notifications but **nothing subscribes to it** — fire-and-forget.
- **Why:** Native users expect live chat. Polling works but feels dated and burns battery/requests.
- **Where:** `app/messages/thread/[id]/ThreadClient.tsx:334`,
  `app/_components/_hooks/useUnreadBadge.ts:100-111`, `lib/presence/usePresenceSignals.ts:12-105`,
  latent publish in `lib/notifications/delivery/runNotificationDrain.ts:50-90`.
- **Size:** Medium (build an SSE or WS subscriber transport, or wire up Supabase Realtime). Optional
  for v1 — push covers most of the "feel live" need.

---

## TIER 2 — API consolidation & "one source of truth" (the read layer is the gap)

The write/transactional core is ~85-90% reachable as clean JSON. The gap is **composed read
screens** rendered server-side with no JSON twin, plus structural items that prevent the API from
being one stable contract.

### 2.1 — Build the missing aggregate read endpoints
> **✅ STATUS: SHIPPED (2026-06-27).** All 5 endpoints added under `/api/v1`, each wrapping
> the SAME loader its RSC page uses + a JSON-safe serializer at the edge (Decimal→string,
> Date→ISO): `GET /client/home`, `GET /me`, `GET /u/[handle]`, `GET /offerings/[id]`,
> `GET /professionals/[id]`. The two inline page loaders (offerings, pro profile) were
> extracted to `_data/` modules the pages now import (web + native share one path).
> `professionals/[id]` collapses not-found + not-viewable(pending) to a uniform 404 (no leak);
> `offerings/[id]` returns 404 for non-claimable openings. New serializers `lib/dto/clientHome.ts`,
> `lib/dto/clientMe.ts`; `u/[handle]` returns its already-JSON-safe loader output directly.
> Validated: typecheck + lint + guards + vitest (4709) + production build.
- **What:** Per-entity reads exist, but the dashboard/profile *aggregate* screens read Prisma
  directly in server components with no API a native client can call. Build JSON endpoints for them.
- **Where the gaps are:**
  - Client home dashboard — `app/client/(gated)/page.tsx` via `_data/getClientHomeData.ts`.
    No `GET /api/client/home`.
  - Own-profile "Me" aggregate — no `GET /api/me` (only `app/api/me/following/` exists). Data is
    scattered across `GET /api/client/profile` (`app/api/client/profile/route.ts:39`),
    `/api/client/settings`, `/api/client/bookings`.
  - Pro public profile — `app/professionals/[id]/page.tsx` + `app/p/[handle]/page.tsx` read Prisma
    directly. No `GET /api/professionals/[id]`.
  - Client public profile — `app/u/[handle]`, loader reads Prisma. No `GET /api/u/[handle]`.
  - Offering detail — `app/(main)/offerings/[offeringId]/page.tsx` is RSC; only `offerings/add-ons`
    is JSON.
  - (Already fine — JSON twins exist: `GET /api/client/bookings`, `GET /api/pro/bookings`,
    `GET /api/messages/threads`, `GET /api/availability/day`.)
- **Note for "one source of truth":** when you build these, have the server components ALSO consume
  the new endpoints (or a shared loader the endpoint wraps) so web and native render from the SAME
  data path — don't fork the logic. Reuse the existing DTO builders.
- **Size:** Medium (~5-6 endpoints).

### 2.2 — Freeze a `/v1` API surface + version it
> **✅ STATUS: SHIPPED (2026-06-27).** Physical move (hard cutover, no back-compat alias):
> 221 route files (28 groups) relocated to `app/api/v1/`; all client call-sites, the proxy
> verification allowlist, co-located tests, observability `route:` tags and doc comments
> rewritten to `/api/v1`. **Excluded (stay at `/api`, externally-configured URLs):**
> `webhooks/` (Stripe/Postmark/Twilio), `health/` (uptime), `internal/` (16 `vercel.json`
> cron paths + privacy export/delete). Versioning policy going forward: `/api/v1` is
> additive-only; breaking changes land as a new `/api/v2/<route>`. Validated: typecheck +
> lint + static guards + full vitest (4691) + production build (route tree shows `/api/v1/*`).
- **What:** ~~There is NO API versioning — flat `/api/*` paths, no `/v1/`, no version header.~~ Done.
- **Why:** Fine for a web client shipped lockstep. For independently-released native apps it's a
  churn risk: any breaking change silently breaks old installs. Freeze a `/v1` contract before
  native ships.
- **Size:** Medium. Cheapest to do now, most expensive to retrofit later — do it early.

### 2.3 — Consolidate DTOs + add schema/codegen export (single source of truth for types)
> **✅ STATUS: SHIPPED (2026-06-27).** Approach: keep the Prisma-derived TS DTOs (no zod),
> add a barrel + generate JSON Schema. `lib/dto/index.ts` re-exports the wire response DTOs
> from across `lib/dto`, `lib/looks/types`, `lib/profiles`, `lib/search`, `lib/follows`,
> `lib/lastMinute`, `lib/contracts`, and the 2.1 loaders (excludes raw `*Row`/`*Plan`/`*Args`
> input types + internal admin/job contracts). `npm run gen:api-schema` →
> `ts-json-schema-generator` → `schema/api/tovis-api.schema.json` (151 definitions) — native
> codegens from this. A `check:api-schema` guard (wired into `check:static-guards`) fails CI if
> the committed schema drifts from the DTOs (output is deterministic). Validated: typecheck +
> lint + guards + vitest (4709) + build.
- **What:** DTO helpers exist but scattered (`lib/dto/clientBooking.ts`, `lib/dto/proBookingNew.ts`,
  `lib/contracts/*`, `lib/search/contracts.ts`, `lib/lastMinute/openingDto.ts`, `lib/typed/`). No
  single barrel, no OpenAPI/zod schema export.
- **Why:** A native (Swift/Kotlin) client either hand-writes models (drift risk) or generates them
  from a schema. One generated schema = one source of truth for the wire contract.
- **Where:** Add a `lib/dto/index.ts` barrel + an OpenAPI or zod-to-schema export the native build
  can codegen from. House rule already pins Prisma as the type source — build the export on top.
- **Size:** Low-Medium.

---

## TIER 3 — Payments for native + App Store policy

### 3.1 — ⚠️ POLICY: Get the pro membership reviewed before submitting the pro app
- **What:** The pro membership is a recurring **digital subscription** ($25/mo / $240/yr) unlocking
  **purely digital entitlements** (custom handle, analytics, priority discovery, reduced fee).
- **Why it matters:** That is exactly the pattern Apple/Google classify as digital goods requiring
  their in-app purchase (30%/15%). Your defense is the B2B/business-tool exemption (sold to pros
  running a business) — defensible but NOT automatic. If a store pushes back, membership purchase
  may have to move out of the app (web-only, no in-app buy button).
- **Where:** `app/api/pro/membership/checkout/route.ts:39-59`, `lib/pro/entitlements.ts:25-44`,
  `lib/membership/plans.ts:48-60`.
- **SAFE (no action):** client deposits, final checkout, tips for in-person services = "real-world
  services," exempt from IAP, Stripe allowed. No gift cards/credits/wallet exist.
- **Size:** Decision/legal, not code (unless they make you move it).

### 3.2 — Deep links / Universal Links / App Links for all Stripe redirect returns
- **What:** Payments are 100% server-side Stripe Checkout (hosted redirect) + webhooks — the EASY
  case (no Stripe Elements to port; native routes through the same webhooks unchanged). But every
  `success_url`/`cancel_url`/`return_url` and Connect onboarding return is a hardcoded web URL off
  `NEXT_PUBLIC_APP_URL`. Native must open hosted Checkout in an in-app browser
  (ASWebAuthenticationSession / Chrome Custom Tabs) and intercept the return via Universal Links /
  App Links.
- **Where (~8 call sites):** `app/api/client/bookings/[id]/deposit/stripe-session/route.ts:53-60`,
  `app/api/client/bookings/[id]/checkout/stripe-session/route.ts:74-87`,
  `app/api/pro/membership/checkout/route.ts` + `lib/membership/urls.ts:21-29`,
  `app/api/pro/payments/stripe/onboarding-link/route.ts:46-58`. Confirm `NEXT_PUBLIC_APP_URL`
  resolves to the Universal-Link-claimed domain (with `apple-app-site-association` /
  `assetlinks.json` hosted there).
- **Size:** Medium (and this deep-link infra is ALSO needed by auth verify/reset + notifications —
  build it once, reuse everywhere).
- **Optional later:** native Stripe SDK + a PaymentIntent `client_secret` endpoint for in-app card
  entry. Not needed for launch — the redirect flow is store-compliant. Server webhooks stay as-is.

---

## TIER 4 — Security that matters MORE on native

### 4.1 — Replace Turnstile with native attestation (App Attest / Play Integrity)
- **What:** Signup abuse defense is a Cloudflare **browser** captcha — native can't solve it.
- **Where:** `lib/auth/turnstile.ts` (fail-open hard-disabled in prod), used on
  `app/api/auth/register/route.ts:771`. A verified captcha unlocks the looser `auth:register:verified`
  (20/hr) bucket vs `auth:register` (5/hr).
- **Do:** Gate the same bucket with App Attest (iOS) / Play Integrity (Android). Don't let "no token"
  silently fall through. Note: **login has no captcha at all** — native amplifies that.
- **Size:** Medium.

### 4.2 — Token storage, per-device revocation, cert pinning
- **What:** (a) JWT must live in iOS Keychain / Android Keystore, never plain storage. (b) Revocation
  today is a coarse `authVersion` bump that kills ALL sessions — add per-device session records (ties
  into the `DeviceToken` model from 1.1) so a lost phone can be revoked alone. (c) Add TLS cert/
  public-key pinning (new concern vs same-origin web).
- **Size:** Medium (device records overlap with push work).

### 4.3 — Deep-link validation + hash the raw invite token
- **What:** Tovis is token-heavy (NFC taps `/t/[cardId]` `/c/[code]`, aftercare/rebook/consultation
  magic links, account invites). Native deep-link handlers must validate host/path/token before
  acting (universal-link hijacking / malicious intents are a new class).
- **Also:** `ProClientInvite.token` is still stored/looked-up as a **raw** token (accepted web risk) —
  hash it before it flows through deep links and device logs.
- **Size:** Low-Medium.

### 4.4 — Verify `AUTH_TRUSTED_IP_HEADER` for the native ingress path
- **What:** Per-IP rate limiting is the main abuse control once captcha is gone, and it depends on
  `AUTH_TRUSTED_IP_HEADER` being the real ingress header (`lib/trustedClientIp.ts`). Native traffic
  may arrive via a different ingress (CDN vs direct) — a misconfig collapses all native clients into
  one bucket or lets them spoof. Re-verify before launch.
- **Also tune:** IP-only auth buckets (`auth:login` 10/15min, `auth:register` 5/hr in
  `lib/rateLimit/policies.ts`) may trip for many users behind one carrier NAT. Add per-phone/email
  keying; raise IP ceilings for mobile scale. (Authenticated buckets key on `user:<id>` — already safe.)
- **Size:** Low (ops verification) + Low (rate-limit tuning).

### 4.5 — Pre-existing security debt to close before widening exposure (not native-specific)
- Finish the **log-redaction audit** — `docs/security/log-redaction-audit.md` is still all "Pending";
  only the auth-event sanitizer is test-proven. Mobile crash/analytics SDKs raise PII-leak risk.
- **Encrypt raw email at rest** (currently plaintext, only hashed for lookup — roadmap P1).
- Fix stale doc: `docs/security/contact-lookup-hash-threat-model.md` describes SHA-256, but code
  already migrated to keyed HMAC-SHA256 v2 and dropped the legacy columns.

---

## TIER 5 — Native UI rebuilds (expected throwaway — not "fixes", just scope)

These are web-only by nature; native rebuilds the view but the DATA layer is already clean & reusable.

- **Maps:** Leaflet is quarantined to ONE file — `app/(main)/search/_components/MapView.tsx` (lazy,
  `ssr:false`). Rebuild on MapKit / Google Maps / `react-native-maps`. The geo data contract is clean:
  pure `{id,lat,lng,label}` pins; geocoding/places/nearby behind server JSON proxies on raw lat/lng
  (`app/api/google/*`, `app/api/pros/nearby/route.ts`). `lib/maps.ts` already builds native map deep
  links. **Reuse all the geo APIs; rebuild only the map view.**
- **Geolocation:** one browser call — `SearchMapClient.tsx:573-580`
  (`navigator.geolocation`). Swap for CoreLocation/FusedLocation; everything downstream is
  query-string-coordinate APIs and works unchanged.
- **Media upload:** reuse the sign→PUT→attach JSON API + `UploadSession` model as-is. Only two
  ~100-line browser shims are throwaway: `lib/media/uploadWithProgress.ts` (XHR PUT — documented wire
  contract: **PUT** not POST, `apikey: <anon>`, `Content-Type`, `x-upsert`) and
  `lib/media/processImageForUpload.ts` (canvas compression — replace with platform image APIs; stay
  under the 30 MB server cap at `app/api/pro/uploads/route.ts:184`).
- **Private media caching gotcha:** private-bucket URLs are signed with a **10-minute TTL**
  (`lib/media/renderUrls.ts:7,43-57`). Native must cache decoded **bytes keyed by mediaId**, NOT the
  URL, and re-sign via `GET /api/media/url?id=...` on expiry. Public-bucket URLs are permanent —
  cache freely.
- **DO NOT** use a Capacitor/webview wrapper: `next.config.ts` sets `X-Frame-Options: DENY` and
  `Permissions-Policy: camera=(), microphone=(), payment=()` which block the camera + payment a
  webview would need. No CORS is configured. Native+REST is the supported path.

---

## Suggested sequence (dependency order)

1. **Tier 0** — bearer auth + Origin carve-out + token-in-body + refresh. One PR. Unblocks everything.
2. **Tier 2.2** — freeze `/v1` (cheap now, expensive later).
3. **Tier 2.1 / 2.3** — aggregate read endpoints + DTO barrel/schema export.
4. **Tier 4.1** — native attestation replacing Turnstile; rate-limit key tuning (4.4).
5. **Tier 1.1** — push backend (`DeviceToken` model overlaps with per-device revocation in 4.2).
6. **Tier 3.2 / deep-link infra** — needed by payments AND auth verify/reset AND notifications.
7. **Tier 3.1** — policy review of pro membership before pro-app store submission.
8. Then build the native client(s), reusing geo/upload/booking APIs (Tier 5 is client-side scope).

---

## Quick reference — key files

- **Auth:** `lib/auth.ts`, `lib/currentUser.ts:120-139`, `lib/auth/middlewareToken.ts`,
  `proxy.ts:202-266`, `app/api/_utils/auth/sessionCookie.ts`, `app/api/_utils/auth/requireUser.ts`
- **Origin/CSRF guard:** `proxy.ts:168-266`
- **Notifications engine:** `lib/notifications/dispatch/enqueueDispatch.ts`,
  `lib/notifications/delivery/{processDueDeliveries,runNotificationDrain,providerPolicy,channelPolicy}.ts`,
  `lib/notifications/eventKeys.ts`, `prisma/schema.prisma:582-940`
- **Payments:** `lib/stripe/*`, `app/api/webhooks/stripe/route.ts`,
  `app/api/client/bookings/[id]/{deposit,checkout}/stripe-session/route.ts`,
  `app/api/pro/membership/checkout/route.ts`, `lib/membership/*`, `lib/pro/entitlements.ts`
- **Media/geo:** `lib/media/{uploadSession,renderUrls,uploadWithProgress,processImageForUpload}.ts`,
  `app/api/{pro,client}/uploads/route.ts`, `app/api/media/url/route.ts`,
  `app/(main)/search/_components/MapView.tsx`, `lib/maps.ts`, `app/api/google/*`,
  `app/api/pros/nearby/route.ts`
- **Rate limit / abuse:** `lib/rateLimit/{enforce,policies,identity}.ts`, `lib/trustedClientIp.ts`,
  `lib/auth/turnstile.ts`
- **Config:** `next.config.ts` (security headers), `vercel.json`, `app/manifest.ts` (PWA manifest
  already exists, white-label aware)
