// lib/rateLimit/policies.ts

export type RateLimitBucket =
  | 'holds:create'
  | 'bookings:finalize'
  | 'bookings:cancel'
  | 'bookings:refund'
  | 'bookings:reschedule'
  | 'looks:like'
  | 'looks:comment'
  | 'consultation:decision'
  | 'consultation:decision:token'
  | 'account-invite:mint'
  | 'account-invite:mint:token'
  | 'client:rebook:token'
  | 'client:checkout:token'
  | 'pro:bookings:write'
  | 'pro:media:write'
  | 'pro:offerings:write'
  | 'pro:locations:write'
  | 'pro:working-hours:write'
  | 'google:proxy'
  | 'pro-license:verify'
  | 'messages:send'
  | 'messages:read'
  | 'nfc:tap'
  | 'nfc:code'
  | 'auth:login'
  | 'auth:login:identity'
  | 'auth:apple'
  | 'auth:phone-login'
  | 'auth:register'
  | 'auth:register:verified'
  | 'auth:password-reset-request'
  | 'auth:password-reset-request:identity'
  | 'auth:password-reset-confirm'
  | 'auth:phone:verify'
  | 'auth:email:send'
  | 'auth:email:verify'
  | 'auth:sms-phone-hour'
  | 'auth:sms-phone-day'

export type RateLimitMode = 'redis-only' | 'auth-critical'

export type RateLimitConfig = {
  limit: number
  windowSeconds: number
  prefix: string
  mode: RateLimitMode
}

export const RATE_LIMITS: Record<RateLimitBucket, RateLimitConfig> = {
  'holds:create': {
    limit: 12,
    windowSeconds: 60,
    prefix: 'rl:holds:create',
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
}