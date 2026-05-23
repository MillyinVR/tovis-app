// app/api/webhooks/twilio/route.ts

import { validateRequest } from 'twilio'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { safeError, safeLogMeta } from '@/lib/security/logging'
import { getTwilioAuthToken } from '@/lib/twilio'

export const dynamic = 'force-dynamic'

function getPublicRequestUrl(req: Request): string {
  const url = new URL(req.url)
  const proto =
    req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
  const host =
    req.headers.get('x-forwarded-host') ??
    req.headers.get('host') ??
    url.host

  return `${proto}://${host}${url.pathname}${url.search}`
}

function formParamsToRecord(body: string): Record<string, string> {
  const params = new URLSearchParams(body)
  const out: Record<string, string> = {}

  for (const [key, value] of params.entries()) {
    out[key] = value
  }

  return out
}

export async function POST(req: Request) {
  try {
    const signature = req.headers.get('x-twilio-signature') ?? ''
    const body = await req.text()
    const url = getPublicRequestUrl(req)
    const params = formParamsToRecord(body)

    const valid = validateRequest(getTwilioAuthToken(), signature, url, params)

    if (!valid) {
      return jsonFail(403, 'Invalid Twilio signature.')
    }

    const messageSid = params.MessageSid ?? params.SmsSid ?? null
    const messageStatus = params.MessageStatus ?? params.SmsStatus ?? null
    const to = params.To ?? null
    const from = params.From ?? null

    console.info(
      'Twilio webhook received',
      safeLogMeta({
        messageSid,
        messageStatus,
        to,
        from,
      }),
    )

    return jsonOk({
      received: true,
    })
  } catch (err: unknown) {
    console.error('POST /api/webhooks/twilio error', {
      error: safeError(err),
    })

    return jsonFail(500, 'Failed to process Twilio webhook.')
  }
}