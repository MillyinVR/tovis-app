// lib/nfc/tapRequest.test.ts
import { describe, expect, it } from 'vitest'

import { isNonInteractiveTapRequest } from './tapRequest'

function bag(headers: Record<string, string>) {
  const lower = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  )
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null }
}

const PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

describe('isNonInteractiveTapRequest', () => {
  it('treats a normal mobile browser tap as interactive', () => {
    expect(isNonInteractiveTapRequest(bag({ 'user-agent': PHONE_UA }))).toBe(false)
  })

  it('flags a missing user agent as automated', () => {
    expect(isNonInteractiveTapRequest(bag({}))).toBe(true)
  })

  it.each([
    ['sec-purpose prefetch', { 'sec-purpose': 'prefetch;prerender', 'user-agent': PHONE_UA }],
    ['purpose prefetch', { purpose: 'prefetch', 'user-agent': PHONE_UA }],
    ['x-purpose preview', { 'x-purpose': 'preview', 'user-agent': PHONE_UA }],
    ['next router prefetch', { 'next-router-prefetch': '1', 'user-agent': PHONE_UA }],
  ])('flags prefetch/preview header: %s', (_label, headers) => {
    expect(isNonInteractiveTapRequest(bag(headers))).toBe(true)
  })

  it.each([
    ['Slackbot', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['facebookexternalhit', 'facebookexternalhit/1.1'],
    ['WhatsApp', 'WhatsApp/2.0'],
    ['Twitterbot', 'Twitterbot/1.0'],
    ['Discordbot', 'Mozilla/5.0 (compatible; Discordbot/2.0)'],
    ['curl', 'curl/8.4.0'],
  ])('flags known preview/crawler agent: %s', (_label, ua) => {
    expect(isNonInteractiveTapRequest(bag({ 'user-agent': ua }))).toBe(true)
  })
})
