'use client'

export default function ShareButton({ url }: { url: string }) {
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ url })
        return
      }
      await navigator.clipboard.writeText(url)
      alert('Link copied.')
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      style={{
        width: 44,
        height: 44,
        borderRadius: 999,
        border: '1px solid #e5e7eb',
        background: '#fff',
        cursor: 'pointer',
        fontSize: 16,
      }}
      title="Share"
      aria-label="Share profile"
    >
      ↗
    </button>
  )
}
