# Live-sync (web ⇄ iOS)

Keeps the salon computer (web) and the phone (iOS) showing the same data without
manual reloads. Two layers; both are safe to run independently.

## Layer 1 — refresh on focus + poll (zero infra)

- **Web:** `app/_components/live/RefreshOnFocus.tsx` re-runs the route's server
  components (`router.refresh()`) when the tab regains focus/visibility (mounted
  in the client + pro layouts), and polls every 20s on the server-rendered pro
  bookings list.
- **iOS:** refetches when the app foregrounds and polls every 30s while a screen
  is open (`SessionModel.refreshTick`).

Always on; no configuration.

## Layer 2 — Supabase Realtime push (notify-then-refetch)

After a write, the server broadcasts a tiny "changed" ping on audience-scoped
channels; clients refetch through the normal `/api/v1` loaders (the ping carries
no data, so the single source of truth + auth checks are preserved).

- **Channels:** `pro:{professionalId}` (the salon) and `user:{userId}` (a
  person's devices). Helpers in `lib/live/broadcast.ts`.
- **Server emits** from the write hooks (currently booking finalize +
  consultation decision) via the Realtime HTTP broadcast API. **Fail-open** — a
  failed/unconfigured broadcast never affects the write; clients fall back to
  Layer 1.
- **Web subscribes** in `app/_components/live/LiveRefresh.tsx` (supabase-js).
- **iOS subscribes** via `TovisKit/.../Live/SupabaseRealtime.swift`.

### Configuration

No database/publication changes are needed — **Broadcast is pub/sub, not Postgres
CDC**, so it works on the existing Supabase project out of the box.

Reuses existing env (nothing new):

| Side | Vars |
|------|------|
| Server (broadcast) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Web (subscribe) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| iOS (subscribe) | `TovisConfig.supabaseURL` + `supabaseAnonKey` (set per env in `tovis-ios`; same public URL + anon key) |

### Security note (v1)

v1 uses **public broadcast channels** (anon key). The payload is a non-sensitive
invalidation ping and channels are keyed by opaque ids, so the worst case is that
someone who already knows a valid id could learn *activity timing* — never data.
Before large multi-tenant scale, upgrade to **authorized channels** (Realtime
Authorization / RLS on `realtime.messages`) with a short-lived per-user token
minted by the API.

### Extending

To make another write live, call `broadcastLive([...channels], topic)` after the
write succeeds (see the finalize/consultation routes). Add the affected pro/user
channels. Subscribers already refetch on any `changed` event, so no client change
is needed for a new topic.
