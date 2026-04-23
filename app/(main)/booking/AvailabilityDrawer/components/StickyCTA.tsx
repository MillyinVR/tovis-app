// app/(main)/booking/AvailabilityDrawer/components/StickyCTA.tsx
'use client'

type StickyCTAProps = {
  canContinue: boolean
  loading: boolean
  onContinue: () => void
  selectedLine: string | null
  continueLabel: string
}

export default function StickyCTA({
  canContinue,
  loading,
  onContinue,
  selectedLine,
  continueLabel,
}: StickyCTAProps) {
  const buttonLabel = loading
    ? 'Holding your time…'
    : canContinue
    ? continueLabel
    : 'Pick a time to continue'

  return (
    <div
      style={{
        borderTop: '1px solid rgba(244,239,231,0.1)',
        background: '#0A0907',
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
            color: 'rgba(244,239,231,0.45)',
          }}
        >
          Held:{' '}
          <span style={{ fontWeight: 900, color: 'rgba(244,239,231,0.88)' }}>
            {selectedLine}
          </span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onContinue}
        disabled={!canContinue || loading}
        style={{
          width: '100%',
          height: 52,
          borderRadius: 999,
          border: 'none',
          background: canContinue ? '#E05A28' : 'rgba(244,239,231,0.1)',
          color: canContinue ? '#ffffff' : 'rgba(244,239,231,0.3)',
          fontSize: 14,
          fontWeight: 900,
          letterSpacing: '0.04em',
          fontFamily: 'var(--font-mono)',
          cursor: canContinue && !loading ? 'pointer' : 'not-allowed',
          transition: 'background 0.2s ease, color 0.2s ease',
          boxShadow: canContinue ? '0 4px 20px rgba(224,90,40,0.45)' : 'none',
        }}
      >
        {buttonLabel}
      </button>

      {!canContinue && !loading ? (
        <div
          style={{
            marginTop: 8,
            textAlign: 'center',
            fontSize: 11,
            fontWeight: 600,
            color: 'rgba(244,239,231,0.28)',
          }}
        >
          No charge yet · The pro confirms first
        </div>
      ) : null}
    </div>
  )
}
