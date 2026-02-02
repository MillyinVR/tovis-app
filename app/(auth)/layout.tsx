// app/(auth)/layout.tsx
import type { ReactNode } from 'react'
import AuthFooter from './_components/AuthFooter'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bgPrimary text-textPrimary">
      {/* soft “premium” background layers */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 opacity-70 [mask-image:radial-gradient(60%_50%_at_50%_20%,black,transparent)]">
          <div className="absolute -top-24 left-1/2 h-72 w-[560px] -translate-x-1/2 rounded-full bg-accentPrimary/10 blur-3xl" />
          <div className="absolute top-40 left-1/2 h-72 w-[620px] -translate-x-1/2 rounded-full bg-surfaceGlass/10 blur-3xl" />
        </div>
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-540px flex-col px-4 pb-10 pt-10">
        <div className="flex-1">{children}</div>
        <AuthFooter />
      </div>
    </div>
  )
}
