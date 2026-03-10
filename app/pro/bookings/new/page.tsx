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
    <main className="mx-auto w-full max-w-215 px-4 pb-24 pt-8">
      <Link
        href="/pro"
        className="inline-block text-[12px] font-black text-textSecondary hover:text-textPrimary"
      >
        ← Back to dashboard
      </Link>

      <div className="mt-3">
        <h1 className="text-[22px] font-black text-textPrimary">
          New booking
        </h1>
        <p className="mt-1 text-[12px] text-textSecondary">
          Create a booking for a client and choose whether it is salon or mobile
          before saving.
        </p>
      </div>

      <div className="mt-5">
        <BookingCreateContent searchParams={searchParams} />
      </div>
    </main>
  )
}