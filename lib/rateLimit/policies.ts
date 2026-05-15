// lib/rateLimit/policies.ts

export type RateLimitBucket =
  | 'holds:create'
  | 'bookings:finalize'
  | 'bookings:cancel'
  | 'bookings:reschedule'
  | 'looks:like'
  | 'looks:comment'
  | 'consultation:decision'
  | 'consultation:decision:token'
  | 'client:rebook:token'
  | 'pro:bookings:write'
  | 'pro:media:write'
  | 'pro:offerings:write'
  | 'pro:locations:write'
  | 'pro:working-hours:write'
  | 'google:proxy'
  | 'messages:send'
  | 'messages:read'
  | 'auth:login'
  | 'auth:register'
  | 'auth:register:verified'
  | 'auth:password-reset-request'
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
  'client:rebook:token': {
    limit: 10,
    windowSeconds: 5 * 60,
    prefix: 'rl:client:rebook:token',
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

  // Auth-critical buckets: bounded locally if Redis fails.
  'auth:login': {
    limit: 10,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:login',
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
  'auth:password-reset-request': {
    limit: 5,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:pw-reset-req',
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