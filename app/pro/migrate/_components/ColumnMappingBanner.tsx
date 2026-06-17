// app/pro/migrate/_components/ColumnMappingBanner.tsx

type Props = {
  mappings: Array<{ src: string; dest: string }>
}

export function ColumnMappingBanner({ mappings }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-white/10 bg-bgSecondary px-4 py-3">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-textMuted">
        Columns mapped
      </span>
      {mappings.map((m) => (
        <span
          key={m.src}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[12px]"
        >
          <span className="font-mono text-textMuted">{m.src}</span>
          <span className="text-textMuted" aria-hidden="true">
            →
          </span>
          <span className="text-textSecondary">{m.dest}</span>
        </span>
      ))}
    </div>
  )
}
