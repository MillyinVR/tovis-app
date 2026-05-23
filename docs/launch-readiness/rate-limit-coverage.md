# Rate-limit coverage

This document tracks high-risk route-level rate-limit coverage for launch readiness.

## Coverage table

| Route | Bucket | Identity | Status | Test |
|---|---|---|---:|---|
| `POST /api/holds` | `holds:create` | `client:{clientId}|ip:{ip}` | DONE | `app/api/holds/route.test.ts` |
| `POST /api/bookings/finalize` | `bookings:finalize` | authenticated client or aftercare token actor + IP | DONE | `app/api/bookings/finalize/route.test.ts` |
| `POST /api/bookings/[id]/cancel` | `bookings:cancel` | `client:{clientId}|ip:{ip}` / `pro:{professionalId}|user:{userId}|ip:{ip}` | DONE | `app/api/bookings/[id]/cancel/route.test.ts` |
| `POST /api/bookings/[id]/reschedule` | `bookings:reschedule` | `client:{clientId}|ip:{ip}` | DONE | `app/api/bookings/[id]/reschedule/route.test.ts` |
| `POST /api/pro/bookings/[id]/checkout/mark-paid` | `pro:bookings:write` | `pro:{professionalId}|user:{userId}|ip:{ip}` | DONE | `app/api/pro/bookings/[id]/checkout/mark-paid/route.test.ts` |
| `POST /api/pro/bookings/[id]/checkout/waive` | `pro:bookings:write` | `pro:{professionalId}|user:{userId}|ip:{ip}` | DONE | `app/api/pro/bookings/[id]/checkout/waive/route.test.ts` |
| `POST /api/pro/bookings/[id]/media` | `pro:media:write` | `pro:{professionalId}|user:{userId}|ip:{ip}` | DONE | `app/api/pro/bookings/[id]/media/route.test.ts` |
| `POST /api/pro/bookings/[id]/aftercare` | `pro:bookings:write` | `pro:{professionalId}|user:{userId}|ip:{ip}` | DONE | `app/api/pro/bookings/[id]/aftercare/route.test.ts` |
| `POST /api/client/rebook/[token]` | `client:rebook:token` | `token:{hash}|ip:{ip}` | DONE | `app/api/client/rebook/[token]/route.test.ts` |
| `POST /api/public/consultation/[token]/decision` | `consultation:decision:token` | `token:{hash}|ip:{ip}` | DONE | `app/api/public/consultation/[token]/decision/route.test.ts` |

## Supporting proof

- Header shape is covered centrally by `lib/rateLimit/enforce.test.ts` and `app/api/_utils/rateLimit.test.ts`.
- Route-level tests prove blocked decisions return `429`, do not call the mutation/write boundary, and use the expected bucket/identity for the routes listed above.

## Done criteria

A route is `DONE` when:

- it calls `enforceRateLimit()` before idempotency/mutation;
- a blocked decision returns `429`;
- blocked requests do not call the mutation/write boundary;
- tests verify bucket and identity key;
- response includes `RateLimit-*` and `Retry-After` headers.
