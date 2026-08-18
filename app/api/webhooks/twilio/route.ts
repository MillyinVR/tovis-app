// app/api/webhooks/twilio/route.ts

import Twilio from 'twilio'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { classifySmsKeyword } from '@/lib/notifications/optOut/smsOptOutKeywords'
import { recordSmsOptEvent } from '@/lib/notifications/optOut/smsOptOutStore'
import { safeError, safeLogMeta } from '@/lib/security/logging'
import { redactNotes, redactPhone } from '@/lib/security/redaction'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'
import {
  buildSmsHelpReply,
  buildSmsStartConfirmationReply,
  buildSmsStopConfirmationReply,
} from '@/lib/transactionalSmsPolicy'
import { getTwilioAuthToken } from '@/lib/twilio'

export const dynamic = 'force-dynamic'

function twimlResponse(body: string): Response {
  const twiml = new Twilio.twiml.MessagingResponse()
  twiml.message(body)

  return new Response(twiml.toString(), {
    status: 200,
    headers: {
      'content-type': 'text/xml',
    },
  })
}

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

    const valid = Twilio.validateRequest(
      getTwilioAuthToken(),
      signature,
      url,
      params,
    )

    if (!valid) {
      return jsonFail(403, 'Invalid Twilio signature.')
    }

    const messageSid = params.MessageSid ?? params.SmsSid ?? null
    const messageStatus = params.MessageStatus ?? params.SmsStatus ?? null
    const to = params.To ?? null
    const from = params.From ?? null
    const inboundBody = params.Body ?? null

    console.info(
      'Twilio webhook received',
      safeLogMeta({
        messageSid,
        messageStatus,
        to: to ? redactPhone(to) : null,
        from: from ? redactPhone(from) : null,
        body: inboundBody ? redactNotes(inboundBody) : null,
      }),
    )

    // A STOP/START/HELP keyword only makes sense as a reply FROM a recipient's
    // phone — an inbound MO message, not a delivery status callback (those hit
    // the sibling route at
    // app/api/internal/webhooks/twilio/notifications/status and never carry a
    // From/Body pair shaped like this). If Twilio's own default opt-out
    // handling is enabled on this number/messaging service, it intercepts
    // these keywords and replies itself before this webhook is ever invoked —
    // this code only runs when that default handling is off, or for a number
    // where inbound routes here directly.
    const keyword = from ? classifySmsKeyword(inboundBody) : null

    if (keyword && from) {
      const tenantContext = await resolveTenantContextForRequest(req)
      const brand = getBrandForTenantContext(tenantContext)

      if (keyword.kind === 'STOP') {
        const result = await recordSmsOptEvent({
          phone: from,
          kind: 'STOP',
          keyword: keyword.keyword,
          occurredAt: new Date(),
        })

        if (!result.ok) {
          console.error('POST /api/webhooks/twilio: failed to record opt-out', {
            code: result.code,
            from: redactPhone(from),
          })
        }

        return twimlResponse(buildSmsStopConfirmationReply(brand.displayName))
      }

      if (keyword.kind === 'START') {
        const result = await recordSmsOptEvent({
          phone: from,
          kind: 'START',
          keyword: keyword.keyword,
          occurredAt: new Date(),
        })

        if (!result.ok) {
          console.error('POST /api/webhooks/twilio: failed to record opt-in', {
            code: result.code,
            from: redactPhone(from),
          })
        }

        return twimlResponse(buildSmsStartConfirmationReply(brand.displayName))
      }

      // HELP/INFO: no opt-out state change, just the support-contact reply.
      return twimlResponse(
        buildSmsHelpReply({
          brandName: brand.displayName,
          supportEmail: brand.contact.supportEmail,
        }),
      )
    }

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