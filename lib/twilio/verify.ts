// lib/twilio/verify.ts
import Twilio from 'twilio'

import { readOptionalEnv as readEnv } from '@/lib/env'
import { asTrimmedString } from '@/lib/guards'

type TwilioVerifyConfig = {
  accountSid: string
  authToken: string
  verifyServiceSid: string
}

export type TwilioVerifyStartResult =
  | {
      ok: true
      sid: string | null
      status: string | null
    }
  | {
      ok: false
      code: 'TWILIO_VERIFY_NOT_CONFIGURED' | 'TWILIO_VERIFY_SEND_FAILED'
      message: string
    }

export type TwilioVerifyCheckResult =
  | {
      ok: true
      approved: boolean
      sid: string | null
      status: string | null
    }
  | {
      ok: false
      code: 'TWILIO_VERIFY_NOT_CONFIGURED' | 'TWILIO_VERIFY_CHECK_FAILED'
      message: string
    }

function readTwilioVerifyConfig(): TwilioVerifyConfig | null {
  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const authToken = readEnv('TWILIO_AUTH_TOKEN')
  const verifyServiceSid = readEnv('TWILIO_VERIFY_SERVICE_SID')

  if (!accountSid || !authToken || !verifyServiceSid) {
    return null
  }

  return {
    accountSid,
    authToken,
    verifyServiceSid,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Unknown Twilio Verify error.'
}

export async function startTwilioVerifyPhoneVerification(args: {
  to: string
}): Promise<TwilioVerifyStartResult> {
  const config = readTwilioVerifyConfig()

  if (!config) {
    return {
      ok: false,
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
      message:
        'Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID.',
    }
  }

  try {
    const client = Twilio(config.accountSid, config.authToken)

    const verification = await client.verify.v2
      .services(config.verifyServiceSid)
      .verifications.create({
        to: args.to,
        channel: 'sms',
      })

    return {
      ok: true,
      sid: asTrimmedString(verification.sid),
      status: asTrimmedString(verification.status),
    }
  } catch (error: unknown) {
    return {
      ok: false,
      code: 'TWILIO_VERIFY_SEND_FAILED',
      message: errorMessage(error),
    }
  }
}

export async function checkTwilioVerifyPhoneCode(args: {
  to: string
  code: string
}): Promise<TwilioVerifyCheckResult> {
  const config = readTwilioVerifyConfig()

  if (!config) {
    return {
      ok: false,
      code: 'TWILIO_VERIFY_NOT_CONFIGURED',
      message:
        'Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID.',
    }
  }

  try {
    const client = Twilio(config.accountSid, config.authToken)

    const verificationCheck = await client.verify.v2
      .services(config.verifyServiceSid)
      .verificationChecks.create({
        to: args.to,
        code: args.code,
      })

    const status = asTrimmedString(verificationCheck.status)

    return {
      ok: true,
      approved: status === 'approved',
      sid: asTrimmedString(verificationCheck.sid),
      status,
    }
  } catch (error: unknown) {
    return {
      ok: false,
      code: 'TWILIO_VERIFY_CHECK_FAILED',
      message: errorMessage(error),
    }
  }
}