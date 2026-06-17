// app/pro/migrate/_components/SummaryBar.tsx

export type SummaryStat = {
  value: string
  label: string
  tone?: 'accent' | 'gold' | 'warn' | 'muted'
}

type Props = {
  stats: SummaryStat[]
  cta: { label: string; disabled?: boolean; onClick?: () => void }
}

const TONE_CLASS: Record<NonNullable<SummaryStat['tone']>, string> = {
  accent: 'text-accentPrimary',
  gold: 'text-amber',
  warn: 'text-ember',
  muted: 'text-textMuted',
}

export function SummaryBar({ stats, cta }: Props) {
  return (
    <div className="sticky bottom-0 z-20 mt-8 border-t border-white/10 bg-bgSecondary/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-5 gap-y-2"
        >
          {stats.map((stat, i) => (
            <div key={stat.label} className="flex items-center gap-5">
              {i > 0 ? (
                <span className="hidden h-6 w-px bg-white/10 sm:block" aria-hidden="true" />
              ) : null}
              <span className="flex items-baseline gap-1.5">
                <span
                  className={[
                    'text-lg font-medium',
                    TONE_CLASS[stat.tone ?? 'accent'],
                  ].join(' ')}
                >
                  {stat.value}
                </span>
                <span className="text-[12px] text-textMuted">{stat.label}</span>
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={cta.onClick}
          disabled={cta.disabled}
          className={[
            'inline-flex h-11 shrink-0 items-center justify-center rounded-full px-6 text-[14px] font-medium transition',
            cta.disabled
              ? 'cursor-not-allowed bg-white/5 text-textMuted'
              : 'text-onAccent hover:opacity-90',
          ].join(' ')}
          style={
            cta.disabled
              ? undefined
              : { background: 'var(--cta)', color: 'rgb(var(--on-cta))' }
          }
        >
          {cta.label} →
        </button>
      </div>
    </div>
  )
}
