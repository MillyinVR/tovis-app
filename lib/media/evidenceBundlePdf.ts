// lib/media/evidenceBundlePdf.ts
//
// Renders a booking's evidence-bundle data (lib/media/evidenceBundleData.ts)
// into a single PDF: a cover/summary page, then per-asset pages — the
// ORIGINAL image untouched, and a separate STAMPED COPY with a visible
// timestamp + booking ref burned into that copy only. The original page's
// image bytes are exactly what was embedded from storage; nothing is ever
// drawn on top of them.
//
// This is deliberately honest about what it proves: sha256Server is computed
// from the bytes this app's server actually stored (the only hash it trusts);
// receivedAt is that server's own clock (a fact); capturedAtClaimed is the
// capturing device's own clock, self-reported and never independently
// verified (testimony, not proof) — and a gap between the two is not evidence
// of tampering, since an offline capture legitimately uploads later.
import 'server-only'

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

import { formatInTimeZone } from '@/lib/time'
import { wrapText } from '@/lib/pdf/wrapText'
import type { EvidenceBundleAsset, EvidenceBundleData } from './evidenceBundleData'

export type EvidenceBundlePdfResult = {
  filename: string
  bytes: Uint8Array
}

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 56
const CONTENT_W = PAGE_W - MARGIN * 2

const INK = rgb(0.1, 0.12, 0.11)
const MUTED = rgb(0.42, 0.45, 0.44)
const RULE = rgb(0.8, 0.82, 0.81)
const WARN = rgb(0.6, 0.22, 0.05)
const STAMP_BG = rgb(0.05, 0.05, 0.05)
const STAMP_INK = rgb(1, 1, 1)

function sniffImageFormat(bytes: Uint8Array): 'jpg' | 'png' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg'
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png'
  }
  return null
}

function phaseLabel(phase: string): string {
  if (phase === 'BEFORE') return 'Before'
  if (phase === 'AFTER') return 'After'
  return 'Other'
}

function formatTimestamp(date: Date, timeZone: string): string {
  const zoned = formatInTimeZone(date, timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
  return `${zoned} · ${date.toISOString()}`
}

type DrawCtx = {
  page: PDFPage
  font: PDFFont
  bold: PDFFont
  y: number
}

function text(ctx: DrawCtx, s: string, size: number, opts?: { bold?: boolean; color?: ReturnType<typeof rgb> }) {
  ctx.page.drawText(s, {
    x: MARGIN,
    y: ctx.y,
    size,
    font: opts?.bold ? ctx.bold : ctx.font,
    color: opts?.color ?? INK,
  })
}

function rule(ctx: DrawCtx) {
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y + 6 },
    end: { x: PAGE_W - MARGIN, y: ctx.y + 6 },
    thickness: 0.75,
    color: RULE,
  })
}

function paragraph(ctx: DrawCtx, s: string, size: number, opts?: { color?: ReturnType<typeof rgb> }) {
  for (const line of wrapText(s, ctx.font, size, CONTENT_W)) {
    text(ctx, line, size, { color: opts?.color })
    ctx.y -= size + 4
  }
}

function attestationLines(
  asset: EvidenceBundleAsset,
  timeZone: string,
): Array<{ label: string; value: string; warn?: boolean }> {
  if (!asset.attestation) {
    return [
      {
        label: 'Attestation',
        value:
          'None on file. This photo was captured before capture attestation existed for this booking — there is no server-side hash or receipt-time record for it.',
        warn: true,
      },
    ]
  }

  const a = asset.attestation
  const lines: Array<{ label: string; value: string; warn?: boolean }> = [
    { label: 'sha256 (server-computed)', value: a.sha256Server },
    {
      label: 'Received by server',
      value: formatTimestamp(a.receivedAt, timeZone),
    },
  ]

  if (a.capturedAtClaimed) {
    lines.push({
      label: 'Capture time (device-claimed)',
      value: formatTimestamp(a.capturedAtClaimed, timeZone),
    })
    const gapMs = a.receivedAt.getTime() - a.capturedAtClaimed.getTime()
    if (gapMs > 60 * 60 * 1000) {
      const hours = Math.round(gapMs / (60 * 60 * 1000))
      lines.push({
        label: 'Gap',
        value: `${hours}h between claimed capture and server receipt. Not evidence of tampering — an offline capture legitimately uploads later.`,
      })
    }
  } else {
    lines.push({
      label: 'Capture time (device-claimed)',
      value: 'Not reported by the capturing device for this upload.',
    })
  }

  if (a.sha256Client) {
    lines.push({
      label: 'sha256 (device-claimed)',
      value: a.hashMismatch
        ? `${a.sha256Client} — DOES NOT MATCH the server-computed hash above.`
        : `${a.sha256Client} — matches the server-computed hash.`,
      warn: a.hashMismatch,
    })
  }

  return lines
}

function drawAttestationBlock(
  ctx: DrawCtx,
  asset: EvidenceBundleAsset,
  timeZone: string,
) {
  for (const line of attestationLines(asset, timeZone)) {
    text(ctx, line.label, 9, { bold: true, color: line.warn ? WARN : MUTED })
    ctx.y -= 12
    for (const wrapped of wrapText(line.value, ctx.font, 9, CONTENT_W)) {
      text(ctx, wrapped, 9, { color: line.warn ? WARN : INK })
      ctx.y -= 12
    }
    ctx.y -= 4
  }
}

async function embedImageFitted(
  pdf: PDFDocument,
  bytes: Uint8Array,
  maxWidth: number,
  maxHeight: number,
): Promise<{ image: Awaited<ReturnType<PDFDocument['embedJpg']>>; width: number; height: number } | null> {
  const format = sniffImageFormat(bytes)
  if (!format) return null

  const image = format === 'jpg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1)

  return { image, width: image.width * scale, height: image.height * scale }
}

export async function buildEvidenceBundlePdf(
  data: EvidenceBundleData,
  brandName: string,
): Promise<EvidenceBundlePdfResult> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${brandName} — Evidence Bundle — Booking ${data.bookingId}`)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // ── Cover / summary page ──────────────────────────────────────────────
  const cover = pdf.addPage([PAGE_W, PAGE_H])
  const ctx: DrawCtx = { page: cover, font, bold, y: PAGE_H - 64 }

  text(ctx, brandName, 18, { bold: true })
  ctx.y -= 22
  text(ctx, 'Service Proof — Evidence Bundle', 12, { color: MUTED })
  ctx.y -= 26

  text(ctx, 'Booking', 12, { bold: true })
  ctx.y -= 18
  const summaryRow = (label: string, value: string) => {
    text(ctx, label, 10, { color: MUTED })
    // Value drawn at a fixed offset from the label to align two columns.
    cover.drawText(value, { x: MARGIN + 150, y: ctx.y, size: 10, font })
    ctx.y -= 15
  }
  summaryRow('Booking ID', data.bookingId)
  summaryRow('Client', data.clientName)
  summaryRow('Service', data.serviceName)
  summaryRow('Scheduled for', formatTimestamp(data.scheduledFor, data.timeZone))
  summaryRow('Status', data.bookingStatus)
  summaryRow('Photos/videos included', String(data.assets.length))
  ctx.y -= 8
  rule(ctx)
  ctx.y -= 20

  text(ctx, 'What this bundle proves — and what it does not', 12, { bold: true })
  ctx.y -= 18
  const claims = [
    `A server-side hash ("sha256, server-computed") is listed for every photo/video that has an attestation record. ${brandName}'s server computed it from the exact bytes it received and stored — this proves the file has not been altered since it reached ${brandName}, and lets anyone re-hash the attached original to confirm it still matches.`,
    '"Received by server" is a fact: it is this server\'s own clock at the moment it stored the file. It is the one timestamp in this bundle that is not self-reported by anyone.',
    '"Capture time (device-claimed)" — when present — is reported by the capturing device and is NOT independently verified. Treat it as testimony from the device, not as proof.',
    'A gap between the claimed capture time and the server receipt time is NOT evidence of tampering: a photo taken while offline is legitimately uploaded later, once the device reconnects.',
    'Photos/videos with no attestation on file were captured before this system existed for this booking. There is no cryptographic record for them — only the file itself and its upload date.',
  ]
  for (const claim of claims) {
    paragraph(ctx, `•  ${claim}`, 9.5, { color: INK })
    ctx.y -= 6
  }

  ctx.y -= 6
  rule(ctx)
  ctx.y -= 20
  text(ctx, 'Contents', 12, { bold: true })
  ctx.y -= 16
  data.assets.forEach((asset, i) => {
    const label = `${i + 1}. ${phaseLabel(asset.phase)} — ${asset.mediaType === 'VIDEO' ? 'video' : 'photo'}${
      asset.attestation ? '' : ' (no attestation on file)'
    }${asset.attestation?.hashMismatch ? ' — CLIENT HASH MISMATCH' : ''}`
    text(ctx, label, 10, {
      color: !asset.attestation || asset.attestation.hashMismatch ? WARN : INK,
    })
    ctx.y -= 15
  })

  // ── Per-asset pages ────────────────────────────────────────────────────
  for (const [i, asset] of data.assets.entries()) {
    const label = `${i + 1}. ${phaseLabel(asset.phase)} ${
      asset.mediaType === 'VIDEO' ? 'video' : 'photo'
    }`

    const fitted =
      asset.bytes && asset.mediaType === 'IMAGE'
        ? await embedImageFitted(pdf, asset.bytes, CONTENT_W, 420)
        : null

    // Original page — the image, untouched, plus the full attestation record.
    {
      const page = pdf.addPage([PAGE_W, PAGE_H])
      const pctx: DrawCtx = { page, font, bold, y: PAGE_H - 56 }
      text(pctx, `Original — ${label}`, 13, { bold: true })
      pctx.y -= 20

      if (fitted) {
        const x = MARGIN + (CONTENT_W - fitted.width) / 2
        page.drawImage(fitted.image, { x, y: pctx.y - fitted.height, width: fitted.width, height: fitted.height })
        pctx.y -= fitted.height + 16
      } else {
        const reason =
          asset.mediaType === 'VIDEO'
            ? 'This is a video — no still preview is embedded in this PDF. Verify it using the hash below against the original file.'
            : asset.downloadError
              ? asset.downloadError
              : 'This file is not in a format this bundle can preview (expected JPEG or PNG).'
        paragraph(pctx, reason, 10, { color: MUTED })
        pctx.y -= 8
      }

      if (asset.caption) {
        paragraph(pctx, `Caption: ${asset.caption}`, 9, { color: MUTED })
        pctx.y -= 6
      }
      rule(pctx)
      pctx.y -= 16
      drawAttestationBlock(pctx, asset, data.timeZone)
    }

    // Stamped copy — same image, with a visible timestamp + booking ref
    // burned into THIS copy only. The original page above is never touched.
    if (fitted) {
      const page = pdf.addPage([PAGE_W, PAGE_H])
      const pctx: DrawCtx = { page, font, bold, y: PAGE_H - 56 }
      text(pctx, `Stamped copy — ${label}`, 13, { bold: true })
      pctx.y -= 8
      paragraph(
        pctx,
        'Labeled reference copy for this dispute — the timestamp and booking reference below are burned into this copy only, not into the original image on the previous page.',
        9,
        { color: MUTED },
      )
      pctx.y -= 12

      const x = MARGIN + (CONTENT_W - fitted.width) / 2
      const imgY = pctx.y - fitted.height
      page.drawImage(fitted.image, { x, y: imgY, width: fitted.width, height: fitted.height })

      const stampText = asset.attestation
        ? `Booking ${data.bookingId}  ·  ${phaseLabel(asset.phase)}  ·  Received ${formatInTimeZone(
            asset.attestation.receivedAt,
            data.timeZone,
            { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' },
          )} (server)`
        : `Booking ${data.bookingId}  ·  ${phaseLabel(asset.phase)}  ·  No attestation on file`

      const stampSize = 10
      const stampPad = 8
      const stampWidth = Math.min(font.widthOfTextAtSize(stampText, stampSize) + stampPad * 2, fitted.width)
      page.drawRectangle({
        x,
        y: imgY,
        width: fitted.width,
        height: 22,
        color: STAMP_BG,
        opacity: 0.72,
      })
      page.drawText(stampText, {
        x: x + stampPad,
        y: imgY + 6,
        size: stampSize,
        font,
        color: STAMP_INK,
        maxWidth: stampWidth,
      })
    }
  }

  const bytes = await pdf.save()
  return { filename: `evidence-bundle-${data.bookingId}.pdf`, bytes }
}
