// lib/auth/phoneVerification.ts

import 'server-only'

import {
  getTwilioClient,
  getTwilioVerifyServiceSid,
} from '@/lib/twilio'
import {
  getVerificationPhoneLookupValue,
  maskPhone,
  type PhoneVerificationChannel,
} from '@/lib/auth/verification'

export type SendPhoneVerificationCodeResult =
  | {
      ok: true
      to: string
      maskedTo: string
      status: string
    }
  | {
      ok: false
      error: string
    }

export type CheckPhoneVerificationCodeResult =
  | {
      ok: true
      to: string
      maskedTo: string
      approved: boolean
      status: string
    }
  | {
      ok: false
      error: string
    }

export async function sendPhoneVerificationCode(args: {
  phone: string
  channel?: PhoneVerificationChannel
}): Promise<SendPhoneVerificationCodeResult> {
  const submittedPhone =
    args.phone // pii-plaintext-read-ok: phone verification helper passes submitted phone into security contact lookup helper before sending SMS

  const to = getVerificationPhoneLookupValue(submittedPhone)

  if (!to) {
    return { ok: false, error: 'Missing phone number.' }
  }

  if (!to.startsWith('+')) {
    return {
      ok: false,
      error: 'Phone number must include country code, like +15555555555.',
    }
  }

  const verification = await getTwilioClient().verify.v2
    .services(getTwilioVerifyServiceSid())
    .verifications.create({
      to,
      channel: args.channel ?? 'sms',
    })

  return {
    ok: true,
    to,
    maskedTo: maskPhone(to),
    status: verification.status,
  }
}

export async function checkPhoneVerificationCode(args: {
  phone: string
  code: string
}): Promise<CheckPhoneVerificationCodeResult> {
  const submittedPhone =
    args.phone // pii-plaintext-read-ok: phone verification helper passes submitted phone into security contact lookup helper before checking SMS code

  const to = getVerificationPhoneLookupValue(submittedPhone)
  const code = args.code.trim()

  if (!to) {
    return { ok: false, error: 'Missing phone number.' }
  }

  if (!code) {
    return { ok: false, error: 'Missing verification code.' }
  }

  const check = await getTwilioClient().verify.v2
    .services(getTwilioVerifyServiceSid())
    .verificationChecks.create({
      to,
      code,
    })

  return {
    ok: true,
    to,
    maskedTo: maskPhone(to),
    approved: check.status === 'approved',
    status: check.status,
  }
}