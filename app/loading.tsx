// app/loading.tsx
//
// App-wide loading fallback. Next.js renders this (inside the root layout, so
// BrandProvider + theme are already applied) whenever a route segment is
// suspended — i.e. only while something is genuinely loading. Fast routes
// barely flash it; slow data loads + cold starts get the branded splash.
import BrandLoader from '@/lib/brand/BrandLoader'

export default function Loading() {
  return <BrandLoader variant="fullscreen" />
}
