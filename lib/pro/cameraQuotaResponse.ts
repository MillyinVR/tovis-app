// lib/pro/cameraQuotaResponse.ts
//
// Shared 403 for the AI-camera routes when a pro's monthly image allowance is
// spent. `code` is machine-readable for the iOS camera (upgrade prompt); the
// message is what it renders today, so it must stand alone.

import { jsonFail } from '@/app/api/_utils'

export const CAMERA_QUOTA_EXCEEDED_CODE = 'CAMERA_QUOTA_EXCEEDED'

export function cameraQuotaExceededResponse(args: {
  used: number
  quota: number
}) {
  return jsonFail(
    403,
    `You’ve used all ${args.quota} AI photographer images included this month. Upgrade your membership for a bigger monthly allowance.`,
    {
      code: CAMERA_QUOTA_EXCEEDED_CODE,
      quota: args.quota,
      used: args.used,
    },
  )
}
