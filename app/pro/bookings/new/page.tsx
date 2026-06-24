// app/pro/bookings/new/page.tsx
import Link from 'next/link'
import BookingCreateContent, {
  type BookingCreateSearchParams,
} from './BookingCreateContent'

export default async function NewBookingPage(props: {
  searchParams: Promise<BookingCreateSearchParams>
}) {
  const searchParams = await props.searchParams

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8">
      <Link
        href="/pro"
        className="inline-flex items-center gap-1.5 text-textMuted transition hover:text-textSecondary"
      >
        <span aria-hidden>←</span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest">
          Dashboard
        </span>
      </Link>

      <div className="mt-3.5">
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accentPrimary">
          Studio · New booking
        </div>
        <h1 className="mt-1.5 font-display text-[28px] font-bold tracking-tight text-textPrimary">
          New booking
        </h1>
        <p className="mt-1.5 text-[13px] text-textSecondary">
          Book a client in a few taps — salon or mobile, new face or regular.
        </p>
      </div>

      <div className="mt-5">
        <BookingCreateContent searchParams={searchParams} />
      </div>
    </main>
  )
}