import type { PublicAcceptedMethod } from '@/lib/payments/publicAcceptedMethods'

// Public, handle-free "Accepted payments" badge row for a pro profile. The
// actual handles (Venmo @, Zelle/Apple Cash contact, PayPal) are revealed only
// at checkout after a client books — never here.
export default function AcceptedPayments({
  methods,
}: {
  methods: PublicAcceptedMethod[]
}) {
  if (methods.length === 0) return null

  return (
    <section className="brand-profile-card mt-4 p-4">
      <div className="text-[12px] font-black text-textPrimary">
        Accepted payments
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {methods.map((method) => (
          <span
            key={method.key}
            className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-[12px] font-black text-textPrimary"
          >
            {method.label}
          </span>
        ))}
      </div>

      <div className="mt-2 text-[11px] text-textSecondary">
        Payment details are shared at checkout after you book.
      </div>
    </section>
  )
}
