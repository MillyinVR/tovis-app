// lib/media/qr.ts
//
// Server-side QR generation. Renders to an inline SVG string (no <img>, no external
// service, no client weight) so callers can drop it straight into markup. Keep this
// import server-only — `qrcode` is a Node module.
import QRCode from 'qrcode'

/**
 * An SVG QR code for `text`, or null if generation fails (never throw into a page
 * render over a decorative QR). Uses brand-neutral colors so the embedding surface
 * controls contrast via its container background.
 */
export async function qrSvgFor(text: string): Promise<string | null> {
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    return await QRCode.toString(trimmed, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
  } catch {
    return null
  }
}
