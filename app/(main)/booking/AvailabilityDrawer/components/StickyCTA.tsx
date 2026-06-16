// app/(main)/booking/AvailabilityDrawer/components/StickyCTA.tsx
'use client'

type StickyCTAProps = {
  canContinue: boolean
  loading: boolean
  navigating: boolean
  onContinue: () => void
  selectedLine: string | null
  continueLabel: string
}

export default function StickyCTA({
  canContinue,
  loading,
  navigating,
  onContinue,
  selectedLine,
  continueLabel,
}: StickyCTAProps) {
  const pending = loading || navigating

  const buttonLabel = navigating
    ? 'Loading add-ons…'
    : loading
    ? 'Holding your time…'
    : canContinue
    ? continueLabel
    : 'Pick a time to continue'

  return (
    <div
      style={{
        borderTop: '1px solid rgb(var(--surface-glass) / 0.1)',
        background: 'rgb(var(--bg-primary))',
        padding: '14px 16px 18px',
      }}
    >
      {selectedLine ? (
        <div
          style={{
            marginBottom: 10,
            textAlign: 'center',
            fontSize: 12,
            fontWeight: 600,
            color: 'rgb(var(--text-primary) / 0.45)',
          }}
        >
          Held:{' '}
          <span style={{ fontWeight: 900, color: 'rgb(var(--text-primary) / 0.88)' }}>
            {selectedLine}
          </span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onContinue}
        disabled={!canContinue || pending}
        aria-busy={pending}
        style={{
          width: '100%',
          height: 52,
          borderRadius: 999,
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          background: canContinue ? 'rgb(var(--accent-primary))' : 'rgb(var(--surface-glass) / 0.1)',
          color: canContinue ? 'rgb(var(--text-primary))' : 'rgb(var(--text-primary) / 0.3)',
          fontSize: 14,
          fontWeight: 900,
          letterSpacing: '0.04em',
          fontFamily: 'var(--font-mono)',
          cursor: canContinue && !pending ? 'pointer' : 'not-allowed',
          transition: 'background 0.2s ease, color 0.2s ease',
          boxShadow: canContinue ? '0 4px 20px rgb(var(--accent-primary) / 0.45)' : 'none',
        }}
      >
        {pending ? (
          <span
            aria-hidden
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
          />
        ) : null}
        {buttonLabel}
      </button>

      {!canContinue && !pending ? (
        <div
          style={{
            marginTop: 8,
            textAlign: 'center',
            fontSize: 11,
            fontWeight: 600,
            color: 'rgb(var(--text-primary) / 0.28)',
          }}
        >
          No charge yet · The pro confirms first
        </div>
      ) : null}
    </div>
  )
}
