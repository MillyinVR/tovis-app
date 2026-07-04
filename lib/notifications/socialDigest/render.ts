// lib/notifications/socialDigest/render.ts
//
// PURE render of the social digest email (subject + text + html). No I/O — the
// orchestrator resolves absolute URLs, brand name, and greeting, then this
// lays them out. Follows the transactional-email precedent
// (renderNotificationContent.ts): semantic HTML, no raw colors, brand name
// injected (never hardcoded — white-label rule).
import { buildDigestHeadline, type SocialDigestSummary } from './summary'

export type SocialDigestTopLook = {
  id: string
  caption: string | null
  thumbUrl: string | null
  proName: string
  /** Absolute permalink to the look. */
  href: string
}

export type SocialDigestEmailModel = {
  /** Recipient first name when known; null → a generic greeting. */
  greetingName: string | null
  summary: SocialDigestSummary
  /** Recent-activity lines with ABSOLUTE hrefs. */
  recent: Array<{ title: string; href: string }>
  topLooks: readonly SocialDigestTopLook[]
  /** Absolute URL to the recipient's notification-preferences surface. */
  managePreferencesUrl: string
  /** Absolute URL back into the looks feed ("come scroll"). */
  browseLooksUrl: string
}

export type RenderedDigestEmail = {
  subject: string
  text: string
  html: string
}

const MAX_SUBJECT = 150

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildGreeting(greetingName: string | null): string {
  const name = normalizeText(greetingName)
  return name ? `Hi ${name},` : 'Hi there,'
}

function buildSummaryLine(summary: SocialDigestSummary): string {
  return summary.groups
    .map((group) => `${group.emoji} ${group.label}`)
    .join('  ·  ')
}

export function renderSocialDigestEmail(args: {
  model: SocialDigestEmailModel
  brandName: string
}): RenderedDigestEmail {
  const { model, brandName } = args
  const brand = normalizeText(brandName) || 'the app'
  const headline = buildDigestHeadline(model.summary)
  const subject = clip(`${brand}: ${headline}`, MAX_SUBJECT)

  const summaryLine = buildSummaryLine(model.summary)
  const greeting = buildGreeting(model.greetingName)

  // ---- text ----
  const textLines: string[] = [greeting, '']
  if (summaryLine) {
    textLines.push(
      model.summary.groups.map((group) => group.label).join(', '),
      '',
    )
  }
  if (model.recent.length > 0) {
    textLines.push('Recent activity:')
    for (const item of model.recent) {
      const title = normalizeText(item.title)
      textLines.push(item.href ? `- ${title}: ${item.href}` : `- ${title}`)
    }
    textLines.push('')
  }
  if (model.topLooks.length > 0) {
    textLines.push('Top looks this week:')
    for (const look of model.topLooks) {
      const caption = normalizeText(look.caption) || 'Untitled look'
      textLines.push(`- ${caption} — ${normalizeText(look.proName)}: ${look.href}`)
    }
    textLines.push('')
  }
  textLines.push(
    `Keep scrolling: ${model.browseLooksUrl}`,
    '',
    `Manage your email preferences: ${model.managePreferencesUrl}`,
    `Sent by ${brand}`,
  )
  const text = textLines.join('\n')

  // ---- html ----
  const summaryHtml = summaryLine
    ? `    <p style="font-size:16px;">${escapeHtml(summaryLine)}</p>`
    : ''

  const recentHtml =
    model.recent.length > 0
      ? [
          '    <h2 style="font-size:18px;">Recent activity</h2>',
          '    <ul>',
          ...model.recent.map((item) => {
            const title = escapeHtml(normalizeText(item.title))
            return item.href
              ? `      <li><a href="${escapeHtml(item.href)}">${title}</a></li>`
              : `      <li>${title}</li>`
          }),
          '    </ul>',
        ].join('\n')
      : ''

  const topLooksHtml =
    model.topLooks.length > 0
      ? [
          '    <h2 style="font-size:18px;">Top looks this week</h2>',
          ...model.topLooks.map((look) => {
            const caption = escapeHtml(normalizeText(look.caption) || 'Untitled look')
            const proName = escapeHtml(normalizeText(look.proName))
            const image = look.thumbUrl
              ? `<img src="${escapeHtml(look.thumbUrl)}" alt="${caption}" width="96" height="120" style="border-radius:8px;object-fit:cover;" />`
              : ''
            return [
              '    <p>',
              image ? `      <a href="${escapeHtml(look.href)}">${image}</a><br />` : '',
              `      <a href="${escapeHtml(look.href)}">${caption}</a> — ${proName}`,
              '    </p>',
            ]
              .filter(Boolean)
              .join('\n')
          }),
        ].join('\n')
      : ''

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '  <body>',
    `    <h1 style="font-size:22px;">${escapeHtml(headline)}</h1>`,
    `    <p>${escapeHtml(greeting)}</p>`,
    summaryHtml,
    recentHtml,
    topLooksHtml,
    `    <p><a href="${escapeHtml(model.browseLooksUrl)}">Keep scrolling &rarr;</a></p>`,
    '    <hr />',
    `    <p style="font-size:12px;"><a href="${escapeHtml(model.managePreferencesUrl)}">Manage your email preferences</a></p>`,
    `    <p style="font-size:12px;">Sent by ${escapeHtml(brand)}</p>`,
    '  </body>',
    '</html>',
  ]
    .filter((line) => line !== '')
    .join('\n')

  return { subject, text, html }
}
