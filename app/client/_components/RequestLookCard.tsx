// app/client/_components/RequestLookCard.tsx
import ClientViralRequestsPanel from '../components/ClientViralRequestsPanel'

export default function RequestLookCard() {
  return (
    <section className="px-4">
      <div className="mb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
          <span className="text-acid">◆</span>
          <span className="ml-1.5 text-textMuted">Request a Look</span>
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-textMuted">
        Seen something not on Tovis yet? Tell us — we&apos;ll bring it here.
      </p>

      <div
        className="overflow-hidden border"
        style={{
          borderRadius: 14,
          background: 'rgba(212,255,58,0.03)',
          borderColor: 'rgba(212,255,58,0.15)',
        }}
      >
        <div
          className="border-b px-4 py-3"
          style={{ borderColor: 'rgba(212,255,58,0.08)' }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-acid">
            ◆ Describe it and we&apos;ll find it
          </span>
        </div>
        <div className="p-4">
          <ClientViralRequestsPanel />
        </div>
      </div>
    </section>
  )
}
