'use client'

export function InlineNotice(props: { tone?: 'neutral' | 'success' | 'danger'; children: React.ReactNode }) {
  const tone = props.tone ?? 'neutral'
  const cls =
    tone === 'success'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
      : tone === 'danger'
        ? 'border-red-500/20 bg-red-500/10 text-red-200'
        : 'border-white/10 bg-bgSecondary text-textSecondary'

  return <div className={`rounded-2xl border p-3 text-sm ${cls}`}>{props.children}</div>
}
