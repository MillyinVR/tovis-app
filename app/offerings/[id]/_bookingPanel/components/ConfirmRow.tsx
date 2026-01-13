'use client'

export function ConfirmRow(props: {
  checked: boolean
  setChecked: (v: boolean) => void
  disabled: boolean
}) {
  const { checked, setChecked, disabled } = props

  return (
    <label className="flex gap-3 rounded-2xl border border-white/10 bg-bgPrimary p-3">
      <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={disabled} className="mt-1" />
      <div>
        <div className="text-sm font-extrabold">I’m confirming this time works for me</div>
        <div className="mt-1 text-xs text-textSecondary">Tiny step. Big reduction in “oops, wrong day.”</div>
      </div>
    </label>
  )
}
