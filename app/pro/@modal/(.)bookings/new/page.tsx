// app/pro/@modal/(.)bookings/new/page.tsx 
import RouteOverlay from '@/app/pro/_components/RouteOverlay'
import BookingCreateContent, {
  type BookingCreateSearchParams,
} from '@/app/pro/bookings/new/BookingCreateContent'

export default async function Page(props: {
  searchParams: Promise<BookingCreateSearchParams>
}) {
  const searchParams = await props.searchParams

  return (
    <RouteOverlay
      title="New booking"
      subtitle="Create a booking for a client without leaving your current screen."
    >
      <BookingCreateContent searchParams={searchParams} isModal />
    </RouteOverlay>
  )
}