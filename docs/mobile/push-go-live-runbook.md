# Push notifications — go-live runbook (operator)

The push backend (APNs + FCM) is **fully built and deployed but dormant**, and
the **native iOS app now ships a registration path** (`Tovis/PushManager.swift` →
`client.devices.register(...)` → `POST /api/v1/devices` on launch, once signed
in). Everything is coded on both ends. Nothing sends until BOTH of these are true:

1. The push **credentials** below are set in the environment, AND
2. A **device registers a token** (the iOS app does this automatically on launch
   for a signed-in user; it can also be done by hand with the `curl` in the smoke
   test).

So you can set the credentials whenever — even now, harmlessly — and push will
light up the moment a client registers its first token.

> **A4 (2026-07-03) made this the last blocker for social push.** The Looks
> social events — `LOOK_COMMENTED`, `LOOK_COMMENT_REPLIED`, `LOOK_LIKED`,
> `LOOK_SAVED`, `LOOK_NEW_FROM_FOLLOWED_PRO` — now include the **PUSH** channel in
> their `defaultChannelsByRecipient` (they were in-app only through A1/A2). They
> stay inert exactly like every other push event until the creds below are set;
> provisioning them lights up the whole real-time social dopamine loop on device.

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
5. `APNS_BUNDLE_ID` = the iOS app's bundle identifier, which is **`app.tovis.Tovis`**
   (`PRODUCT_BUNDLE_IDENTIFIER` in `tovis-ios.xcodeproj`). The App ID must have the
   **Push Notifications** capability enabled, and the Xcode app target must have the
   **Push Notifications** capability + APNs entitlement (Signing & Capabilities →
   ＋ Capability → Push Notifications) so `didRegisterForRemoteNotifications…`
   actually fires and hands a token to `PushManager`.

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

You need a real device token, which means a build of the native app on a real
device (the Simulator does not produce a usable APNs token). The iOS app registers
automatically — so the fastest path is:

**iOS end-to-end (recommended):**
1. Build the app to a **physical device** from Xcode (a dev build → **sandbox**
   token → set `APNS_ENV=sandbox` in Vercel and redeploy; TestFlight/App Store →
   **production** → `APNS_ENV=production`). See the sandbox/production gotcha above.
2. **Sign in** — `PushManager` (via the AppDelegate's
   `didRegisterForRemoteNotificationsWithDeviceToken`) calls
   `client.devices.register(...)` → `POST /api/v1/devices {platform:"IOS", token,
   deviceId}` automatically. Confirm a `DeviceToken` row exists for that user.
3. From a second account, **like or comment on one of that user's looks** (an A4
   social event) — or trigger any push event.
4. **Confirm** the device receives the push. The cron drain
   (`/api/internal/jobs/notifications/process`) sends due deliveries; tapping the
   push routes via the payload's `href` deep-link.

**By hand (no app build):** register a token you already have as a logged-in user:
   ```bash
   curl -X POST https://<app>/api/v1/devices \
     -H "Authorization: Bearer <user-jwt>" \
     -H "Content-Type: application/json" \
     -d '{"platform":"IOS","token":"<device-token>","deviceId":"<device-id>"}'  # or "ANDROID"
   ```
   then trigger an event whose defaults include PUSH (see
   `defaultChannelsByRecipient` in `lib/notifications/eventKeys.ts`) and confirm
   receipt via the cron drain.
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
- Native iOS registration on launch (`Tovis/PushManager.swift` + AppDelegate)
- Social events (`LOOK_*`) opted into PUSH (A4)

Remaining is **this runbook only**: set the env vars, redeploy, and smoke-test on
a device.
