// lib/pdf/wrapText.ts
//
// Greedy word-wrap to a pixel width for pdf-lib text blocks. Extracted from
// lib/finance/proFinanceScheduleCPdf.ts (the only prior caller) so a second
// PDF builder doesn't hand-copy it.
import type { PDFFont } from 'pdf-lib'

export function wrapText(
  content: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = content.split(' ')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }

  if (current) lines.push(current)

  return lines
}
