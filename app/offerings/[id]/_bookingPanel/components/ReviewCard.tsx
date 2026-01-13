'use client'

export function ReviewCard(props: {
  title: string
  statusRight: React.ReactNode
  serviceName: string
  professionalName: string
  reviewLine: string | null
  viewerTimeLine: string | null
  footerLine: string
  success?: boolean
}) {
  const { title, statusRight, serviceName, professionalName, reviewLine, viewerTimeLine, footerLine, success } = props

  return (
    <div className={`rounded-2xl border border-white/10 p-3 ${success ? 'bg-emerald-500/10' : 'bg-bgSecondary'}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xs font-extrabold text-textSecondary">{title}</div>
        <div className="text-xs font-extrabold">{statusRight}</div>
      </div>

      <div className="mt-2 grid gap-1">
        <div className="text-sm font-extrabold">{serviceName}</div>
        <div className="text-sm">
          <span className="font-extrabold">{professionalName}</span>
          {reviewLine ? <span className="text-textPrimary"> · {reviewLine}</span> : <span className="text-textSecondary"> · Missing time</span>}
        </div>
        {viewerTimeLine ? <div className="text-xs text-textSecondary">{viewerTimeLine}</div> : null}
        <div className={`text-xs ${success ? 'text-emerald-200' : 'text-textSecondary'}`}>{footerLine}</div>
      </div>
    </div>
  )
}
