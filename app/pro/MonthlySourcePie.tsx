// app/pro/MonthlySourcePie.tsx

'use client'

type Slice = { label: string; value: number }

const COLORS = ['#60a5fa', '#34d399', '#a78bfa', '#f87171', '#fbbf24'] as const

function clamp(n: number) {
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

export default function MonthlySourcePie({ data }: { data: Slice[] }) {
  const normalizedData = data.map((d) => ({
    label: d.label,
    value: clamp(d.value),
  }))

  const total = normalizedData.reduce((sum, d) => sum + d.value, 0)

  if (!total) {
    return <div style={{ fontSize: 13, color: '#6b7280' }}>No data yet.</div>
  }

  const slices = normalizedData.map((d, index) => {
    const previousTotal = normalizedData
      .slice(0, index)
      .reduce((sum, row) => sum + row.value, 0)

    const startValue = previousTotal
    const endValue = previousTotal + d.value
    const midValue = startValue + d.value / 2

    const startDeg = (startValue / total) * 360
    const endDeg = (endValue / total) * 360

    const angle = (midValue / total) * Math.PI * 2 - Math.PI / 2
    const radius = 70
    const x = 90 + radius * Math.cos(angle)
    const y = 90 + radius * Math.sin(angle)

    return {
      label: d.label,
      value: d.value,
      color: COLORS[index % COLORS.length],
      stop: `${COLORS[index % COLORS.length]} ${startDeg}deg ${endDeg}deg`,
      x,
      y,
    }
  })

  return (
    <div style={{ display: 'grid', placeItems: 'center' }}>
      <div style={{ position: 'relative', width: 180, height: 180 }}>
        <div
          style={{
            width: 180,
            height: 180,
            borderRadius: '50%',
            background: `conic-gradient(${slices.map((s) => s.stop).join(',')})`,
            border: '1px solid #eee',
          }}
        />

        <svg width="180" height="180" style={{ position: 'absolute', inset: 0 }}>
          {slices.map((slice) =>
            slice.value ? (
              <g key={slice.label}>
                <text
                  x={slice.x}
                  y={slice.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="12"
                  fontWeight="900"
                  fill="#111"
                >
                  {slice.value}
                </text>
                <text
                  x={slice.x}
                  y={slice.y + 14}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="10"
                  fontWeight="800"
                  fill="#111"
                >
                  {slice.label}
                </text>
              </g>
            ) : null,
          )}
        </svg>
      </div>

      <div
        style={{
          marginTop: 10,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          fontSize: 12,
          color: '#6b7280',
          justifyContent: 'center',
        }}
      >
        {normalizedData.map((d) => (
          <span key={d.label}>
            <b style={{ color: '#111' }}>{d.label}</b>: {d.value}
          </span>
        ))}
      </div>
    </div>
  )
}