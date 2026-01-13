// app/(main)/booking/AvailabilityDrawer/components/DebugPanel.tsx

'use client'

export default function DebugPanel({ payload }: { payload: any }) {
  return (
    <div className="tovis-glass-soft mt-3 rounded-card p-3">
      <div className="text-[12px] font-black text-textPrimary">Debug</div>
      <pre className="mt-2 max-h-60 overflow-auto text-[11px] text-textSecondary">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  )
}
