// app/(auth)/signup/page.tsx

import Link from 'next/link'

export default function SignupChooserPage({
  searchParams,
}: {
  searchParams?: { ti?: string }
}) {
  const ti = searchParams?.ti
  const qs = ti ? `?ti=${encodeURIComponent(ti)}` : ''

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="grid gap-3 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5 tovis-glass-soft">
        <div className="text-lg font-black text-textPrimary">Create your account</div>
        <div className="text-sm text-textSecondary">
          Pick what you’re here to do.
        </div>

        <div className="grid gap-2 pt-2">
          <Link
            href={`/signup/pro${qs}`}
            className="inline-flex w-full items-center justify-center rounded-full border border-accentPrimary/35 bg-accentPrimary/26 px-4 py-2.5 text-sm font-black text-textPrimary transition hover:bg-accentPrimary/30 hover:border-accentPrimary/45 focus:outline-none focus:ring-2 focus:ring-accentPrimary/20"
          >
            I’m a Pro — Offer services
          </Link>

          <Link
            href={`/signup/client${qs}`}
            className="inline-flex w-full items-center justify-center rounded-full border border-surfaceGlass/14 bg-bgPrimary/25 px-4 py-2.5 text-sm font-black text-textPrimary transition hover:border-surfaceGlass/20 hover:bg-bgPrimary/30 focus:outline-none focus:ring-2 focus:ring-accentPrimary/15"
          >
            I’m a Client — Book services
          </Link>

          <div className="pt-2 text-center text-xs text-textSecondary/70">
            Already have an account?{' '}
            <Link
              href={ti ? `/login?ti=${encodeURIComponent(ti)}` : '/login'}
              className="font-black text-textPrimary hover:text-accentPrimary"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}