// tests/load/_deliverySafety.ts
//
// Preflight guard shared by load harnesses that create signups / trigger
// transactional sends. The harness runs in a separate process from the target
// server, so it cannot read the server's delivery config directly — instead it
// requires the operator to consciously confirm the target is delivery-safe.
//
// Why this exists: on 2026-06-22 a signup load run against a local server that
// was carrying LIVE Twilio/Postmark creds sent ~4,375 real verifications and
// cost ~$36 in Twilio charges. This turns "easy to forget" into "must assert".

function truthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

/**
 * Throws unless the operator has set LOAD_TEST_DELIVERY_SAFE to a truthy value,
 * asserting that the target server does NOT deliver to real users — i.e. it runs
 * with the LOAD_TEST_DISABLE_REAL_DELIVERY kill switch (local) or uses sink/test
 * provider credentials (staging). Never assert this against a server with live
 * provider keys.
 */
export function assertLoadTestDeliverySafe(): void {
  if (truthy(process.env.LOAD_TEST_DELIVERY_SAFE)) return

  throw new Error(
    [
      'Refusing to run: the load target is not confirmed delivery-safe.',
      '',
      'This harness creates many signups. If the target server has LIVE Twilio/',
      'Postmark credentials it will send — and bill you for — real SMS/email. A',
      'single run already cost ~$36 in Twilio charges (2026-06-22).',
      '',
      'Safe local target — boots a server with the delivery kill switch ON:',
      '  pnpm dev:loadtest        (terminal A)',
      '  LOAD_TEST_DELIVERY_SAFE=1 pnpm test:load:signup   (terminal B)',
      '',
      'Deployed staging: only with sink/test provider credentials (never prod',
      'keys), then set LOAD_TEST_DELIVERY_SAFE=1 to confirm.',
    ].join('\n'),
  )
}
