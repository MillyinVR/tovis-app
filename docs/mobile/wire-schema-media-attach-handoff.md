# Wire-Schema Coverage — Media Attach Reshape (Handoff)

> **Purpose:** Self-contained brief for a fresh session dedicated to the **last
> remaining wire-schema gap**: the media *attach* endpoints. Everything else in
> the native wire contract is done and enforced (see "Context" below). This task
> is held out separately because, unlike the rest, it **changes live response
> shapes** — so it needs a consumer audit before any reshape.

---

## Context — what's already done (do NOT redo)

The generated JSON Schema wire contract (`lib/dto/index.ts` barrel →
`npm run gen:api-schema` → `schema/api/tovis-api.schema.json`, drift-guarded by
`check:api-schema`) now covers the full native-facing surface **except** media
attach. Schema is at **192 definitions**. Merged PRs (mirror these — same
pattern):

| PR | Coverage |
|----|----------|
| #404 | Availability `alternates` + `other-pros` |
| #405 | Booking holds (GET/POST/DELETE) + a POST raw-`Date` fix |
| #406 | Auth (login/register/refresh/phone-verify/email-verify/resend/verify-code) + workspace-switch |
| #407 | Messaging (threads/messages/resolve/unread) + explicit Date→ISO serialization |
| #408 | Media **signing** (`media/url` + pro/client/admin upload-init) |
| #409 | Availability `day` + `bootstrap` (offering serializer) |

**The established recipe (follow it exactly):**
1. Add a `lib/dto/<group>.ts` with response DTO types (response data only — `ok`
   is added by `jsonOk` and is NOT part of the DTO; see `jsonOk` in
   `app/api/_utils/responses.ts` — it strips any caller `ok` and injects
   `ok: true`).
2. Tie each DTO to the route's **real** return via `satisfies <DTO>` at the
   return site (or by typing the serializer's return). This is the no-drift
   guarantee — never declare a DTO the route doesn't actually emit.
3. Serialize at the edge: `Date → .toISOString()` (string), `Decimal → String()`
   (string). DTOs declare `string`, never `Date`/`Decimal`/`unknown`.
4. Re-export the new types from `lib/dto/index.ts`.
5. `npm run gen:api-schema`, then the full gate:
   `npm run typecheck && npm run lint && npm run check:static-guards` + the
   relevant `vitest` route suites.

---

## The task — reshape the media attach endpoints

These endpoints currently return **entire Prisma rows** (`MediaAsset` /
`Review` / `LookPost`). That is exactly the raw-Prisma-payload leakage that #397
deliberately stripped out of the schema, so they were excluded. Publishing them
cleanly means **reshaping the live response** into a picked DTO — which can drop
a field a current web consumer reads. **That is the whole risk.**

### Endpoints + current return shapes (re-confirm before editing)

- **`app/api/v1/pro/media/route.ts`** — `POST` (~`:368`):
  `{ media: <full MediaAsset created row>, lookPublication?: <LookPost row> }`.
- **`app/api/v1/pro/bookings/[id]/media/route.ts`**:
  - `POST` (~`:393`): `{ item: { ...full MediaAsset, + rendered url/thumbUrl +
    renderUrl/renderThumbUrl, advancedTo: string | null } }`.
  - `GET` (~`:163`): `{ items: <full MediaAsset rows> }` — also needs a DTO.
- **`app/api/v1/client/reviews/[id]/media/route.ts`** — `POST` (~`:390`):
  `{ createdCount: number, created: <MediaAsset rows w/ rendered URLs>[],
    review: <full Review row> }`.

(Line numbers drift — locate the `jsonOk(...)` calls; the shapes are what matter.)

### Required approach (the reason this is its own session)

1. **Audit every consumer FIRST.** For each endpoint, grep the web client for
   `fetch('/api/v1/pro/media'`, `.../bookings/[id]/media`,
   `.../reviews/[id]/media'` and trace exactly which fields of the returned
   `media` / `item` / `created[]` / `review` / `lookPublication` are read. The
   picked DTO must include **every** field any consumer touches.
2. **Design picked DTOs** (`lib/dto/mediaAttach.ts`) that carry only those
   fields — JSON-safe (no Decimal/Date; serialize `createdAt` etc.). Reuse
   `MediaAttachmentDTO`/`MediaDTO` shapes from `lib/dto/messaging.ts` /
   `lib/dto/media.ts` where they already fit, rather than inventing parallel
   media shapes (house rule: no duplicate logic).
3. **Reshape the routes** to build the DTO explicitly (not `...prismaRow`) and
   `satisfies` it. This is a behavior change: the response loses any
   unreferenced internal columns — that's the point, but it's why step 1 must
   prove nothing read is dropped.
4. **Update tests** that assert on these responses (they likely expect the full
   row) to the picked shape.
5. Full gate + `npm run gen:api-schema` + relevant vitest. Then it can join the
   barrel.

### Acceptance

- Each attach endpoint returns a picked DTO, `satisfies`-enforced, re-exported
  from `lib/dto/index.ts`, schema regenerated, `check:api-schema` green.
- A short note in the PR listing, per endpoint, which consumer fields were
  verified — so the reshape is provably loss-free.
- If any endpoint's row is genuinely consumed wholesale (no safe subset), say so
  and keep it excluded **with the consumer evidence**, rather than publishing a
  leaky full-row type.

---

## Guardrails

- Follow `CLAUDE.md` house rules: no `as any`/type escapes (`as const` is fine),
  no duplicate logic (reuse existing media DTOs), Prisma schema is the data
  source of truth, time via `@/lib/time`, brand strings via `lib/brand`, tone
  utilities not raw colors.
- Branch off `origin/main`; one PR for this task (it's cohesive). Each schema
  regen touches `schema/api/tovis-api.schema.json`, so don't run it in parallel
  with another schema-touching branch.
- Start/end in sync with `origin/main` (see `CLAUDE.md` "Session sync").
- These are **wire-shape** changes (response payloads), so unlike the prior 6
  PRs this one DOES change runtime output — verify behavior, and note that a
  deploy is needed for it to reach prod (auto-deploy is off; `npx vercel@latest
  --prod`).

---

## Quick reference

- **Barrel / codegen:** `lib/dto/index.ts`, `npm run gen:api-schema`,
  `tools/check-api-schema.mjs`, `schema/api/tovis-api.schema.json`.
- **Existing media DTOs to reuse:** `lib/dto/media.ts` (signing),
  `lib/dto/messaging.ts` (`MediaAttachmentDTO`).
- **`jsonOk` semantics:** `app/api/_utils/responses.ts` (strips caller `ok`,
  injects `ok: true`).
- **Render URLs (private = 10-min TTL):** `lib/media/renderUrls.ts`.
