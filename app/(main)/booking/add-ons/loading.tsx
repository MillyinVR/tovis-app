// app/(main)/booking/add-ons/loading.tsx
// Streamed by Next.js the moment navigation starts, while the dynamic
// page fetches add-on context on the server. Mirrors AddOnsClient layout.

export default function BookingAddOnsLoading() {
  return (
    <main className="mx-auto max-w-180 px-4 pb-28 pt-10 text-textPrimary">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-black text-textSecondary">
            Review &amp; customize
          </div>
          <h1 className="mt-1 text-[26px] font-black">Add-ons</h1>

          <div className="mt-2 text-[12px] font-semibold text-textSecondary">
            Loading add-ons…
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3" aria-hidden>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4"
          >
            <div className="h-3 w-24 animate-pulse rounded-full bg-white/10" />

            <div className="mt-3 grid gap-2">
              <div className="h-16 animate-pulse rounded-card border border-white/10 bg-bgPrimary/35" />
              <div className="h-16 animate-pulse rounded-card border border-white/10 bg-bgPrimary/35" />
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
