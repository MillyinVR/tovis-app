// app/pro/services/CalendarSwatchPicker.test.tsx
//
// K8: the picker is the ONLY place a pro chooses a calendar colour, and the
// house rule it has to keep — fixed brand tokens, never a raw colour — is one
// no static guard enforces. So it is pinned here.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import CalendarSwatchPicker from '@/app/pro/services/CalendarSwatchPicker'
import { CALENDAR_SWATCH_IDS } from '@/lib/calendar/eventColor'

function renderPicker(
  overrides: Partial<Parameters<typeof CalendarSwatchPicker>[0]> = {},
) {
  const onChange = vi.fn()

  const result = render(
    <CalendarSwatchPicker
      name="swatch-test"
      value={null}
      onChange={onChange}
      {...overrides}
    />,
  )

  return { onChange, ...result }
}

describe('CalendarSwatchPicker', () => {
  it('offers exactly the palette, plus None — no more, no fewer', () => {
    renderPicker()

    const radios = screen.getAllByRole('radio')

    expect(radios).toHaveLength(CALENDAR_SWATCH_IDS.length + 1)

    for (const id of CALENDAR_SWATCH_IDS) {
      expect(
        screen.getByRole('radio', { name: `Colour ${Number(id)}` }),
      ).toBeDefined()
    }
  })

  // 🔴 The load-bearing assertion. A raw colour skips [data-mode] — readable in
  // light, invisible in dark — and NO static guard catches one, so if a future
  // edit swaps a token for a hex this is what fails.
  it('paints every chip from a brand token, never a literal colour', () => {
    const { container } = renderPicker()

    const styled = [...container.querySelectorAll<HTMLElement>('span[style]')]

    expect(styled).toHaveLength(CALENDAR_SWATCH_IDS.length)

    for (const node of styled) {
      const style = node.getAttribute('style') ?? ''

      expect(style).toMatch(/^background:\s*rgb\(var\(--swatch-(0[1-9]|1[0-2])\)\);?$/)
      expect(style).not.toMatch(/#[0-9a-f]{3,8}/i)
    }
  })

  it('checks the stored swatch and nothing else', () => {
    renderPicker({ value: '07' })

    expect(
      screen.getByRole('radio', { name: 'Colour 7' }).getAttribute('checked'),
    ).not.toBe('false')

    const checked = screen
      .getAllByRole<HTMLInputElement>('radio')
      .filter((radio) => radio.checked)

    expect(checked).toHaveLength(1)
    expect(checked[0]?.getAttribute('aria-label')).toBe('Colour 7')
  })

  it('reports the chosen swatch id', () => {
    const { onChange } = renderPicker()

    fireEvent.click(screen.getByRole('radio', { name: 'Colour 11' }))

    expect(onChange).toHaveBeenCalledWith('11')
  })

  it('reports null when the pro clears the colour', () => {
    const { onChange } = renderPicker({ value: '11' })

    fireEvent.click(screen.getByRole('radio', { name: /none/i }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('checks None when no colour is stored', () => {
    renderPicker({ value: null })

    const none = screen.getByRole<HTMLInputElement>('radio', { name: /none/i })

    expect(none.checked).toBe(true)
  })

  it('disables every chip while the offering cannot be edited', () => {
    renderPicker({ disabled: true })

    for (const radio of screen.getAllByRole<HTMLInputElement>('radio')) {
      expect(radio.disabled).toBe(true)
    }
  })
})
