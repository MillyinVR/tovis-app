'use client'

type Slice = { label: string; value: number }

function clamp(n: number) {
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

export default function MonthlySourcePie({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + clamp(d.value), 0)

  if (!total) {
    return <div style={{ fontSize: 13, color: '#6b7280' }}>No data yet.</div>
  }

  // build conic-gradient stops
  let acc = 0
  const stops = data.map((d, i) => {
    const v = clamp(d.value)
    const start = (acc / total) * 360
    acc += v
    const end = (acc / total) * 360
    // no custom colors requested, so we’ll use a simple rotating palette
    const colors = ['#60a5fa', '#34d399', '#a78bfa', '#f87171', '#fbbf24']
    return `${colors[i % colors.length]} ${start}deg ${end}deg`
  })

  // compute label positions (approx) and show number in slice
  acc = 0
  const labels = data.map((d) => {
    const v = clamp(d.value)
    const start = acc
    const mid = start + v / 2
    acc += v

    const angle = (mid / total) * Math.PI * 2 - Math.PI / 2
    const r = 70 // radius for label placement
    const x = 90 + r * Math.cos(angle)
    const y = 90 + r * Math.sin(angle)

    return { x, y, label: d.label, value: v }
  })

  return (
    <div style={{ display: 'grid', placeItems: 'center' }}>
      <div style={{ position: 'relative', width: 180, height: 180 }}>
        <div
          style={{
            width: 180,
            height: 180,
            borderRadius: '50%',
            background: `conic-gradient(${stops.join(',')})`,
            border: '1px solid #eee',
          }}
        />

        {/* Labels inside slices */}
        <svg width="180" height="180" style={{ position: 'absolute', inset: 0 }}>
          {labels.map((l) =>
            l.value ? (
              <g key={l.label}>
                <text
                  x={l.x}
                  y={l.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="12"
                  fontWeight="900"
                  fill="#111"
                >
                  {l.value}
                </text>
                <text
                  x={l.x}
                  y={l.y + 14}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="10"
                  fontWeight="800"
                  fill="#111"
                >
                  {l.label}
                </text>
              </g>
            ) : null,
          )}
        </svg>
      </div>

      {/* Legend (compact) */}
      <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: '#6b7280', justifyContent: 'center' }}>
        {data.map((d) => (
          <span key={d.label}>
            <b style={{ color: '#111' }}>{d.label}</b>: {clamp(d.value)}
          </span>
        ))}
      </div>
    </div>
  )
}
