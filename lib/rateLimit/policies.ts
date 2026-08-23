// lib/rateLimit/policies.ts

export type RateLimitBucket =
  | 'holds:create'
  | 'holds:update'
  | 'bookings:finalize'
  | 'bookings:cancel'
  | 'bookings:refund'
  | 'bookings:reschedule'
  | 'looks:like'
  | 'looks:comment'
  | 'waitlist:write'
  | 'consultation:decision'
  | 'consultation:decision:token'
  | 'account-invite:mint'
  | 'account-invite:mint:token'
  | 'client:consult:write'
  | 'client:consult:vision'
  | 'client:rebook:token'
  | 'client:checkout:token'
  | 'client:deposit:token'
  | 'client:appointment:token'
  | 'client:consent:token'
  | 'client:appointment:answer'
  | 'pro:bookings:write'
  | 'pro:media:write'
  | 'pro:media:evidence-bundle'
  | 'pro:offerings:write'
  | 'pro:locations:write'
  | 'pro:working-hours:write'
  | 'pro:finance:expenses:write'
  | 'pro:camera:look-brief'
  | 'pro:camera:set-critique'
  | 'pro:client-claim-invite'
  | 'google:proxy'
  | 'pro-license:verify'
  | 'messages:send'
  | 'messages:read'
  | 'support:tickets:create'
  | 'nfc:tap'
  | 'nfc:code'
  | 'short-link:resolve'
  | 'auth:login'
  | 'auth:login:identity'
  | 'auth:apple'
  | 'auth:google'
  | 'auth:phone-login'
  | 'auth:register'
  | 'auth:register:verified'
  | 'auth:self-serve-claim'
  | 'auth:password-reset-request'
  | 'auth:password-reset-request:identity'
  | 'auth:password-reset-confirm'
  | 'auth:phone:verify'
  | 'auth:email:send'
  | 'auth:email:verify'
  | 'auth:sms-phone-hour'
  | 'auth:sms-phone-day'
  | 'auth:session-handoff:issue'
  | 'auth:session-handoff:exchange'
  | 'presence:signals'
  | 'presence:signals:batch'

export type RateLimitMode = 'redis-only' | 'auth-critical'

export type RateLimitConfig = {
  limit: number
  windowSeconds: number
  prefix: string
  mode: RateLimitMode
}

export const RATE_LIMITS: Record<RateLimitBucket, RateLimitConfig> = {
  // Presence is the only unauthenticated read surface with a Postgres query
  // behind it: every call counts ACTIVE waitlist entries for a professional, on
  // top of a Redis read. It is reachable with no session because the public
  // offering page renders it for anonymous visitors, so the key is the IP and
  // the ceiling is what bounds both the DB load and a competitor scraping any
  // pro's waitlist depth.
  //
  // Sizing: the hook polls every 15s while active, so one open tab is 4/min.
  // 120 leaves room for ~30 concurrent viewers behind one NAT'd IP (a salon on
  // shared wifi) while still capping a scraper at 2 requests a second.
  'presence:signals': {
    limit: 120,
    windowSeconds: 60,
    prefix: 'rl:presence:signals',
    mode: 'redis-only',
  },
  // Half the ceiling, because one batch request fans out to up to MAX_ITEMS (50)
  // resources — so the same number of requests is up to 50x the work.
  'presence:signals:batch': {
    limit: 60,
    windowSeconds: 60,
    prefix: 'rl:presence:signals:batch',
    mode: 'redis-only',
  },
  'holds:create': {
    limit: 12,
    windowSeconds: 60,
    prefix: 'rl:holds:create',
    mode: 'redis-only',
  },
  // Re-sizing a hold to a new add-on selection fires once per toggle, so this
  // is sized for a human ticking boxes rather than for the once-per-booking
  // shape of holds:create. It still needs a ceiling: the route takes the pro's
  // schedule lock, and a client with one live hold could otherwise hammer it
  // for the hold's whole lifetime.
  'holds:update': {
    limit: 40,
    windowSeconds: 60,
    prefix: 'rl:holds:update',
    mode: 'redis-only',
  },
  'bookings:finalize': {
    limit: 12,
    windowSeconds: 60,
    prefix: 'rl:bookings:finalize',
    mode: 'redis-only',
  },
  'bookings:cancel': {
    limit: 8,
    windowSeconds: 5 * 60,
    prefix: 'rl:bookings:cancel',
    mode: 'redis-only',
  },
  'bookings:refund': {
    limit: 10,
    windowSeconds: 5 * 60,
    prefix: 'rl:bookings:refund',
    mode: 'redis-only',
  },
  'bookings:reschedule': {
    limit: 8,
    windowSeconds: 5 * 60,
    prefix: 'rl:bookings:reschedule',
    mode: 'redis-only',
  },
  'looks:like': {
    limit: 60,
    windowSeconds: 60,
    prefix: 'rl:looks:like',
    mode: 'redis-only',
  },
  'looks:comment': {
    limit: 12,
    windowSeconds: 60,
    prefix: 'rl:looks:comment',
    mode: 'redis-only',
  },
  // Join / edit-preferences / leave on `/api/v1/waitlist`, all three on ONE
  // bucket and keyed per CLIENT (not per client+pro), which is the deliberate
  // half of this policy:
  //
  //  - The join is already deduped per (client, pro, service) for a live entry,
  //    so the unbounded shape is the CYCLE — leave flips the entry to CANCELLED,
  //    which the dup check does not match, so join→leave→join mints a fresh
  //    WaitlistEntry plus a fresh MessageThread and seed Message in the pro's
  //    inbox every lap. A shared bucket makes a lap cost two tokens, so it
  //    bounds the cycle rather than each half of it.
  //  - Per client+pro would bound that cycle against ONE pro while still
  //    allowing the same client to run it against every pro on the platform.
  //    Per-client bounds total fan-out, and costs a legitimate user nothing: a
  //    join is a form submission, so 20/min is far above human use while a
  //    script drops from unlimited to 20.
  'waitlist:write': {
    limit: 20,
    windowSeconds: 60,
    prefix: 'rl:waitlist:write',
    mode: 'redis-only',
  },
  'consultation:decision': {
    limit: 8,
    windowSeconds: 5 * 60,
    prefix: 'rl:consultation:decision',
    mode: 'redis-only',
  },
  'consultation:decision:token': {
    limit: 12,
    windowSeconds: 5 * 60,
    prefix: 'rl:consultation:decision:token',
    mode: 'redis-only',
  },
  // Public account-invite (magic-link) claim-link mint. Keyed by IP and by
  // token-prefix so a leaked partial token can't be brute-forced across many
  // IPs. Mirrors the consultation:decision ceilings.
  'account-invite:mint': {
    limit: 8,
    windowSeconds: 5 * 60,
    prefix: 'rl:account-invite:mint',
    mode: 'redis-only',
  },
  'account-invite:mint:token': {
    limit: 12,
    windowSeconds: 5 * 60,
    prefix: 'rl:account-invite:mint:token',
    mode: 'redis-only',
  },
  'client:rebook:token': {
    limit: 10,
    windowSeconds: 5 * 60,
    prefix: 'rl:client:rebook:token',
    mode: 'redis-only',
  },
  'client:checkout:token': {
    limit: 10,
    windowSeconds: 5 * 60,
    prefix: 'rl:client:checkout:token',
    mode: 'redis-only',
  },
  // K10-B: the public deposit pay link (same shape as the aftercare token
  // checkout — a Stripe-session mint per tap, bounded per token+IP).
  'client:deposit:token': {
    limit: 10,
    windowSeconds: 5 * 60,
    prefix: 'rl:client:deposit:token',
    mode: 'redis-only',
  },
  // K12: the public appointment action link (confirm/decline/cancel/reschedule
  // per tap, bounded per token+IP — the deposit token's shape, sized a little
  // wider because one visit can legitimately answer, then reschedule).
  'client:appointment:token': {
    limit: 20,
    windowSeconds: 5 * 60,
    prefix: 'rl:client:appointment:token',
    mode: 'redis-only',
  },
  // K15: the public consent-signature link. Tighter than the appointment
  // bucket — signing is ONE act per link (the unique signatureTokenId makes a
  // second impossible), so anything past a handful of attempts is a client
  // fixing a typo in their name, not normal use.
  'client:consent:token': {
    limit: 10,
    windowSeconds: 5 * 60,
    prefix: 'rl:client:consent:token',
    mode: 'redis-only',
  },
  // K13: the same answer from a signed-in client, in the app. Sized like the
  // token bucket's per-tap allowance rather than a write bucket — the answer
  // is idempotent by design (K11's latest-answer-wins), so a client changing
  // their mind twice is normal use, not abuse.
  'client:appointment:answer': {
    limit: 20,
    windowSeconds: 5 * 60,
    prefix: 'rl:client:appointment:answer',
    mode: 'redis-only',
  },
  // AI Consult client mutations (create, agreements, intake, capture
  // issue/attach/delete, inspiration, teaser tap) — every non-paid consult
  // write on ONE bucket, keyed per user. The flow is bursty by design: the
  // inspiration step posts one answer per question (7 questions) and the
  // capture step issues+attaches 4 slots back to back, so a fast human can
  // legitimately land ~15 writes in a minute. 30 clears that with headroom
  // while dropping a script from unlimited to 30 — the same envelope as the
  // other authenticated write buckets. Paid provider calls are deliberately
  // NOT in this bucket (see client:consult:vision).
  'client:consult:write': {
    limit: 30,
    windowSeconds: 60,
    prefix: 'rl:client:consult:write',
    mode: 'redis-only',
  },
  // AI Consult paid vision calls: capture quality checks + the analysis run,
  // both on ONE bucket (what needs bounding is total provider spend for the
  // class, not each half — the waitlist:write rationale). Sized like the
  // camera vision buckets: a complete consult is 4 quality checks + a retake
  // allowance + 1 analysis (~6–8 calls), and a client can only mint one
  // session per eligible booking, so 40/day covers several full consults
  // including bad-lighting days while capping worst-case per-user provider
  // spend at a known daily ceiling. This is the abuse backstop; the
  // per-session structural cap in lib/consult/captureContract.ts
  // (CONSULT_CAPTURE_MAX_QUALITY_CHECKS_PER_SESSION) still holds when Redis
  // is unavailable, because redis-only buckets fail open.
  'client:consult:vision': {
    limit: 40,
    windowSeconds: 24 * 60 * 60,
    prefix: 'rl:client:consult:vision',
    mode: 'redis-only',
  },
  'pro:bookings:write': {
    limit: 30,
    windowSeconds: 60,
    prefix: 'rl:pro:bookings:write',
    mode: 'redis-only',
  },
  'pro:media:write': {
    limit: 30,
    windowSeconds: 60,
    prefix: 'rl:pro:media:write',
    mode: 'redis-only',
  },
  // Tighter than pro:media:write: each request downloads every asset in the
  // booking from storage and renders a PDF, so it's real work per call.
  'pro:media:evidence-bundle': {
    limit: 10,
    windowSeconds: 60,
    prefix: 'rl:pro:media:evidence-bundle',
    mode: 'redis-only',
  },
  // Keyed per (pro, client) so a pro can batch-invite many DIFFERENT clients
  // (a migrated list) while no single client can be spammed with claim links.
  'pro:client-claim-invite': {
    limit: 5,
    windowSeconds: 60 * 60,
    prefix: 'rl:pro:client-claim-invite',
    mode: 'redis-only',
  },
  'pro:offerings:write': {
    limit: 30,
    windowSeconds: 60,
    prefix: 'rl:pro:offerings:write',
    mode: 'redis-only',
  },
  'pro:locations:write': {
    limit: 12,
    windowSeconds: 60,
    prefix: 'rl:pro:locations:write',
    mode: 'redis-only',
  },
  'pro:working-hours:write': {
    limit: 12,
    windowSeconds: 60,
    prefix: 'rl:pro:working-hours:write',
    mode: 'redis-only',
  },
  'pro:finance:expenses:write': {
    limit: 30,
    windowSeconds: 60,
    prefix: 'rl:pro:finance:expenses:write',
    mode: 'redis-only',
  },
  // Claude-vision camera features. These buckets used to BE the allowance ("free
  // with a daily cap"). As of 2026-08-04 the allowance is the per-plan monthly
  // quota (CAMERA_IMAGES_PER_MONTH in lib/pro/entitlements.ts) and these are the
  // abuse backstop underneath it — see docs/design/membership-value-brief.md §5.1.A.
  //
  // 🔴 The limiter is PLAN-BLIND: one bucket serves free and paid alike, so its
  // floor is set by the TOP tier, not the free one. Premium buys 500 images/month,
  // so the daily ceiling must clear ~17/day comfortably or a paying pro could not
  // spend what they bought. 40 briefs + 8 critiques = up to 40 + (8 × 10) = 120
  // images/day, which no real pro reaches but which stops one account burning a
  // month's quota in an hour (and caps worst-case Anthropic spend at ~$5/day/pro).
  //
  // Net effect vs. the old numbers: the per-day image ceiling drops 125 → 120, but
  // the cheap single-image call (look-brief) gets more headroom and the expensive
  // 10-photo call (set-critique) gets less, which is where the cost actually is.
  // The real tightening for free pros is the 10/month quota, not this bucket
  // (CAMERA_IMAGES_PER_MONTH.free in lib/pro/entitlements.ts — Tori's final call;
  // the brief had proposed 20 and this comment kept quoting the proposal).
  'pro:camera:look-brief': {
    limit: 40,
    windowSeconds: 24 * 60 * 60,
    prefix: 'rl:pro:camera:look-brief',
    mode: 'redis-only',
  },
  'pro:camera:set-critique': {
    limit: 8,
    windowSeconds: 24 * 60 * 60,
    prefix: 'rl:pro:camera:set-critique',
    mode: 'redis-only',
  },
  'google:proxy': {
    limit: 60,
    windowSeconds: 60,
    prefix: 'rl:google:proxy',
    mode: 'redis-only',
  },
  'pro-license:verify': {
    limit: 20,
    windowSeconds: 5 * 60,
    prefix: 'rl:pro-license:verify',
    mode: 'redis-only',
  },
  'messages:send': {
    limit: 18,
    windowSeconds: 60,
    prefix: 'rl:messages:send',
    mode: 'redis-only',
  },
  'messages:read': {
    limit: 120,
    windowSeconds: 60,
    prefix: 'rl:messages:read',
    mode: 'redis-only',
  },

  // Native support-ticket filing, keyed per user (the route is bearer-only, so
  // there is always a real user). Every ticket fans out an admin notification,
  // so the ceiling bounds how far a single account can flood the admin queue —
  // an hour window because a person files a couple of tickets, not a burst.
  // Fail-open: a Redis outage must not block someone trying to report a problem.
  'support:tickets:create': {
    limit: 5,
    windowSeconds: 60 * 60,
    prefix: 'rl:support:tickets:create',
    mode: 'redis-only',
  },

  // Public NFC tap surfaces, keyed by client IP. A real person taps a handful of
  // times; these ceilings only bite enumeration/abuse. Fail-open (redis-only) so
  // a Redis outage never blocks a legitimate tap-to-book.
  'nfc:tap': {
    limit: 30,
    windowSeconds: 60,
    prefix: 'rl:nfc:tap',
    mode: 'redis-only',
  },
  // Short codes are typed by hand and the brute-force/enumeration vector, so the
  // window is tighter than a direct card tap.
  'nfc:code': {
    limit: 15,
    windowSeconds: 5 * 60,
    prefix: 'rl:nfc:code',
    mode: 'redis-only',
  },

  // Public SMS/email short-link resolver (/s/[code]). Tapped from a link, not
  // hand-typed — codes are 8-char base62 (~2.18e14 possibilities), so this is
  // defense-in-depth against enumeration/scraping rather than a realistic
  // brute-force ceiling. Sized like nfc:tap (a real person taps a handful of
  // times). Fail-open so a Redis outage never blocks a legitimate tap.
  'short-link:resolve': {
    limit: 30,
    windowSeconds: 60,
    prefix: 'rl:short-link:resolve',
    mode: 'redis-only',
  },

  // Auth-critical buckets: bounded locally if Redis fails.
  //
  // Login defense is two-dimensional so neither carrier-grade NAT nor a single
  // attacker degrades the other:
  //  - `auth:login` is the COARSE per-IP ceiling. Under CGNAT thousands of real
  //    users can share one egress IP, so this is deliberately generous — it only
  //    bounds a single IP spraying many accounts, not legitimate shared traffic.
  //  - `auth:login:identity` is the TIGHT per-account guard, keyed by IP+email
  //    (the email rides in as a keySuffix). Because the key is composite, a
  //    remote attacker can never exhaust a victim's bucket (the victim logs in
  //    from their own IP), so there is no targeted-lockout DoS — while brute
  //    force from any single origin is still capped hard.
  'auth:login': {
    limit: 60,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:login',
    mode: 'auth-critical',
  },
  'auth:login:identity': {
    limit: 8,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:login:id',
    mode: 'auth-critical',
  },
  // Sign in with Apple. Keyed per-IP; generous enough for shared NAT but bounds
  // token-replay abuse. Auth-critical so a Redis outage degrades to in-memory,
  // not unlimited.
  'auth:apple': {
    limit: 20,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:apple',
    mode: 'auth-critical',
  },
  // Google Sign-In token exchanges, per IP. Same envelope as Apple: verified
  // OIDC id-tokens, rate-limited to blunt token-replay abuse. Auth-critical so a
  // Redis outage degrades to in-memory, not unlimited.
  'auth:google': {
    limit: 20,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:google',
    mode: 'auth-critical',
  },
  // Phone-OTP login verify attempts, per IP. (Per-phone SMS volume is bounded
  // separately by the sms-phone buckets on the send path, and Twilio Verify caps
  // code-check attempts.) Auth-critical so a Redis outage degrades to in-memory.
  'auth:phone-login': {
    limit: 15,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:phone-login',
    mode: 'auth-critical',
  },
  'auth:register': {
    limit: 5,
    windowSeconds: 60 * 60,
    prefix: 'rl:auth:register',
    mode: 'auth-critical',
  },
  'auth:register:verified': {
    limit: 20,
    windowSeconds: 60 * 60,
    prefix: 'rl:auth:register:verified',
    mode: 'auth-critical',
  },
  // Cold self-serve claim: caps how often a claim link is (re)sent for the SAME
  // matched unclaimed profile, keyed by that profile id — so a signup contact a
  // stranger happens to know can't be used to spam the on-file owner across IPs.
  // redis-only (fail-open) like account-invite:mint; the upstream auth:register
  // bucket already fails closed, so a Redis outage can't turn this into a vector.
  'auth:self-serve-claim': {
    limit: 3,
    windowSeconds: 60 * 60,
    prefix: 'rl:auth:self-serve-claim',
    mode: 'redis-only',
  },
  // Password-reset request mirrors the login two-dimensional shape: a generous
  // per-IP ceiling for NAT tolerance, plus a tight IP+email composite guard so a
  // single account can't be flooded with reset mail from one origin. The route
  // stays enumeration-safe — the limit triggers on attempt count regardless of
  // whether the account exists, so a 429 leaks nothing.
  'auth:password-reset-request': {
    limit: 20,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:pw-reset-req',
    mode: 'auth-critical',
  },
  'auth:password-reset-request:identity': {
    limit: 5,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:pw-reset-req:id',
    mode: 'auth-critical',
  },
  'auth:password-reset-confirm': {
    limit: 10,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:pw-reset-confirm',
    mode: 'auth-critical',
  },
  'auth:phone:verify': {
    limit: 10,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:phone:verify',
    mode: 'auth-critical',
  },
  'auth:email:send': {
    limit: 5,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:email:send',
    mode: 'auth-critical',
  },
  'auth:email:verify': {
    limit: 10,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:email:verify',
    mode: 'auth-critical',
  },
  'auth:sms-phone-hour': {
    limit: 5,
    windowSeconds: 60 * 60,
    prefix: 'rl:auth:sms:phone:hour',
    mode: 'auth-critical',
  },
  'auth:sms-phone-day': {
    limit: 6,
    windowSeconds: 24 * 60 * 60,
    prefix: 'rl:auth:sms:phone:day',
    mode: 'auth-critical',
  },
  // Minting a one-time web sign-in hand-off. Keyed per USER (the route is
  // authenticated, so `rateLimitIdentity(user.id)` always resolves to a user
  // key, never a shared NAT'd IP). Sized for a human tapping "Manage on the
  // web": issuing burns the pro's previous unused token, so a loop here cannot
  // accumulate live credentials — the ceiling is about capping the WRITE and
  // making an automated mint loop visible, not about correctness.
  //
  // `auth-critical`: this mints a session credential, so if Redis is down it
  // falls back to the in-memory counter rather than failing open the way an
  // ordinary read bucket does.
  'auth:session-handoff:issue': {
    limit: 20,
    windowSeconds: 5 * 60,
    prefix: 'rl:auth:handoff:issue',
    mode: 'auth-critical',
  },
  // Redeeming one. Keyed by the token's ID HALF (`tokenRateLimitIdentity`), not
  // by IP: the thing worth capping is guessing attempts against a specific
  // token id, and an attacker spreading those across many IPs is the case an
  // IP key would miss. A legitimate redemption happens exactly once, so this
  // ceiling is generous by an order of magnitude — anything approaching it is
  // someone brute-forcing the 32-byte secret half.
  'auth:session-handoff:exchange': {
    limit: 10,
    windowSeconds: 5 * 60,
    prefix: 'rl:auth:handoff:exchange',
    mode: 'auth-critical',
  },
}