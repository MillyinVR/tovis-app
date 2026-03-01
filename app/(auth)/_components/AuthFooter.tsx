// app/(auth)/_components/AuthFooter.tsx
import Link from 'next/link'

export default function AuthFooter() {
  return (
    <footer className="mt-8 border-t border-surfaceGlass/10 pt-4 text-xs text-textSecondary">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link className="font-black text-textSecondary hover:text-textPrimary" href="/terms">
            Terms
          </Link>
          <Link className="font-black text-textSecondary hover:text-textPrimary" href="/privacy">
            Privacy
          </Link>
          <Link className="font-black text-textSecondary hover:text-textPrimary" href="/support">
            Support
          </Link>
        </div>

        <div className="text-textSecondary/80">
          © {new Date().getFullYear()} <span className="font-black text-textPrimary">TOVIS</span>
        </div>
      </div>
    </footer>
  )
}
