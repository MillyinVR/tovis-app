// app/api/v1/auth/resend-phone-code/route.ts

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getVerificationPhoneLookupValue,
  isRecord,
} from '@/lib/auth/verification'
import { sendPhoneVerificationCode } from '@/lib/auth/phoneVerification'

export const dynamic = 'force-dynamic'

function readBodyPhone(raw: unknown): string {
  if (!isRecord(raw)) return ''

  const submittedPhone =
    raw.phone // pii-plaintext-read-ok: verification route passes submitted phone into security contact lookup helper

  return getVerificationPhoneLookupValue(submittedPhone)
}

export async function POST(req: Request) {
  try {
    const raw: unknown = await req.json().catch(() => null)
    const phone = readBodyPhone(raw)

    if (!phone) {
      return jsonFail(400, 'Missing phone number.')
    }

    const result = await sendPhoneVerificationCode({ phone, channel: 'sms' })

    if (!result.ok) {
      return jsonFail(400, result.error)
    }

    return jsonOk({
      ok: true,
      to: result.maskedTo,
      status: result.status,
    })
  } catch (err: unknown) {
    console.error('POST /api/v1/auth/resend-phone-code error', err)
    return jsonFail(500, 'Failed to resend phone code.')
  }
}