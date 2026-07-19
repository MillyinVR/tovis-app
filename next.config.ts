import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'

const securityHeaders = [
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), payment=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
]

const nextConfig: NextConfig = {
  // node-ical (calendar migration import) is server-only and must not be bundled
  // by the route tracer — bundling breaks a transitive dep at build time
  // ("s.BigInt is not a function"). Leave it as a runtime require.
  serverExternalPackages: ['node-ical'],
  async redirects() {
    return [
      {
        // `/pro/media/[id]` was a fork of `app/media/[id]/page.tsx` that drifted:
        // the canonical page gates a PUBLIC asset on `canViewerSeePublicMediaSurface`
        // (lib/proTrustState) and the fork only checked `visibility === 'PUBLIC'`, so
        // media from a not-yet-viewable pro was reachable there and hidden here.
        // Nothing linked to it, but an indexed or bookmarked URL should land on the
        // guarded page rather than 404.
        //
        // Done here rather than as a redirecting page component on purpose: a
        // `permanentRedirect()` inside the page streams a 200 HTML shell and moves the
        // browser client-side, which is not a real redirect for crawlers or API
        // clients. This emits a true 308 before routing.
        //
        // The `(?!new$)` guard is load-bearing — without it `:id` also matches
        // `/pro/media/new`, the live uploader page, and would redirect it to
        // `/media/new`.
        source: '/pro/media/:id((?!new$)[^/]+)',
        destination: '/media/:id',
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  silent: true,
})