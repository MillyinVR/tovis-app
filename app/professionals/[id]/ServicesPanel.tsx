// app/professionals/[id]/ServicesPanel.tsx
import type { PublicOfferingDto } from '@/lib/profiles/publicProfileMappers'

import ServicesBookingOverlay from './ServicesBookingOverlay'

type ServicesPanelProps = {
  professionalId: string
  offerings: PublicOfferingDto[]
  emptyMessage: string
}

export default function ServicesPanel({
  professionalId,
  offerings,
  emptyMessage,
}: ServicesPanelProps) {
  return (
    <section className="grid gap-3 py-5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-textMuted">
        Services
      </div>

      {offerings.length === 0 ? (
        <div className="brand-pp-card p-4 text-[13px] text-textSecondary">
          {emptyMessage}
        </div>
      ) : (
        <ServicesBookingOverlay
          professionalId={professionalId}
          offerings={offerings}
        />
      )}
    </section>
  )
}