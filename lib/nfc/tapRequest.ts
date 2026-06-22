// lib/nfc/tapRequest.ts
//
// Detects non-interactive hits on the public NFC tap routes (/t/[cardId] and
// /c/[code]) so we can skip the side effects (TapIntent + AttributionEvent
// writes) for link unfurlers, preview bots, and prefetchers. Those requests are
// machines reading the link, not a human who tapped a card — counting them
// would mint junk intents and skew the tap funnel.
//
// The routes still RESPOND to these requests (they redirect); we just don't
// persist a tap for them.

type HeaderBag = {
  get(name: string): string | null
}

// Headers browsers/frameworks set when the navigation is a prefetch/preview
// rather than a real navigation.
const PREFETCH_HEADER_SIGNALS: ReadonlyArray<{ header: string; needle: string }> = [
  { header: 'sec-purpose', needle: 'prefetch' },
  { header: 'purpose', needle: 'prefetch' },
  { header: 'x-purpose', needle: 'preview' },
  { header: 'x-moz', needle: 'prefetch' },
  { header: 'next-router-prefetch', needle: '1' },
]

// Well-known link-unfurl / preview / crawler user agents, plus generic tokens.
const BOT_USER_AGENT_PATTERN =
  /(bot|crawler|spider|crawl|slurp|facebookexternalhit|facebot|twitterbot|slackbot|slack-imgproxy|whatsapp|telegrambot|discordbot|linkedinbot|pinterest|redditbot|googlebot|bingbot|duckduckbot|applebot|skypeuripreview|vkshare|embedly|iframely|preview|headlesschrome|monitoring|uptime|curl|wget|python-requests|axios|node-fetch|go-http-client)/i

function headerSignalsPrefetch(headers: HeaderBag): boolean {
  return PREFETCH_HEADER_SIGNALS.some(({ header, needle }) => {
    const value = headers.get(header)
    return typeof value === 'string' && value.toLowerCase().includes(needle)
  })
}

function userAgentLooksAutomated(headers: HeaderBag): boolean {
  const ua = headers.get('user-agent')
  if (!ua) return true // No UA at all → almost always a bot/script, not a phone tap.
  return BOT_USER_AGENT_PATTERN.test(ua)
}

/**
 * True when a hit on an NFC tap route should NOT be recorded as a real tap
 * (prefetch, link preview, crawler, scripted fetch). The route should still
 * redirect; it just skips the TapIntent / AttributionEvent writes.
 */
export function isNonInteractiveTapRequest(headers: HeaderBag): boolean {
  return headerSignalsPrefetch(headers) || userAgentLooksAutomated(headers)
}
