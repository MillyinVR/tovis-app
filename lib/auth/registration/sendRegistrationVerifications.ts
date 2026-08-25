// lib/auth/registration/sendRegistrationVerifications.ts
//
// The background tail of a signup: start the phone OTP, send the email
// verification, and consume the NFC tap intent. Extracted verbatim from
// app/api/v1/auth/register/route.ts.
//
// Every step is best-effort by design — the route has already returned 201 and
// the caller only ever hands this to waitUntil(). A failure here must never
// surface as a failed signup, so this function does not reject: each step logs
// its own outcome and the whole body is wrapped in a final catch. Callers that
// need to know whether a message went out must not use this.

import {
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'
import { issueAndSendEmailVerification } from '@/lib/auth/emailVerification'
import { startTwilioVerifyPhoneVerification } from '@/lib/twilio/verify'
import { validateSmsDestinationCountry } from '@/lib/smsCountryPolicy'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import type { TenantContext } from '@/lib/tenant/context'

export type SendRegistrationVerificationsArgs = {
  /** Log label for the originating route, e.g. 'auth.register'. */
  route: string
  userId: string
  /** Normalized; null or empty skips the email send. */
  email: string | null
  /** Normalized; null skips the OTP. */
  phone: string | null
  appUrl: string
  tenantContext: TenantContext
  next?: string | null
  intent?: string | null
  inviteToken?: string | null
  /**
   * A claim click already proved one channel, so that channel needs no send at
   * all. Both default to false: skipping is the exception.
   */
  skipPhoneVerification?: boolean
  skipEmailVerification?: boolean
  tapIntentId: string | null
}

export async function sendRegistrationVerifications(
  args: SendRegistrationVerificationsArgs,
): Promise<void> {
  const {
    route,
    userId,
    email,
    phone,
    appUrl,
    tenantContext,
    next = null,
    intent = null,
    inviteToken = null,
    skipPhoneVerification = false,
    skipEmailVerification = false,
    tapIntentId,
  } = args

  try {
    if (phone && !skipPhoneVerification) {
      // The SMS country allowlist is enforced at the CALL SITE, not inside
      // lib/twilio/verify — and once the send moved in here, this module became
      // the call site for every caller. The register route already refuses a
      // disallowed country upstream, so this is a no-op there; it is here so a
      // second caller cannot reopen the hole by forgetting.
      //
      // Background work has no response to refuse with, so a rejected
      // destination is logged and the send is skipped, never thrown.
      const destination = validateSmsDestinationCountry(phone)

      if (!destination.ok) {
        // Skips the SMS only. The email verification and the tap intent below
        // are unrelated to the destination country and still run.
        logAuthEvent({
          level: 'error',
          event: 'auth.phone.verify.start.blocked',
          route,
          provider: 'twilio_verify',
          code: destination.code,
          userId,
          phone,
          message: destination.message,
          meta: { countryCode: destination.countryCode },
        })
      } else {
        const phoneVerification = await startTwilioVerifyPhoneVerification({
          to: phone,
        })

        if (phoneVerification.ok) {
          logAuthEvent({
            level: 'info',
            event: 'auth.phone.verify.start.success',
            route,
            provider: 'twilio_verify',
            userId,
            phone,
            meta: {
              sid: phoneVerification.sid,
              status: phoneVerification.status,
            },
          })
        } else {
          logAuthEvent({
            level:
              phoneVerification.code === 'TWILIO_VERIFY_NOT_CONFIGURED'
                ? 'error'
                : 'warn',
            event: 'auth.phone.verify.start.failed',
            route,
            provider: 'twilio_verify',
            code: phoneVerification.code,
            userId,
            phone,
            meta: {
              message: phoneVerification.message,
            },
          })
        }
      }
    }

    if (email && !skipEmailVerification) {
      try {
        await issueAndSendEmailVerification({
          userId,
          email,
          appUrl,
          tenantContext,
          next,
          intent,
          inviteToken,
        })

        logAuthEvent({
          level: 'info',
          event: 'auth.email.send.success',
          route,
          provider: 'postmark',
          userId,
          email,
        })
      } catch (emailErr) {
        captureAuthException({
          event: 'auth.email.send.failed',
          route,
          provider: 'postmark',
          userId,
          email,
          error: emailErr,
        })
      }
    }

    await consumeTapIntent({ tapIntentId, userId }).catch(() => null)
  } catch (backgroundErr) {
    captureAuthException({
      event: 'auth.register.background_tail.failed',
      route,
      userId,
      email,
      phone,
      error: backgroundErr,
    })
  }
}
