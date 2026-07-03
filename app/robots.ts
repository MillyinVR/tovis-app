// app/robots.ts
//
// Crawler policy. Public discovery surfaces (profiles, looks, search) are
// open; account/booking/attribution surfaces are not. AI assistant crawlers
// are listed EXPLICITLY as welcome — being citable when someone asks an AI
// "how do I book a hair appointment" is a discovery channel, and an explicit
// allow survives any future tightening of the wildcard rule.
import type { MetadataRoute } from 'next'

// In-app, auth-gated, or attribution paths crawlers have no business in.
const DISALLOWED_PATHS = [
  '/api/',
  '/admin/',
  '/client/',
  '/pro/',
  '/messages',
  '/booking/',
  '/claim/',
  '/c/',
  '/t/',
  '/login',
  '/signup',
  '/verify-phone',
]

// Assistant/answer-engine crawlers, explicitly welcomed (same path rules).
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'meta-externalagent',
]

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOWED_PATHS,
      },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: DISALLOWED_PATHS,
      })),
    ],
    ...(base ? { sitemap: new URL('/sitemap.xml', base).toString() } : {}),
  }
}
