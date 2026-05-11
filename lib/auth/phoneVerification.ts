// lib/auth/phoneVerification.ts

import 'server-only'

import {
  getTwilioClient,
  getTwilioVerifyServiceSid,
} from '@/lib/twilio'
import type { PhoneVerificationChannel } from '@/lib/auth/verification'
import { maskPhone, normalizePhoneForVerification } from '@/lib/auth/verification'

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
  const to = normalizePhoneForVerification(args.phone)

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
  const to = normalizePhoneForVerification(args.phone)
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