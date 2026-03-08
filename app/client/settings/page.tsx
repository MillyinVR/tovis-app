// app/client/settings/page.tsx
import Image from 'next/image'
import ClientProfileSettings from './ClientProfileSettings'
import ClientLocationSettings from './ClientLocationSettings'
import ClientAddressesSettings from './ClientAddressesSettings'
import { tovisBrand } from '@/lib/brand/brands/tovis'

export const dynamic = 'force-dynamic'

function SectionIntro(props: {
  title: string
  description: string
}) {
  return (
    <div className="mb-4">
      <div className="text-sm font-black tracking-[var(--ls-caps)] text-textPrimary">
        {props.title}
      </div>
      <div className="mt-1 text-xs font-semibold leading-5 text-textSecondary">
        {props.description}
      </div>
    </div>
  )
}

export default function ClientSettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="brand-glass overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[calc(var(--radius-card)-8px)] border border-white/10 bg-bgSecondary/40">
              <Image
                src={tovisBrand.assets.mark.src}
                alt={tovisBrand.assets.mark.alt}
                fill
                className="object-cover"
                sizes="48px"
                priority
              />
            </div>

            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xl font-black tracking-[var(--ls-caps)] text-textPrimary">
                  {tovisBrand.assets.wordmark.text}
                </div>
                <div className="rounded-full border border-white/10 bg-bgSecondary/35 px-3 py-1 text-[11px] font-black uppercase tracking-[var(--ls-caps)] text-textSecondary">
                  Client settings
                </div>
              </div>

              <div className="mt-2 text-sm font-semibold leading-6 text-textSecondary">
                Manage your profile, discovery location, and saved addresses.
                Search areas help you browse nearby salons and pros. Service
                addresses are used for mobile bookings.
              </div>
            </div>
          </div>

          <div className="rounded-full border border-[rgb(var(--accent-primary)/0.22)] bg-[rgb(var(--accent-primary)/0.10)] px-3 py-1.5 text-[11px] font-black uppercase tracking-[var(--ls-caps)] text-textPrimary">
            Salon = area okay · Mobile = real address required
          </div>
        </div>
      </section>

      <ClientProfileSettings />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="brand-glass p-5 sm:p-6">
          <SectionIntro
            title="Discovery location"
            description="This controls nearby search, salon discovery, and “near me” browsing. It does not replace your saved mobile service addresses."
          />

          <ClientLocationSettings />
        </div>

        <div className="brand-glass p-5 sm:p-6">
          <SectionIntro
            title="Saved addresses"
            description="Save multiple areas and service addresses. Use search areas for salon-only browsing. Use service addresses for mobile bookings."
          />

          <ClientAddressesSettings />
        </div>
      </section>

      <section className="brand-glass p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="text-sm font-black tracking-[var(--ls-caps)] text-textPrimary">
              How this works
            </div>
            <div className="mt-1 text-xs font-semibold leading-5 text-textSecondary">
              Your discovery location helps TOVIS show nearby pros and salons.
              Your saved service addresses are separate, so mobile bookings can
              use a real destination without messing up your search preferences.
            </div>
          </div>

          <div className="rounded-full border border-white/10 bg-bgSecondary/35 px-3 py-1.5 text-[11px] font-black uppercase tracking-[var(--ls-caps)] text-textSecondary">
            Account truth + local search context
          </div>
        </div>
      </section>
    </div>
  )
}