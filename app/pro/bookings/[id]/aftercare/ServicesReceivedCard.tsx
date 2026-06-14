// app/pro/bookings/[id]/aftercare/ServicesReceivedCard.tsx
//
// Read-only summary of the services performed and what was charged, shown on
// the aftercare page so the pro can confirm the appointment at closeout. All
// money values arrive pre-formatted (2-decimal strings) from the server.

export type ServiceLine = {
  id: string
  name: string
  isAddOn: boolean
  price: string | null
  durationMinutes: number | null
}

export type PricingSummary = {
  serviceSubtotal: string | null
  discount: string | null
  tax: string | null
  tip: string | null
  total: string | null
}

function isPositiveMoney(value: string | null): value is string {
  if (!value) return false
  const n = Number(value)
  return Number.isFinite(n) && n > 0
}

function MoneyRow({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div
        className={
          strong
            ? 'text-sm font-black text-textPrimary'
            : 'text-xs font-semibold text-textSecondary'
        }
      >
        {label}
      </div>
      <div
        className={
          strong
            ? 'text-sm font-black text-textPrimary'
            : 'text-xs font-black text-textPrimary'
        }
      >
        ${value}
      </div>
    </div>
  )
}

export default function ServicesReceivedCard({
  services,
  pricing,
}: {
  services: ServiceLine[]
  pricing: PricingSummary
}) {
  const hasServices = services.length > 0
  const hasTotals =
    isPositiveMoney(pricing.serviceSubtotal) ||
    isPositiveMoney(pricing.total) ||
    isPositiveMoney(pricing.tip) ||
    isPositiveMoney(pricing.tax) ||
    isPositiveMoney(pricing.discount)

  // Nothing snapshotted (older booking or free service) — don't render an
  // empty card.
  if (!hasServices && !hasTotals) return null

  return (
    <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-textPrimary">
      <div className="text-xs font-black tracking-wide text-textPrimary">
        Services received
      </div>
      <div className="text-xs font-semibold text-textSecondary">
        Confirm what was done and charged before you finish.
      </div>

      {hasServices ? (
        <div className="mt-3 grid gap-2">
          {services.map((line) => (
            <div
              key={line.id}
              className="flex items-center justify-between gap-3 rounded-card border border-white/10 bg-bgPrimary px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-textPrimary">
                  {line.name}
                  {line.isAddOn ? (
                    <span className="ml-2 rounded-full border border-white/10 bg-bgSecondary px-2 py-0.5 text-[10px] font-black text-textSecondary">
                      ADD-ON
                    </span>
                  ) : null}
                </div>
                {line.durationMinutes ? (
                  <div className="text-[11px] font-semibold text-textSecondary">
                    {line.durationMinutes} min
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 text-sm font-black text-textPrimary">
                {line.price ? `$${line.price}` : '—'}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {hasTotals ? (
        <div className="mt-3 grid gap-1 border-t border-white/10 pt-3">
          {isPositiveMoney(pricing.serviceSubtotal) ? (
            <MoneyRow label="Services" value={pricing.serviceSubtotal} />
          ) : null}
          {isPositiveMoney(pricing.discount) ? (
            <MoneyRow label="Discount" value={pricing.discount} />
          ) : null}
          {isPositiveMoney(pricing.tax) ? (
            <MoneyRow label="Tax" value={pricing.tax} />
          ) : null}
          {isPositiveMoney(pricing.tip) ? (
            <MoneyRow label="Tip" value={pricing.tip} />
          ) : null}
          {isPositiveMoney(pricing.total) ? (
            <MoneyRow label="Total" value={pricing.total} strong />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
