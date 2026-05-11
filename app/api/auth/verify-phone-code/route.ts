import { jsonFail, jsonOk } from '@/app/api/_utils'
import { checkPhoneVerificationCode } from '@/lib/auth/phoneVerification'
import {
  isRecord,
  normalizePhoneForVerification,
  pickString,
} from '@/lib/auth/verification'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const raw: unknown = await req.json().catch(() => null)

    if (!isRecord(raw)) {
      return jsonFail(400, 'Invalid request body.')
    }

    const phone = normalizePhoneForVerification(raw.phone)
    const code = pickString(raw.code)

    if (!phone) {
      return jsonFail(400, 'Missing phone number.')
    }

    if (!code) {
      return jsonFail(400, 'Missing verification code.')
    }

    const result = await checkPhoneVerificationCode({ phone, code })

    if (!result.ok) {
      return jsonFail(400, result.error)
    }

    if (!result.approved) {
      return jsonFail(400, 'Invalid verification code.')
    }

    return jsonOk({
      ok: true,
      phone: result.maskedTo,
      status: result.status,
    })
  } catch (err: unknown) {
    console.error('POST /api/auth/verify-phone-code error', err)
    return jsonFail(500, 'Failed to verify phone code.')
  }
}