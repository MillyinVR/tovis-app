# Supabase Storage Outage Runbook

Use this runbook when Supabase Storage, media buckets, signed URLs, or booking media workflows are unavailable, degraded, or misconfigured.

This usually means:

```text
/api/health/ready shows checks.storage.status = degraded
before-photo upload fails
after-photo upload fails
signed media URLs fail
media galleries do not load
media metadata exists but object is missing
media object exists but cannot be attached to booking
media-private or media-public bucket lookup fails
```

Supabase Storage is not treated as a critical readiness dependency by default, but it is critical during active appointment workflows because before/after photos may be required for closeout.

## Impact

Supabase Storage supports:

```text
before photos
after photos
profile/avatar media
public media
private booking media
signed URL rendering
media galleries
aftercare photo display
booking closeout requirements
```

Expected user impact:

| Area | Impact |
|---|---|
| Before photos | Pros may be unable to upload required session photos. |
| After photos | Pros may be unable to complete closeout if AFTER photos are required. |
| Media galleries | Existing photos may not render. |
| Aftercare | Client may not see attached service photos. |
| Booking completion | Completion may be blocked if required media cannot be uploaded. |
| Profile/public media | Some profile images or public media may fail. |

## Detection

### Health endpoint

Run:

```bash
curl -i https://YOUR_DOMAIN/api/health/ready
```

Problem signal:

```json
{
  "ok": true,
  "service": "tovis-app",
  "endpoint": "ready",
  "status": "degraded",
  "checks": {
    "storage": {
      "name": "storage",
      "status": "degraded",
      "message": "One or more Supabase Storage buckets are not reachable."
    }
  }
}
```

Possible messages:

```text
Missing env var: NEXT_PUBLIC_SUPABASE_URL
Missing env var: SUPABASE_URL
Missing env var: SUPABASE_SERVICE_ROLE_KEY
Missing env var: SUPABASE_SECRET_KEY
Bucket lookup returned no bucket data.
One or more Supabase Storage buckets are not reachable.
Supabase Storage health check timed out after 2000ms.
```

### App symptoms

Look for:

```text
media upload route returning 500
signed upload token creation failing
media metadata creation failing
object exists check failing
signed URL generation failing
before-photo page blocked
after-photo page blocked
aftercare images missing
storage policy permission denied
bucket not found
```

### Critical routes likely affected

```text
/api/pro/uploads
/api/pro/bookings/[id]/media
/api/media/url
/pro/bookings/[id]/session/before-photos
/pro/bookings/[id]/session/after-photos
/pro/bookings/[id]/aftercare
/client/bookings/[id]
```

## Severity

| Condition | Severity |
|---|---:|
| Storage degraded but media display still works | Medium |
| New before/after uploads fail during active sessions | High |
| Private booking media is publicly readable | Critical |
| Signed URL generation fails for all media | High |
| Storage policy migration accidentally blocks service-role access | High |
| Media metadata and storage objects are drifting | High |
| Only public profile media is affected | Medium |

## First response checklist

```text
1. Confirm /api/health/live.
2. Confirm /api/health/ready.
3. Check whether only storage is degraded.
4. Check Supabase project and Storage status.
5. Check media-private and media-public buckets.
6. Check service-role env vars.
7. Check recent storage policy migrations.
8. Check recent media route changes.
9. Determine whether active appointments are blocked.
10. Decide whether to pause media-required closeout or rollback.
```

## Step 1 — Confirm app and database health

Run:

```bash
curl -i https://YOUR_DOMAIN/api/health/live
curl -i https://YOUR_DOMAIN/api/health/ready
```

If `postgres` is also `down`, switch to:

```text
docs/runbooks/postgres-outage.md
```

If only `storage` is degraded, continue here.

## Step 2 — Check Supabase status

Check the Supabase dashboard for:

```text
project status
storage service status
storage API errors
bucket availability
regional outage
service-role key status
recent policy changes
recent bucket changes
usage limits
```

Record:

```text
provider incident URL
affected region
start time
expected recovery
workaround if available
```

## Step 3 — Check environment variables

Verify production has:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_URL, if used as fallback
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SECRET_KEY, if using legacy fallback
```

Do not paste service-role keys or Supabase secrets into incident notes.

The health probe uses the server-side Supabase admin client. If env vars are missing or invalid, storage readiness will degrade.

## Step 4 — Check bucket existence

Required buckets:

```text
media-private
media-public
```

Confirm both exist in Supabase Storage.

Expected behavior:

| Bucket | Expected public setting |
|---|---|
| `media-private` | Not public |
| `media-public` | Public only if intentionally used for public media |

If a bucket is missing:

```text
1. Confirm whether a migration failed.
2. Re-apply the storage bucket/policy migration if safe.
3. Confirm bucket public/private settings.
4. Re-run /api/health/ready.
```

## Step 5 — Check storage policies

Storage policies should be committed as code and applied consistently.

Check the migration/policy files for:

```text
media-private denies anonymous read/list/write
media-private allows backend/service-role controlled access
media-public public read only if intended
public writes denied
updates/deletes restricted
```

If private media appears publicly accessible, treat as a security incident.

Immediate action for possible private media exposure:

```text
1. Restrict bucket access immediately.
2. Disable public media rendering if needed.
3. Rotate signed URL strategy if tokens/URLs leaked.
4. Identify affected objects.
5. Preserve logs.
6. Notify security/privacy owner.
7. Prepare user notification only after scope is confirmed.
```

Do not make `media-private` public to “fix” rendering. That is not a fix. That is opening the front door and calling it ventilation.

## Step 6 — Check upload-token creation

The upload path usually has two phases:

```text
1. Backend creates signed upload token/path.
2. Client uploads object.
3. Backend verifies object and creates MediaAsset metadata.
```

Check:

```text
/api/pro/uploads
```

Look for errors involving:

```text
booking ownership
phase validation
bucket selection
signed upload URL creation
storage path construction
service role permission
```

Common user-facing symptom:

```text
Pro clicks upload before/after photo and receives an upload error before file transfer starts.
```

## Step 7 — Check media metadata creation

Check:

```text
/api/pro/bookings/[id]/media
```

Look for errors involving:

```text
storageBucket mismatch
storagePath prefix mismatch
object does not exist
wrong bookingId in path
wrong phase in path
invalid MediaPhase
idempotency conflict
booking ownership failure
```

If storage object exists but metadata creation fails:

```text
1. Confirm the object path prefix matches booking/phase.
2. Confirm object exists in expected bucket.
3. Confirm route idempotency key behavior.
4. Confirm pro owns the booking.
5. Do not manually insert MediaAsset rows unless path/ownership/phase are verified.
```

## Step 8 — Check signed URL rendering

Symptoms:

```text
media metadata exists
photos do not load
signed URL route fails
aftercare images broken
client/pro gallery broken
```

Check:

```text
/api/media/url
lib/media/renderUrls.ts
```

Look for:

```text
signed URL generation errors
storageBucket invalid
storagePath invalid
object missing
bucket permission denied
TTL issues
```

If signed URLs expire too quickly:

```text
1. Confirm TTL.
2. Confirm frontend refresh behavior.
3. Refresh signed URLs from the backend.
4. Do not expose permanent private object URLs.
```

## Step 9 — Check active appointment impact

Storage failures during active appointments can block:

```text
BEFORE_PHOTOS step
AFTER_PHOTOS step
aftercare creation
booking completion
```

If before-photo upload is unavailable:

```text
1. Confirm whether the Pro can continue service with documented fallback.
2. Do not silently bypass photo requirements unless product/ops approves.
3. Consider a temporary runtime flag for “media upload degraded mode” only if implemented and audited.
```

If after-photo upload is unavailable:

```text
1. Booking completion may be blocked.
2. Show clear copy to the Pro.
3. Preserve booking in closeout state.
4. Retry media upload after recovery.
```

Suggested Pro-facing copy:

```text
Photo uploads are temporarily unavailable. Your booking is safe, but closeout may not complete until uploads recover. Please try again shortly.
```

## Step 10 — Check orphaned media

An incident can create orphaned objects:

```text
object uploaded but MediaAsset row not created
MediaAsset row created but object missing
thumbnail uploaded but original missing
original uploaded but thumbnail missing
```

After recovery, run an orphan scan/backfill if tooling exists.

If no tooling exists, create a follow-up issue for:

```text
orphan media cleanup job
media metadata/object reconciliation report
safe retry path for metadata creation
```

Do not bulk delete storage objects unless you have confirmed they are not referenced. “Looks unused” is not a data model.

## Step 11 — Check closeout blockers

For affected bookings, inspect:

```text
Booking.status
Booking.sessionStep
MediaAsset rows
MediaAsset.phase
AftercareSummary
checkoutStatus
stripePaymentStatus
completionBlockers
```

Look specifically for bookings stuck because:

```text
AFTER_PHOTOS_REQUIRED
media upload failed
media metadata missing
aftercare could not render media
```

Recovery steps:

```text
1. Re-upload missing photos if needed.
2. Recreate metadata only after verifying object path and ownership.
3. Retry aftercare send only if idempotency/side effects are safe.
4. Complete closeout only through normal backend rules.
```

## Step 12 — Customer-facing behavior

For clients:

```text
Some photos or aftercare images may be temporarily unavailable. Booking details remain safe.
```

For Pros:

```text
Photo uploads are temporarily unavailable. Please keep the appointment open and retry uploads shortly.
```

For support:

```text
Do not ask Pros to create duplicate bookings to work around media upload failures.
Do not manually complete bookings unless closeout criteria are met.
Do not move media to public buckets.
```

## Step 13 — Recovery validation

Before resolving, confirm:

```text
/api/health/live returns ok
/api/health/ready returns ok
checks.storage.status is ok
media-private bucket exists and is private
media-public bucket exists and has intended policy
signed upload URL creation works
before photo upload works
after photo upload works
media metadata creation works
signed media URL rendering works
aftercare images render
no private media is publicly listable/readable
```

## Post-recovery checks

Check the incident window for:

```text
failed upload attempts
objects without MediaAsset rows
MediaAsset rows without objects
bookings stuck at BEFORE_PHOTOS
bookings stuck at AFTER_PHOTOS
bookings stuck with AFTER_PHOTOS_REQUIRED
aftercare sends with missing media
client/pro support tickets about missing photos
```

Create repair tasks where needed.

## Rollback guidance

Rollback app deploy if:

```text
Supabase status is healthy
storage failure started after deploy
media route changed
storage bucket names changed
storage policy migration changed
signed URL rendering changed
upload path construction changed
```

Do not rollback blindly if:

```text
storage policy migration already changed live bucket security
provider is down
service-role key was revoked
bucket was deleted or renamed manually
```

If a storage policy migration caused the issue:

```text
1. Stop further deploys.
2. Identify exact policy change.
3. Preserve current policy state.
4. Apply minimal safe correction.
5. Verify private bucket is not public.
6. Re-run health/readiness and media upload tests.
```

## Escalation

Escalate immediately when:

```text
private media may be publicly accessible
before/after uploads fail during active appointments
media metadata/object drift affects many bookings
storage bucket is missing
service-role access is broken
aftercare media exposure is suspected
```

Escalate to:

```text
on-call engineer
security/privacy owner
support lead
Supabase/provider support
payment/booking owner if closeout is affected
```

## Logs to collect

Collect:

```text
timestamp range
deployment id
request ids
affected booking ids
affected professional ids
storage bucket names
storage object path prefixes, if safe
media asset ids
error messages
Supabase dashboard status
policy migration commit
affected route names
```

Do not collect or paste:

```text
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SECRET_KEY
signed URLs
private object URLs
client photos
client addresses
phone numbers
emails
```

If object paths are sensitive in your policy, hash or redact them in incident notes.

## Useful error signals

Common storage/Supabase signals:

```text
bucket not found
permission denied
invalid JWT
row-level security policy violation
object not found
signed URL creation failed
upload failed
service role missing
fetch failed
timeout
```

Interpretation:

| Signal | Meaning | Action |
|---|---|---|
| `bucket not found` | Missing/renamed bucket | Check bucket migration/settings |
| `permission denied` | Policy/key issue | Check RLS/policies/service role |
| `invalid JWT` | Bad Supabase key | Check env vars/key rotation |
| `object not found` | Upload missing or path wrong | Check upload path + metadata |
| `RLS policy violation` | Policy too strict or wrong role | Check storage policies |
| `timeout` | Provider/network issue | Check Supabase status |

## Manual smoke tests

After recovery, manually verify:

```text
1. Pro can generate upload URL.
2. Pro can upload BEFORE photo.
3. Backend creates MediaAsset for BEFORE photo.
4. BEFORE photo renders in Pro session.
5. Pro can upload AFTER photo.
6. Backend creates MediaAsset for AFTER photo.
7. AFTER photo renders in aftercare/closeout.
8. Client can view intended aftercare media.
9. Anonymous user cannot list/read media-private bucket.
```

## Incident notes template

```md
# Supabase Storage incident

## Summary

## Start time

## End time

## Severity

## Detection

## Health check output

## User impact

## Affected media flows

## Affected bookings/users

## Security/privacy impact

## Timeline

## Root cause

## Mitigation

## Recovery validation

## Data/media repair tasks

## Follow-up tasks

## Owner
```

## Follow-up tasks

After the incident, create issues for:

```text
missing storage policy test
missing orphan cleanup
missing upload retry flow
missing signed URL refresh
missing media audit event
missing dashboard panel
missing alert
unclear upload error copy
manual bucket config drift
```

## Related runbooks

```text
docs/runbooks/health-readiness.md
docs/runbooks/postgres-outage.md
docs/runbooks/notification-backlog.md
```