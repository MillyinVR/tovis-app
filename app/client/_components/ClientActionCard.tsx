// app/client/_components/ClientActionCard.tsx
import Link from 'next/link'

import type {
  ClientHomeAction,
  ClientHomeBooking,
} from '../_data/getClientHomeData'

type AftercarePaymentAction = Extract<
  ClientHomeAction,
  { kind: 'AFTERCARE_PAYMENT_DUE' }
>

function money(
  value: { toString(): string } | number | string | null,
): string | null {
  if (value == null) return null
  const numeric =
    typeof value === 'number' ? value : Number.parseFloat(value.toString())
  if (!Number.isFinite(numeric)) return null
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(numeric)
}

function professionalName(professional: {
  businessName: string | null
  handle?: string | null
}): string {
  return (
    professional.businessName ??
    professional.handle ??
    'Professional'
  ).trim()
}

function bookingTitle(booking: ClientHomeBooking): string {
  const serviceItemNames = booking.serviceItems
    .map((item) => item.service?.name?.trim())
    .filter((name): name is string => Boolean(name))
  if (serviceItemNames.length === 1) return serviceItemNames[0]
  if (serviceItemNames.length > 1)
    return `${serviceItemNames[0]} + ${serviceItemNames.length - 1} more`
  return booking.service?.name ?? 'Appointment'
}

function formatShortDate(date: Date | null | undefined): string {
  if (!date) return ''
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function PendingConsultationCard({ booking }: { booking: ClientHomeBooking }) {
  const title = bookingTitle(booking)
  const proName = professionalName(booking.professional)
  const proposedTotal = money(
    booking.consultationApproval?.proposedTotal ?? null,
  )

  return (
    <div className="px-4">
      <div
        className="overflow-hidden border"
        style={{
          borderRadius: 18,
          background: 'rgba(224,90,40,0.04)',
          borderColor: 'rgba(224,90,40,0.35)',
        }}
      >
        <div
          className="border-b px-4 py-3.5"
          style={{ borderColor: 'rgba(224,90,40,0.15)' }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-terra">
            ◆ Consultation pending
          </span>
        </div>

        <div className="p-4">
          <p className="text-[15px] font-bold text-textPrimary">
            Review your consultation changes
          </p>
          <p className="mt-0.5 text-[12px] text-textSecondary">
            {title} · {proName}
            {proposedTotal ? ` · ${proposedTotal}` : ''}
          </p>

          {booking.consultationApproval?.notes ? (
            <p
              className="mt-3 rounded-[10px] border border-textPrimary/8 px-3 py-2.5 text-[12px] italic leading-relaxed text-textSecondary"
              style={{
                background: 'rgba(224,90,40,0.05)',
                fontFamily: 'var(--font-display)',
              }}
            >
              &ldquo;{booking.consultationApproval.notes}&rdquo;
            </p>
          ) : (
            <p className="mt-3 text-[11px] leading-relaxed text-textMuted">
              Your pro updated the consultation details. Review the proposal
              before the booking moves forward.
            </p>
          )}

          <div className="mt-4 grid gap-2">
            <Link
              href={`/client/bookings/${encodeURIComponent(booking.id)}?step=consult`}
              className="flex items-center justify-center rounded-[10px] py-3 text-[12px] font-extrabold text-bgPrimary transition hover:opacity-90"
              style={{ background: 'rgb(var(--terra))' }}
            >
              Review &amp; approve
            </Link>
            <Link
              href={`/client/bookings/${encodeURIComponent(booking.id)}`}
              className="flex items-center justify-center rounded-[10px] border border-textPrimary/16 py-3 text-[12px] font-bold text-textSecondary transition hover:border-textPrimary/25"
            >
              View full
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function AftercarePaymentCard({ action }: { action: AftercarePaymentAction }) {
  const { aftercare, booking } = action
  const title = bookingTitle(booking)
  const total = money(booking.totalAmount)
  const sentDate = formatShortDate(aftercare.sentToClientAt)

  const products = aftercare.recommendedProducts
    .map((item) => {
      const productName = item.product?.name ?? item.externalName
      const brand = item.product?.brand ?? null
      const price = money(item.product?.retailPrice ?? null)
      if (!productName) return null
      return {
        key: item.id,
        label: brand ? `${brand} ${productName}` : productName,
        price,
      }
    })
    .filter(
      (
        product,
      ): product is { key: string; label: string; price: string | null } =>
        product !== null,
    )

  return (
    <div className="px-4">
      <div
        className="overflow-hidden border"
        style={{
          borderRadius: 18,
          background: 'rgba(212,255,58,0.04)',
          borderColor: 'rgba(212,255,58,0.2)',
        }}
      >
        <div
          className="border-b px-4 py-3.5"
          style={{ borderColor: 'rgba(212,255,58,0.12)' }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-acid">
            ◆ Aftercare ready{sentDate ? ` · From ${sentDate}` : ''}
          </span>
        </div>

        <div className="p-4">
          <p className="text-[13px] font-semibold text-textPrimary">{title}</p>

          {aftercare.notes ? (
            <p
              className="mt-2 text-[12px] italic leading-relaxed text-textSecondary"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              &ldquo;{aftercare.notes}&rdquo;
            </p>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-textMuted">
              Your aftercare summary is ready. Review the notes, products, and
              payment details.
            </p>
          )}

          {products.length > 0 && (
            <div className="mt-3 flex gap-2">
              {products.slice(0, 2).map((product) => (
                <div
                  key={product.key}
                  className="min-w-0 flex-1 rounded-[10px] border border-textPrimary/8 px-3 py-2"
                  style={{ background: 'rgba(244,239,231,0.04)' }}
                >
                  <p className="truncate text-[11px] font-semibold text-textPrimary">
                    {product.label}
                  </p>
                  {product.price && (
                    <p className="mt-0.5 text-[10px] text-textMuted">
                      {product.price}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-2">
            <Link
              href={`/client/bookings/${encodeURIComponent(booking.id)}?step=aftercare`}
              className="flex items-center justify-center rounded-[10px] py-3 text-[12px] font-extrabold text-bgPrimary transition hover:opacity-90"
              style={{ background: 'rgb(var(--acid))' }}
            >
              {total ? `Pay ${total}` : 'Complete payment'}
            </Link>
            <Link
              href={`/client/bookings/${encodeURIComponent(booking.id)}`}
              className="flex items-center justify-center rounded-[10px] border border-textPrimary/16 py-3 text-[12px] font-bold text-textSecondary transition hover:border-textPrimary/25"
            >
              View full
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ClientActionCard({ action }: { action: ClientHomeAction }) {
  if (!action) return null

  if (action.kind === 'PENDING_CONSULTATION') {
    return <PendingConsultationCard booking={action.booking} />
  }

  return <AftercarePaymentCard action={action} />
}
