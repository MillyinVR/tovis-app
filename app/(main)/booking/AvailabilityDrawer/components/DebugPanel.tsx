// app/(main)/booking/AvailabilityDrawer/components/DebugPanel.tsx
'use client'

type DebugPanelProps = {
  payload: unknown
}

function stringifyDebugPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return '[Unable to stringify debug payload]'
  }
}

export default function DebugPanel({ payload }: DebugPanelProps) {
  return (
    <div className="tovis-glass-soft mt-3 rounded-card p-3">
      <div className="text-[12px] font-black text-textPrimary">Debug</div>

      <pre className="mt-2 max-h-60 overflow-auto text-[11px] text-textSecondary">
        {stringifyDebugPayload(payload)}
      </pre>
    </div>
  )
}