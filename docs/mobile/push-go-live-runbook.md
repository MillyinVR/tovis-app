# Push notifications — go-live runbook (operator)

The push backend (APNs + FCM) is **fully built and deployed but dormant**. This is
the intended state *before* the native iOS/Android app exists: the backend is
native-ready and waiting. Nothing sends until BOTH of these are true:

1. The push **credentials** below are set in the environment, AND
2. A **device registers a token** by calling `POST /api/v1/devices` (the native
   app does this on launch).

So you can set the credentials whenever — even now, harmlessly — and push will
light up the moment the native client registers its first token.

How it stays safe until then: `isPushProviderConfigured()`
(`lib/notifications/config.ts`) returns false while the creds are unset, which
forces the PUSH capability off at enqueue — the engine never even queries device
tokens or creates PUSH delivery rows.

---

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**, marked
**Sensitive**, scoped to **Production** (add **Preview** too if you want push in
preview deploys). After saving, **redeploy** — env changes only take effect on a
new deployment.

| Variable | Required for | Value |
|---|---|---|
| `APNS_AUTH_KEY` | iOS | Full text of the `.p8` APNs auth key (`-----BEGIN PRIVATE KEY-----…`) |
| `APNS_KEY_ID` | iOS | 10-char Key ID of that `.p8` |
| `APNS_TEAM_ID` | iOS | Apple Developer Team ID (10 chars) |
| `APNS_BUNDLE_ID` | iOS | iOS app bundle identifier (becomes the `apns-topic`) |
| `APNS_ENV` | iOS (optional) | `production` (default) or `sandbox` — must match the build type |
| `FCM_SERVICE_ACCOUNT_JSON` | Android | The entire Firebase service-account JSON, pasted as one value |
| `FCM_PROJECT_ID` | Android | Firebase project ID |

iOS and Android are independent — you can configure one without the other (the
unconfigured side just stays inert).

---

## Getting the APNs values (Apple — requires a paid Apple Developer account)

1. [developer.apple.com](https://developer.apple.com) → **Certificates, Identifiers
   & Profiles** → **Keys** → **＋**.
2. Tick **Apple Push Notifications service (APNs)**, **Register**, then
   **Download** the `.p8`. ⚠️ It can be downloaded **only once** — store it in your
   secrets manager. Its file contents = `APNS_AUTH_KEY`.
3. The key's **Key ID** is shown on that page = `APNS_KEY_ID`.
4. **Team ID**: top-right of your Apple Developer **Membership** page = `APNS_TEAM_ID`.
5. `APNS_BUNDLE_ID` = the iOS app's bundle identifier. The App ID must have the
   **Push Notifications** capability enabled.

### ⚠️ The APNs sandbox/production gotcha
APNs device tokens are environment-specific:
- A token from an **Xcode / development** build is a **sandbox** token → needs
  `APNS_ENV=sandbox`.
- A token from a **TestFlight / App Store** build is a **production** token →
  needs `APNS_ENV=production`.

A mismatch returns `BadDeviceToken` (and our code will then deactivate that token).
One auth key (`.p8`) works for both environments; only `APNS_ENV` selects the host.

---

## Getting the FCM values (Firebase — free)

1. [console.firebase.google.com](https://console.firebase.google.com) → your
   project (or create one) → add an **Android app**. The project's **Project ID**
   = `FCM_PROJECT_ID`.
2. **Project Settings → Service accounts → Generate new private key** → downloads
   a JSON file. The **entire JSON** = `FCM_SERVICE_ACCOUNT_JSON` (paste it as the
   single env value; Vercel accepts the multi-line JSON).

The service account uses the **FCM HTTP v1 API**, which is enabled by default for
Firebase projects.

> Note: `vercel env pull` returns blank for **Sensitive** vars. To run push
> locally against real creds, layer them into `.env.production.local` /
> `.env.local` yourself (see other Sensitive vars in this repo).

---

## Smoke test (once you have a device token)

You need a real device token, which means a build (even a minimal one) of the
native app that obtains the APNs/FCM token. Then:

1. **Register the token** as a logged-in user:
   ```bash
   curl -X POST https://<app>/api/v1/devices \
     -H "Authorization: Bearer <user-jwt>" \
     -H "Content-Type: application/json" \
     -d '{"platform":"IOS","token":"<device-token>"}'   # or "ANDROID"
   ```
2. **Trigger** an event whose defaults include PUSH (e.g. a booking confirmation
   for that user — see `defaultChannelsByRecipient` in
   `lib/notifications/eventKeys.ts`).
3. **Confirm** the device receives the notification. The cron drain
   (`/api/internal/jobs/notifications/process`) sends due deliveries.
4. **Token invalidation:** uninstall the app (or use a stale token) and trigger
   again — the provider returns a dead-token error and the row's `DeviceToken`
   flips `isActive=false` automatically. Verify in the DB.

### Verifying delivery without a device (backend-only sanity)
With creds set but no devices registered, trigger an event for a test user and
confirm in the DB that **no PUSH `NotificationDelivery` rows** are created (since
they have no device tokens) while IN_APP/EMAIL still flow — that proves the gate +
fan-out behave and nothing errors.

---

## Tuning which events send push

Push is enabled per event via `defaultChannelsByRecipient` in
`lib/notifications/eventKeys.ts` (PR2a added PUSH to the events that were marked
"push later"). Per-user opt-out is the `pushEnabled` column on the notification
preference tables (default on). Push respects quiet hours like SMS/email.

---

## Recap of what's already done (no more code needed to go live)

- `DeviceToken` model + `POST`/`DELETE /api/v1/devices` (#391)
- PUSH channel + per-device fan-out wired through the engine (#392)
- APNs + FCM provider clients + dead-token invalidation (#393)

Remaining is **this runbook only**: set the env vars, redeploy, and (when the app
exists) smoke-test on a device.
